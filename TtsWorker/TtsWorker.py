#!/usr/bin/env python3
"""
TtsWorker.py — synthesize per-sentence narration clips and assemble story renders.

One queued `TtsRequest` document covers one (story, language) pair. For each:

  1. claim      — findOneAndUpdate(status: queued -> processing), attempts += 1
  2. synthesize — one provider call per sentence, cached by content hash
  3. render     — assemble that language's monologue, record a `TtsRender`
  4. compose    — once both languages exist for the same story hash, build `bilingual`

Recovery is deliberately simple: there is no heartbeat or lease. On startup the worker
requeues any document left in `processing` (a crashed run) and fails documents that
already burned their attempts. Because clips are content-addressed, a restart resumes at
the first sentence that has no clip on disk — re-running costs nothing for work already
done. This is why the Deployment runs `replicas: 1`.

Storage layout under `AUDIO_PATH`:

  clips/{voiceId}/{sha256(text)}.mp3
  renders/{storyId}/{storyHash}/lang1.mp3 | lang2.mp3 | bilingual.mp3

Environment:

  MONGODB_URI            MongoDB connection string (required)
  AUDIO_PATH             Root for clips and renders (default: ./audio)
  TEXT_TO_SPEECH_API_KEY ElevenLabs key (required unless TTS_PROVIDER=fake)
  TTS_PROVIDER           elevenlabs (default) | fake
  TTS_VOICE              Override the voice ID for every language
  TTS_SPEED              Provider speech speed (default: 1.0)
  TTS_MAX_ATTEMPTS       Attempts before a request is marked failed (default: 3)
  POLL_INTERVAL          Seconds to wait when the queue is empty (default: 5)
  LOG_LEVEL              debug | info | warn | error | ... (default: INFO)

CLI flags mirror the environment variables and take precedence.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient, ReturnDocument
from pymongo.collection import Collection
from pymongo.database import Database

from audio_render import bilingual_segments, build_render, speech_segments
from tts_provider import FakeProvider, QuotaExceededError, TtsError, build_provider
from voices import voice_for

DEFAULT_POLL_INTERVAL = 5.0
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_API_DELAY = 0.5
PROGRESS_EVERY = 5
QUOTA_PAUSE_SECONDS = 900.0
MAX_RECONCILE_PER_RUN = 20

REQUESTS = "ttsrequests"
RENDERS = "ttsrenders"
STORIES = "stories"

LOG_LEVEL_ALIASES = {
    "TRACE": "DEBUG",
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "WARN": "WARNING",
    "WARNING": "WARNING",
    "ERROR": "ERROR",
    "FATAL": "CRITICAL",
    "SILENT": "CRITICAL",
}


def _log_level() -> int:
    raw = os.environ.get("LOG_LEVEL", "INFO").upper()
    return getattr(logging, LOG_LEVEL_ALIASES.get(raw, "INFO"))


logging.basicConfig(
    level=_log_level(),
    stream=sys.stdout,
    format="%(levelname)s %(message)s",
)
log = logging.getLogger("tts-worker")

# The SDKs log every connection, heartbeat and command reply at DEBUG, which buries
# our own records and dumps whole story documents into the log. Keep them at WARNING
# regardless of LOG_LEVEL.
for _noisy in ("pymongo", "elevenlabs", "httpx", "urllib3"):
    logging.getLogger(_noisy).setLevel(max(logging.WARNING, _log_level()))


def _one_line(text: Any, limit: int = 500) -> str:
    """Collapse whitespace so one record stays one log line.

    VictoriaLogs treats every newline as a separate record, so embedded newlines
    produce orphan lines without a message field. Mirrors
    `PortugueseLearning/VocabularyUpdaterAgent/VocabularyUpdaterAgent.py`.
    """
    collapsed = " ".join(str(text).split())
    return collapsed[:limit]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Interrupted(RuntimeError):
    """Raised when a shutdown signal arrives mid-synthesis."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synthesize narration clips and renders for StoryCreator stories.",
    )
    parser.add_argument("--mongo-uri", default=os.environ.get("MONGODB_URI", ""))
    parser.add_argument("--audio-dir", default=os.environ.get("AUDIO_PATH", "audio"))
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.environ.get("POLL_INTERVAL", DEFAULT_POLL_INTERVAL)),
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=int(os.environ.get("TTS_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS)),
    )
    parser.add_argument(
        "--api-delay",
        type=float,
        default=float(os.environ.get("TTS_API_DELAY", DEFAULT_API_DELAY)),
        help="Seconds between provider calls (rate limiting)",
    )
    parser.add_argument("--once", action="store_true", help="Drain the queue, then exit")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List queued work without synthesizing or writing anything",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-synthesize clips that already exist on disk",
    )
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    return parser.parse_args(argv)


