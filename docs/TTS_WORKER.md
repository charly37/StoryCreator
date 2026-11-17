# Text-to-Speech Worker

StoryCreator can queue narrated audio for a story. The request is stored in MongoDB, a long-running
Python worker synthesizes one clip per sentence, and three playable renders are assembled from those
clips: the story in `lang1`, the story in `lang2`, and a bilingual version that alternates between
them sentence by sentence.

```mermaid
flowchart LR
  UI[My Stories / Review page] -->|POST /api/tts-requests| API[StoryCreator API]
  API -->|upsert status=queued| Q[(ttsrequests)]
  W[TtsWorker.py] -->|claim| Q
  W -->|one call per sentence| EL[ElevenLabs]
  W -->|clips/{voice}/{sha256}.mp3| FS[(AUDIO_PATH hostPath)]
  W -->|renders/{story}/{hash}/{variant}.mp3| FS
  W -->|TtsRender rows| R[(ttsrenders)]
  API -->|GET /api/stories/:id/audio/:variant| FS
  UI -->|audio element| API
```

---

## Components

| Path | Purpose |
|---|---|
| `src/models/TtsRequest.ts` | Queue document — one per `(story, language)` |
| `src/models/TtsRender.ts` | Derived renders — one per `(story, text version, variant)` |
| `src/routes/tts.ts` | `POST /api/tts-requests`, `GET /api/tts-requests?storyIds=…` |
| `src/routes/storyAudio.ts` | `GET /api/stories/:id/audio`, `GET /api/stories/:id/audio/:variant` |
| `TtsWorker/TtsWorker.py` | Claim loop, synthesis, render orchestration |
| `TtsWorker/tts_provider.py` | ElevenLabs + fake provider |
| `TtsWorker/audio_render.py` | LUFS normalization and clip concatenation (pydub) |
| `TtsWorker/voices.py` | Voice catalog (one voice per language) |
| `pythonDockerBaseImage/Dockerfile` | Ships the worker plus `ffmpeg` in `storycreator-scripts` |
| `helm/story-creator/templates/tts-worker-deployment.yaml` | Deployment (`<release>-tts-worker`) |
| `helm/story-creator/values.yaml` | `audio.*`, `ttsWorker.*`, `resources.ttsWorker` |

This worker talks **directly to MongoDB** — it needs the whole queue, not one story — and it writes
files to a shared volume.

---

## How work flows

1. The author clicks **Request audio** on My Stories or the Review page. The API upserts one
   `TtsRequest` per language with `status: "queued"` and returns `202`.
2. The worker claims the oldest queued request (`status → processing`, `attempts += 1`) and resolves
   the story's sentences for that language.
3. Each sentence becomes a clip at `clips/{voiceId}/{sha256(text)}.mp3`. If the file already exists the
   provider is **not** called, so re-running is free and a crash resumes at the first missing sentence.
4. The clip manifest and a `storyHash` (a hash of both language tracks) are written to the request
   document.
5. The language's monologue is assembled and recorded in `ttsrenders`; the request becomes `done`.
6. If the other language is already `done` for the same `storyHash`, the **bilingual** render is
   assembled and recorded too.

Renders are derived artifacts: they can be deleted and rebuilt from the clips at any time. A new
`storyHash` produces new render rows rather than overwriting old ones, so the API can simply serve the
newest row per variant and stale audio disappears from the UI by itself.

---

## Storage layout