class Context:
    """Everything one worker run needs."""

    def __init__(self, db: Database, audio_dir: Path, provider: Any, args: argparse.Namespace) -> None:
        self.db = db
        self.audio_dir = audio_dir
        self.provider = provider
        self.args = args
        self.requests: Collection = db[REQUESTS]
        self.renders: Collection = db[RENDERS]
        self.stories: Collection = db[STORIES]
        self.stopping = False
        self.paused_until = 0.0


# ── queue ────────────────────────────────────────────────────────────────────


def bootstrap(ctx: Context) -> None:
    """Recover state left behind by a crashed run."""
    requeued = ctx.requests.update_many(
        {"status": "processing"},
        {"$set": {"status": "queued"}, "$currentDate": {"updatedAt": True}},
    )
    if requeued.modified_count:
        log.warning("Requeued %d orphaned processing request(s)", requeued.modified_count)

    # Documents written before the queue tracked attempts would otherwise be invisible
    # to the claim filter, because `{attempts: {$lt: n}}` does not match a missing field.
    normalised = ctx.requests.update_many(
        {"attempts": {"$exists": False}},
        {"$set": {"attempts": 0, "error": ""}},
    )
    if normalised.modified_count:
        log.warning("Defaulted attempts on %d request(s)", normalised.modified_count)

    failed = ctx.requests.update_many(
        {"status": "queued", "attempts": {"$gte": ctx.args.max_attempts}},
        {"$set": {"status": "failed", "error": "Max attempts reached without completing"}},
    )
    if failed.modified_count:
        log.warning("Marked %d request(s) failed after %d attempts", failed.modified_count, ctx.args.max_attempts)


def claim(ctx: Context) -> dict | None:
    return ctx.requests.find_one_and_update(
        {
            "status": "queued",
            # `$lt` alone would never match a document with no attempts field.
            "$or": [{"attempts": {"$lt": ctx.args.max_attempts}}, {"attempts": {"$exists": False}}],
        },
        {
            "$set": {"status": "processing", "phase": "synthesize", "startedAt": _now(), "error": ""},
            "$inc": {"attempts": 1},
        },
        sort=[("requestedAt", 1)],
        return_document=ReturnDocument.AFTER,
    )


def requeue_after_quota(ctx: Context, request: dict) -> None:
    # The attempt was consumed at claim time; quota is not this job's fault.
    ctx.requests.update_one(
        {"_id": request["_id"]},
        {
            "$set": {"status": "queued", "phase": "synthesize", "error": "QUOTA_EXCEEDED"},
            "$inc": {"attempts": -1},
        },
    )


def fail(ctx: Context, request: dict, message: str) -> None:
    ctx.requests.update_one(
        {"_id": request["_id"]},
        {"$set": {"status": "failed", "error": _one_line(message), "finishedAt": _now()}},
    )


# ── story text ───────────────────────────────────────────────────────────────


def story_hash(story: dict) -> str:
    """Hash of both language tracks — changes when any sentence in either changes."""
    digest = hashlib.sha256()
    for chapter in story.get("chapters") or []:
        for sentence in chapter.get("sentences") or []:
            digest.update((sentence.get("lang1") or "").encode("utf-8"))
            digest.update(b"\x00")
            digest.update((sentence.get("lang2") or "").encode("utf-8"))
            digest.update(b"\x01")
    return digest.hexdigest()


def language_code(story: dict, lang: str) -> str:
    return story.get("nativeLanguage" if lang == "lang1" else "learningLanguage") or ""


def sentences_for(story: dict, lang: str) -> list[dict]:
    result: list[dict] = []
    for chapter_index, chapter in enumerate(story.get("chapters") or []):
        for sentence_index, sentence in enumerate(chapter.get("sentences") or []):
            text = (sentence.get(lang) or "").strip()
            if text:
                result.append(
                    {"chapterIndex": chapter_index, "sentenceIndex": sentence_index, "text": text}
                )
    return result


def clip_key(voice_id: str, text: str) -> str:
    return f"clips/{voice_id}/{hashlib.sha256(text.encode('utf-8')).hexdigest()}.mp3"


def render_key(story_id: Any, story_hash_value: str, variant: str) -> str:
    return f"renders/{story_id}/{story_hash_value[:16]}/{variant}.mp3"