Everything lives under `AUDIO_PATH` (default `/app/audio`, mounted from the node's `audio.hostPath`):

```
clips/{voiceId}/{sha256(text)}.mp3                     # content-addressed, shared across stories
renders/{storyId}/{storyHash16}/lang1.mp3
renders/{storyId}/{storyHash16}/lang2.mp3
renders/{storyId}/{storyHash16}/bilingual.mp3
```

Clips hold the provider's bytes verbatim; normalization happens at render time, which keeps the
content hash meaningful.

---

## Assembly rules

Ported from `PortugueseLearning/vocal_lesson_creator/combine_mp3.py`:

| Rule | Value |
|---|---|
| Per-clip loudness | −16 LUFS (ITU-R BS.1770), RMS dBFS fallback below 400 ms |
| Final mix | peak-normalized with `headroom=0.1` |
| Gap between sentences | 250 ms |
| Gap at a language switch | 700 ms |
| Gap at a chapter boundary | 1200 ms |
| Encoding | pydub mp3 export (decode → mix → single encode) |

PortugueseLearning's 1300/2000 ms gaps are tuned for vocabulary recall drills and would make
narration crawl, which is why they are shorter here.

**Bilingual order** is native-first, per sentence: `s1.lang1, s1.lang2, s2.lang1, s2.lang2, …` — the
same "familiar language first" convention as the vocabulary lessons.

---

## Voice catalog

`TtsWorker/voices.py` maps a language code to an ElevenLabs voice ID. Only `pt`, `fr` and `en` are
curated today (copied from PortugueseLearning); every other language falls back to `DEFAULT_VOICE`
and logs a one-time warning. Set `TTS_VOICE` (or `ttsWorker.voice` in Helm) to override every language,
which is handy for testing.

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | yes | — | Same connection string as the app |
| `TEXT_TO_SPEECH_API_KEY` | yes unless faking | — | ElevenLabs key |
| `AUDIO_PATH` | no | `./audio` | Root for clips and renders |
| `TTS_PROVIDER` | no | `elevenlabs` | `fake` writes silence and spends no credits |
| `TTS_VOICE` | no | — | Voice override for every language |
| `TTS_SPEED` | no | `1.0` | Provider speech speed |
| `TTS_MAX_ATTEMPTS` | no | `3` | Attempts before a request is marked failed |
| `TTS_API_DELAY` | no | `0.5` | Seconds between provider calls |
| `POLL_INTERVAL` | no | `5` | Seconds to wait when the queue is empty |
| `LOG_LEVEL` | no | `info` | Accepts pino-style or Python-style names. `pymongo`/`elevenlabs`/`httpx` are pinned to WARNING so `debug` does not dump driver traffic |

---

## Running locally

The fake provider exercises the entire pipeline — clips, LUFS normalization, renders, Mongo
bookkeeping — without a key or a credit:

```bash
pip install -r TtsWorker/requirements.txt        # needs ffmpeg on PATH
MONGODB_URI="mongodb+srv://..." TTS_PROVIDER=fake \
  AUDIO_PATH=./audio python -u TtsWorker/TtsWorker.py --once
```

Output:

```
INFO Using fake TTS provider (silence; no credits consumed)
INFO Watching ttsrequests from /workspace/StoryCreator/audio (poll 5.0s, max attempts 3)
INFO Claimed request 6731...: story 6730... (lang1), attempt 1
INFO Synthesizing 40 sentence(s) for story 6730... (lang1, language=fr, voice=ICk609TItINMseDpChFt)
INFO Clips ready for story 6730... (lang1): 40 synthesized, 0 reused
INFO Rendered lang1 for story 6730... (312.4s, 5012233 bytes)
INFO Waiting for lang2 before composing the bilingual render of story 6730...
```

Useful flags:

| Flag | Effect |
|---|---|
| `--once` | Drain the queue then exit |
| `--dry-run` | List queued work; synthesize nothing, write nothing |
| `--force` | Re-synthesize clips that already exist |
| `--audio-dir`, `--poll-interval`, `--max-attempts`, `--api-delay` | Override the env vars |

Inspect state:

```bash
mongosh "$MONGODB_URI" --eval 'db.ttsrequests.find({}, {status:1, phase:1, progress:1, error:1}).pretty()'
mongosh "$MONGODB_URI" --eval 'db.ttsrenders.find().sort({createdAt:-1}).limit(6).pretty()'
find ./audio -name '*.mp3' | head
```

---

## Reliability model

There is **no heartbeat, lease or sweeper**. Instead:

- on startup the worker requeues any document left in `processing` (a crashed run);
- documents that already reached `TTS_MAX_ATTEMPTS` are marked `failed`;
- clips are content-addressed, so a requeued job resumes at the first sentence with no clip;
- re-requesting from the UI resets `attempts` to `0`;
- an ElevenLabs quota error puts the request back to `queued`, refunds the attempt and pauses the
  worker for 15 minutes instead of failing the job.

This is only safe because the Deployment runs **one replica**. The Kubernetes job alternatives used in
PortugueseLearning (`concurrencyPolicy: Forbid`, `backoffLimit`) do not apply to a long-running
Deployment.

---

## Deploying

```bash
# Create the hostPath on the NODE (not your laptop), owned by the uid the pods run as.
# Without the chown the mount succeeds and the worker fails on its first write.
sudo mkdir -p /home/ubuntu/StoryCreator/audio
sudo chown -R 1000:1000 /home/ubuntu/StoryCreator/audio
sudo chmod 775 /home/ubuntu/StoryCreator/audio

kubectl -n story-creator patch secret story-creator-secrets --type merge \
  -p '{"stringData":{"text-to-speech-api-key":"sk_..."}}'

helm upgrade story-creator helm/story-creator \
  --set ttsWorker.enabled=true --set image.tag=dev-abc1234

kubectl -n story-creator logs deploy/story-creator-tts-worker -f
```

| Value | Default | Notes |
|---|---|---|
| `ttsWorker.enabled` | `false` | Creates the Deployment |
| `ttsWorker.pollInterval` | `5` | Keep small; audio is user-triggered |
| `ttsWorker.provider` | `elevenlabs` | Set `fake` to smoke-test in-cluster |
| `ttsWorker.speed` | `1.0` | ~0.85 is friendlier for learners |
| `ttsWorker.maxAttempts` | `3` | |
| `ttsWorker.voice` | `""` | Overrides the catalog for every language |
| `audio.hostPath` | `/home/ubuntu/StoryCreator/audio` | Must exist before `helm upgrade` |
| `audio.mountPath` | `/app/audio` | Read-only in the app, read-write in the worker |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `MountVolume.SetUp failed for volume "audio" : hostPath type check failed` | The directory does not exist **on the node**. `sudo mkdir -p <audio.hostPath>` there — creating it locally has no effect |
| Starts, then fails on the first write with `Permission denied` | The hostPath is owned by root. `sudo chown -R 1000:1000 <audio.hostPath>` |
| `AUDIO_PATH ... is not writable by uid 1000` | Same as above; the worker probes write access on startup and prints the fix |
| `TEXT_TO_SPEECH_API_KEY is not set` | Secret key missing, or `ttsWorker.provider` left at `elevenlabs` without a key |
| Request stuck in `processing` | The pod died mid-run; restart it (or let the Deployment restart it) — startup requeues orphans |
| Request `failed` with `Max attempts reached` | Three consecutive failures; re-request from the UI to reset `attempts` |
| `failed` with `QUOTA_EXCEEDED` in `error` | Credits ran out; the request was requeued and the worker paused 15 min |
| `AUDIO_NOT_READY` from the API | The render row does not exist yet — check the worker log for the story id |
| `AUDIO_MISSING` from the API | Mongo has a render row but the file is gone — re-request, or check the volume mount |
| Bilingual render never appears | Only one language was requested, or the other language's request is not `done` |
| Audio sounds clipped or quiet | Look for the LUFS/mix log lines; a clip under 400 ms uses the RMS fallback |

Related documentation: [API](API.md) · [Design](design.md) · [Logging](LOGGING.md)