# ── pipeline ─────────────────────────────────────────────────────────────────


def synthesize_clips(ctx: Context, request: dict, story: dict) -> list[dict]:
    """Ensure a clip exists for every sentence; returns the manifest."""
    lang = request["lang"]
    sentences = sentences_for(story, lang)
    if not sentences:
        raise TtsError(f"Story has no {lang} sentences")

    language = language_code(story, lang)
    voice_id = voice_for(language, os.environ.get("TTS_VOICE") or None)
    log.info(
        "Synthesizing %d sentence(s) for story %s (%s, language=%s, voice=%s)",
        len(sentences),
        request["storyId"],
        lang,
        language or "unknown",
        voice_id,
    )
    # First sentence, so the log shows which text actually went to the provider.
    log.info("  %s sample: %r", lang, _one_line(sentences[0]["text"])[:80])

    clips: list[dict] = []
    created = 0
    for index, sentence in enumerate(sentences, start=1):
        if ctx.stopping:
            raise Interrupted()

        key = clip_key(voice_id, sentence["text"])
        path = ctx.audio_dir / key
        if ctx.args.force or not path.exists():
            audio = ctx.provider.synthesize(sentence["text"], language, voice_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
            created += 1
            if not isinstance(ctx.provider, FakeProvider) and ctx.args.api_delay > 0:
                time.sleep(ctx.args.api_delay)

        clips.append(
            {
                "chapterIndex": sentence["chapterIndex"],
                "sentenceIndex": sentence["sentenceIndex"],
                "key": key,
            }
        )

        if index % PROGRESS_EVERY == 0 or index == len(sentences):
            ctx.requests.update_one(
                {"_id": request["_id"]},
                {"$set": {"progress": {"done": index, "total": len(sentences)}}},
            )

    log.info(
        "Clips ready for story %s (%s): %d synthesized, %d reused",
        request["storyId"],
        lang,
        created,
        len(clips) - created,
    )
    return clips


def write_render(
    ctx: Context,
    request: dict,
    story_hash_value: str,
    variant: str,
    segments: list[dict],
) -> None:
    key = render_key(request["storyId"], story_hash_value, variant)
    output_path = ctx.audio_dir / key
    duration_ms, size_bytes = build_render(segments, output_path)

    ctx.renders.update_one(
        {"storyId": request["storyId"], "storyHash": story_hash_value, "variant": variant},
        {
            "$set": {
                "key": key,
                "durationMs": duration_ms,
                "sizeBytes": size_bytes,
                "createdAt": _now(),
            }
        },
        upsert=True,
    )
    log.info(
        "Rendered %s for story %s (%.1fs, %d bytes)",
        variant,
        request["storyId"],
        duration_ms / 1000,
        size_bytes,
    )


def maybe_compose_bilingual(ctx: Context, request: dict, story_hash_value: str) -> None:
    """Build the interleaved render once both languages exist for this story hash."""
    if not request.get("clips"):
        return

    other = "lang2" if request["lang"] == "lang1" else "lang1"
    sibling = ctx.requests.find_one(
        {
            "storyId": request["storyId"],
            "lang": other,
            "storyHash": story_hash_value,
            "status": "done",
        }
    )
    if not sibling or not sibling.get("clips"):
        log.info(
            "Waiting for %s before composing the bilingual render of story %s",
            other,
            request["storyId"],
        )
        return

    if ctx.renders.find_one(
        {"storyId": request["storyId"], "storyHash": story_hash_value, "variant": "bilingual"}
    ):
        return

    if request["lang"] == "lang1":
        segments = bilingual_segments(request["clips"], sibling["clips"])
    else:
        segments = bilingual_segments(sibling["clips"], request["clips"])

    try:
        write_render(
            ctx,
            request,
            story_hash_value,
            "bilingual",
            [{**segment, "path": ctx.audio_dir / segment["key"]} for segment in segments],
        )
    except Exception as exc:  # noqa: BLE001 - the monologue already succeeded
        # Best-effort: marking the whole request failed here would be wrong, and
        # reconcile_renders retries the composition on the next start.
        log.warning(
            "Bilingual render failed for story %s (%s); left for reconciliation",
            request["storyId"],
            _one_line(exc),
        )


def clips_on_disk(clips: list[dict], audio_dir: Path) -> bool:
    """True when every clip referenced by a manifest still exists."""
    return bool(clips) and all((audio_dir / clip["key"]).exists() for clip in clips)


def reconcile_renders(ctx: Context) -> None:
    """Compose bilingual renders a previous run left unfinished.

    A request is marked `done` before the bilingual pass runs, so a crash in between
    leaves both monologues present with no `bilingual` row — and neither request will
    ever be claimed again. This makes that state self-healing.
    """
    groups = ctx.renders.aggregate(
        [
            {"$match": {"variant": {"$in": ["lang1", "lang2"]}}},
            {
                "$group": {
                    "_id": {"storyId": "$storyId", "storyHash": "$storyHash"},
                    "variants": {"$addToSet": "$variant"},
                }
            },
            {"$match": {"variants": {"$all": ["lang1", "lang2"]}}},
        ]
    )

    repaired = 0
    for group in groups:
        if repaired >= MAX_RECONCILE_PER_RUN:
            log.warning("Reconcile limit reached; the rest will be picked up next start")
            break

        story_id = group["_id"]["storyId"]
        story_hash_value = group["_id"]["storyHash"]
        if ctx.renders.find_one(
            {"storyId": story_id, "storyHash": story_hash_value, "variant": "bilingual"}
        ):
            continue

        requests = {
            request["lang"]: request
            for request in ctx.requests.find(
                {"storyId": story_id, "storyHash": story_hash_value, "status": "done"}
            )
            if request.get("clips")
        }
        lang1, lang2 = requests.get("lang1"), requests.get("lang2")
        if not (lang1 and lang2):
            continue

        # Render rows outlive the files: if the clips were pruned (or written on another
        # node) recomposing would crash on the first missing file. Re-synthesising is the
        # caller's job, via a fresh request.
        if not (clips_on_disk(lang1["clips"], ctx.audio_dir) and clips_on_disk(lang2["clips"], ctx.audio_dir)):
            log.warning(
                "Skipping bilingual recompose for story %s: source clips are missing from %s "
                "(re-request audio to rebuild)",
                story_id,
                ctx.audio_dir,
            )
            continue

        log.warning("Recomposing missing bilingual render for story %s", story_id)
        try:
            segments = bilingual_segments(lang1["clips"], lang2["clips"])
            write_render(
                ctx,
                lang1,
                story_hash_value,
                "bilingual",
                [{**segment, "path": ctx.audio_dir / segment["key"]} for segment in segments],
            )
            repaired += 1
        except Exception as exc:  # noqa: BLE001 - one bad story must not stop the worker
            log.warning("Could not recompose bilingual render for story %s: %s", story_id, _one_line(exc))

    if repaired:
        log.info("Recomposed %d bilingual render(s)", repaired)


def process_request(ctx: Context, request: dict) -> None:
    story = ctx.stories.find_one(
        {"_id": request["storyId"]},
        {"chapters": 1, "nativeLanguage": 1, "learningLanguage": 1, "title": 1},
    )
    if not story:
        fail(ctx, request, "Story not found")
        return

    story_hash_value = story_hash(story)
    clips = synthesize_clips(ctx, request, story)

    ctx.requests.update_one(
        {"_id": request["_id"]},
        {"$set": {"clips": clips, "storyHash": story_hash_value, "phase": "render"}},
    )
    request = {**request, "clips": clips, "storyHash": story_hash_value}

    segments = speech_segments(clips, request["lang"])
    write_render(
        ctx,
        request,
        story_hash_value,
        request["lang"],
        [{**segment, "path": ctx.audio_dir / segment["key"]} for segment in segments],
    )

    ctx.requests.update_one(
        {"_id": request["_id"]},
        {"$set": {"status": "done", "phase": "done", "finishedAt": _now(), "error": ""}},
    )

    maybe_compose_bilingual(ctx, request, story_hash_value)


def run_once(ctx: Context) -> int:
    """Process a single request. Returns 0 when the queue was empty."""
    request = claim(ctx)
    if request is None:
        return 0

    log.info(
        "Claimed request %s: story %s (%s), attempt %d",
        request["_id"],
        request["storyId"],
        request["lang"],
        request.get("attempts", 0),
    )
    try:
        process_request(ctx, request)
    except Interrupted:
        # A rollout stopped us mid-run. Put the work back without spending an attempt;
        # the clips already on disk make the resume cheap.
        ctx.requests.update_one(
            {"_id": request["_id"]},
            {
                "$set": {"status": "queued", "phase": "synthesize", "error": "INTERRUPTED"},
                "$inc": {"attempts": -1},
            },
        )
        log.warning("Request %s requeued after a shutdown signal", request["_id"])
    except QuotaExceededError as exc:
        requeue_after_quota(ctx, request)
        ctx.paused_until = time.monotonic() + QUOTA_PAUSE_SECONDS
        log.error(
            "%s — requeued request %s and pausing for %.0fs",
            exc,
            request["_id"],
            QUOTA_PAUSE_SECONDS,
        )
    except TtsError as exc:
        fail(ctx, request, str(exc))
        log.error("Request %s failed: %s", request["_id"], _one_line(exc))
    except Exception as exc:  # noqa: BLE001 - keep the worker alive
        fail(ctx, request, str(exc))
        log.exception("Unexpected failure on request %s: %s", request["_id"], _one_line(exc))
    return 1


def dry_run(ctx: Context) -> int:
    queued = list(ctx.requests.find({"status": "queued"}).sort("requestedAt", 1))
    log.info("Dry run: %d queued request(s)", len(queued))
    for request in queued:
        story = ctx.stories.find_one({"_id": request["storyId"]}, {"chapters": 1})
        count = len(sentences_for(story or {}, request["lang"]))
        log.info(
            "  request %s -> story %s (%s), %d sentence(s), attempts %d",
            request["_id"],
            request["storyId"],
            request["lang"],
            count,
            request.get("attempts", 0),
        )
    return 0


def ensure_audio_dir(path: Path) -> None:
    """Create the audio root and fail with an actionable message if it is not writable.

    hostPath directories are created by kubelet as root, while this container runs as
    uid 1000, so a missing `chown` only surfaces on the first write. Probe it up front.
    """
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write-probe"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
    except OSError as exc:
        raise TtsError(
            f"AUDIO_PATH {path} is not writable by uid {os.getuid()}: {exc}. "
            "On the node run: sudo mkdir -p <path> && sudo chown -R 1000:1000 <path>"
        ) from exc


def connect(mongo_uri: str) -> tuple[MongoClient, Database]:
    # A mis-keyed secret (e.g. the TTS key pasted into `mongodb-uri`) otherwise reaches
    # pymongo, which treats a bare string as a hostname and echoes it in a DNS error.
    if not mongo_uri.startswith(("mongodb://", "mongodb+srv://")):
        raise TtsError(
            "MONGODB_URI is not a MongoDB connection string (expected mongodb:// or "
            "mongodb+srv://). Check that the secret key named 'mongodb-uri' holds the "
            "Atlas URI and not another credential."
        )

    client: MongoClient = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000)
    client.admin.command("ping")
    return client, client.get_default_database()


def still_paused(ctx: Context) -> bool:
    return time.monotonic() < ctx.paused_until


def run(args: argparse.Namespace) -> int:
    if not args.mongo_uri:
        log.error("MONGODB_URI is not set (or pass --mongo-uri)")
        return 1
    if args.poll_interval <= 0:
        log.error("--poll-interval must be greater than zero")
        return 1

    audio_dir = Path(args.audio_dir)
    try:
        client, db = connect(args.mongo_uri)
    except TtsError as exc:
        log.error("%s", exc)
        return 1
    try:
        provider = build_provider(dry_run=args.dry_run)
        ctx = Context(db, audio_dir, provider, args)

        if args.dry_run:
            return dry_run(ctx)

        audio_dir.mkdir(parents=True, exist_ok=True)
        ensure_audio_dir(audio_dir)
        bootstrap(ctx)
        reconcile_renders(ctx)
        log.info(
            "Watching %s from %s (poll %.1fs, max attempts %d)",
            REQUESTS,
            audio_dir.resolve(),
            args.poll_interval,
            args.max_attempts,
        )

        def _request_stop(signum: int, _frame: Any) -> None:
            log.info("Received signal %s, shutting down after the current sentence", signum)
            ctx.stopping = True

        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)

        while not ctx.stopping:
            if still_paused(ctx):
                if args.once:
                    log.warning("Quota pause is active; exiting because --once was requested")
                    break
                time.sleep(min(1.0, max(0.0, ctx.paused_until - time.monotonic())))
                continue

            processed = run_once(ctx)
            if args.once and processed == 0:
                break
            if processed == 0:
                deadline = time.monotonic() + args.poll_interval
                while not ctx.stopping and time.monotonic() < deadline:
                    time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
    finally:
        client.close()

    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except KeyboardInterrupt:
        log.warning("Interrupted")
        return 130
    except Exception as exc:  # noqa: BLE001 - top-level guard for a long-running worker
        log.exception("Unexpected failure: %s", _one_line(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
