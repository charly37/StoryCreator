# API Reference

All endpoints are prefixed with `/api`. The server returns JSON for all responses.

> For external integrations use the keyed **[Public API v1](PUBLIC_API.md)** (`/api/v1`) instead of the session-based endpoints below. It requires an API key, exposes published stories, and can create stories with AI when the key has the `stories:write` scope.

Authentication is session-based — the browser cookie is sent automatically. Endpoints marked **Auth required** return `401` if the session has no `userId`.

Some endpoints additionally require **creator access** — the user document must have `canCreateStories: true`. These endpoints return:

| Status | Body | Description |
|---|---|---|
| `403` | `{ "message": "Creator access required", "code": "CREATOR_ACCESS_REQUIRED" }` | The account lacks the `canCreateStories` permission |

New accounts default to `canCreateStories: false`. The permission is granted out-of-band — see [Granting creator access](SETUP.md#granting-creator-access). It is checked against the database on every gated request, so revocation takes effect immediately (no re-login required).

---

## Authentication — `/api/auth`

All auth responses that return a `user` use the same shape:

```json
{
  "id": "...",
  "username": "alice",
  "email": "alice@example.com",
  "uiLanguage": "en",
  "canCreateStories": false,
  "createdAt": "..."
}
```

### `POST /api/auth/register`

Register a new user. The user is logged in immediately on success.

**Body**

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "secret123",
  "uiLanguage": "en"
}
```

| Field | Required | Notes |
|---|---|---|
| `username` | yes | 3–30 characters, unique |
| `email` | yes | Unique, lowercased |
| `password` | yes | Minimum 6 characters |
| `uiLanguage` | no | `"en"` or `"fr"`, defaults to `"en"` |

**Responses**

| Status | Description |
|---|---|
| `201` | User created; returns `{ message, user }` |
| `400` | Validation failure or duplicate username / email |
| `500` | Server error |

---

### `POST /api/auth/login`

**Body**

```json
{ "email": "alice@example.com", "password": "secret123" }
```

**Responses**

| Status | Description |
|---|---|
| `200` | Login successful; returns `{ message, user }` |
| `400` | Missing fields |
| `401` | Invalid email or password |
| `500` | Server error |

---

### `POST /api/auth/logout`

Destroys the session. No body required.

**Responses:** `200` with `{ message: "Logged out successfully" }`, or `500` on error.

---

### `GET /api/auth/check-auth`

Returns the currently authenticated user, used by the React app on startup to restore state.

**Responses**

| Status | Description |
|---|---|
| `200` | Returns `{ user }` |
| `401` | Not authenticated |

---

### `POST /api/auth/update-language`

Persists the logged-in user's UI language preference (used by the header language toggle, keeping it in sync with the Profile page).

**Body:** `{ "uiLanguage": "en" | "fr" }`

**Responses**

| Status | Description |
|---|---|
| `200` | Returns `{ uiLanguage }` |
| `400` | Invalid or missing `uiLanguage` |
| `401` | Authentication required |
| `404` | User not found |

---

## Stories — `/api/stories`

### `GET /api/stories`

Browse published stories with optional filters and pagination.

**Query parameters**

| Param | Description |
|---|---|
| `nativeLang` | Filter by native language code (e.g. `en`) |
| `learningLang` | Filter by learning language code (e.g. `fr`) |
| `level` | `beginner`, `intermediate`, or `advanced` |
| `search` | Full-text search on title (both languages) and labels |
| `page` | Page number, default `1` (12 results per page) |

**Response `200`**

```json
{
  "stories": [...],
  "total": 42,
  "page": 1,
  "pages": 4
}
```

Story objects in list views omit the `sentences` array for performance.

Publisher attribution notes:
- Stories created from the website have `creationSource: "ui"`.
- Stories created through `/api/v1/stories` have `creationSource: "api"` and include `createdViaApiKeyName`.
- UI surfaces can use those fields to display an API attribution badge while keeping `authorName` unchanged.

---

### `GET /api/stories/mine`

*Auth required.* Returns all stories (published and draft) belonging to the authenticated user, sorted by `updatedAt` descending. Sentences are excluded.

---

### `GET /api/stories/:id`

Returns a single story including all sentences.

- Returns `404` if not found.
- Returns `403` if the story is unpublished and the requester is not the author.

---

### `POST /api/stories`

*Auth required. Creator access required.* Create a new story.

**Body**

```json
{
  "title": { "lang1": "The Cat", "lang2": "Le Chat" },
  "nativeLanguage": "en",
  "learningLanguage": "fr",
  "level": "beginner",
  "labels": ["animals", "friendship"],
  "seed": "A cat who learns to sail.",
  "characters": [
    {
      "name": "Milo",
      "role": "protagonist",
      "description": "A curious young cat who dreams of the sea",
      "appearance": "Ginger tabby with a white paw and a chipped ear"
    }
  ],
  "targetChapters": 2,
  "chapters": [
    {
      "title": { "lang1": "Milo discovers the harbour", "lang2": "Milo découvre le port" },
      "seed": "Milo discovers the harbour",
      "targetSentences": 12
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title.lang1` | no | Optional — when blank the AI generates both title languages |
| `title.lang2` | no | Usually filled in by AI generation |
| `nativeLanguage` | yes | Must differ from `learningLanguage` |
| `learningLanguage` | yes | |
| `level` | yes | `beginner` / `intermediate` / `advanced` |
| `labels` | no | Array of free-text labels (deduplicated, max 20) |
| `topic` | no | Legacy single-label alias; converted into `labels` when provided |
| `seed` | no | Story premise used for AI generation |
| `aiGuideline` | no | Private writing-style guideline reused for generation/regeneration |
| `characters` | no | Array of `{ name, role, description, appearance }`; blank names are dropped, max 20 |
| `targetChapters` | no | Planned chapter count (1–10, default 1) |
| `chapters` | no | Array of `{ title: { lang1, lang2 }, seed, targetSentences }`; defaults to `targetChapters` empty chapters |
| `generationMode` | no | `quick` (default, one-shot) or `staged` (interactive wizard) |
| `outlineAiModel` | no | Model used for the outline stage when `generationMode: "staged"` |
| `synopsis` | no | `{ lang1, lang2 }` outline summary; normally produced by the outline stage |

Each chapter carries a reader-facing bilingual `title` and a private `seed`. The `seed` is only an AI authoring premise — it is **never shown to readers** and is preserved across generation/regeneration. `aiGuideline` is also private authoring metadata, used to steer writing style during generation/regeneration and never shown to readers. When a chapter `title` is empty the reader falls back to a localized "Chapter N" heading.

The story `title` is optional. Leave `title.lang1` blank and AI generation produces a bilingual title (like chapter titles); a provided `title.lang1` is preserved and the AI translates it for `title.lang2`.

Website-created stories default to `creationSource: "ui"`.

**Response `201`:** The created story object.

Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.

---

### `POST /api/stories/:id/clone`

*Auth required. Creator access required.* Deep-copy an existing story into a new draft owned by the authenticated user.

- You may clone your own stories (drafts or published) or any **published** story by another author. Cloning another user's draft returns `403`.
- Copies `title` (with `" (copy)"` appended to `title.lang1` when non-empty; a blank title stays blank so the AI can generate one), `chapters` (including chapter titles and sentences), `characters`, `nativeLanguage`, `learningLanguage`, `level`, `labels`, `seed`, and `targetChapters`.
- The clone always starts as a draft (`published: false`). `isAIGenerated` is copied from the source.
- Returns `400` if the source story is still generating.

**Response `201`:** The newly created story object.

Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.

---

### `PUT /api/stories/:id`

*Auth required. Author only.* Update story fields. All fields are optional — only supplied fields are updated.

**Body:** Same shape as `POST /api/stories`.

**Response `200`:** The updated story object.

---

### `POST /api/stories/:id/chapters`

*Auth required. Author only.* Insert a new empty chapter at a given position without disturbing existing chapters or their sentences.

**Body:** `{ index?: number, title?: { lang1, lang2 }, seed?: string, targetSentences?: number }`

- `index` is the 0-based insertion point. Omit it (or send a non-number) to append at the end; out-of-range values are clamped to `[0, chapterCount]`.
- The server splices the chapter into the array, so every following chapter — and its sentences — shifts together; the new chapter starts with no sentences.
- Returns `400` when the story already has the maximum of 10 chapters.

**Response `201`:** The updated story object.

---

### `DELETE /api/stories/:id/chapters/:index`

*Auth required. Author only.* Remove a single chapter (and its sentences) by 0-based index.

- Returns `400` for an invalid `index` or when it would leave the story with zero chapters (a story must keep at least one).
- The server splices the chapter out, so remaining chapters and their sentences shift together. `targetChapters` and `sentenceCount` are recalculated.

**Response `200`:** The updated story object.

---

### `DELETE /api/stories/:id`

*Auth required. Author only.* Permanently delete a story.

**Response `200`:** `{ message: "Story deleted" }`

---

### `POST /api/stories/:id/publish`

*Auth required. Author only.* Toggle the `published` flag on a story.

- Returns `400` if attempting to publish a story with no sentences.

**Response `200`:** `{ published: true | false }`

---

### `POST /api/stories/:id/generate`

*Auth required. Author only. Creator access required.* Start asynchronous AI generation of the story's chapters.

- Requires a non-empty `seed`; returns `400` otherwise.
- Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.
- Responds immediately with `202`; the job runs in the background and sets `generating: true` while running.
- The story's `characters` are sent to the AI as the cast. If the cast was empty, the AI's invented cast is written back to `characters` after generation; author-entered characters are preserved.
- The story's `aiGuideline` is injected as writing-style guidance when provided.
- Each chapter gets a short bilingual `title` from the AI. Author-provided chapter `seed` values are preserved; the AI's seed is only stored where the author left it blank.
- When the story `title` is blank, the AI generates it in both languages; author-provided title values are preserved.

**Response `202`:** `{ message, storyId }`

### `POST /api/stories/:id/regenerate-chapter`

*Auth required. Author only. Creator access required.* Regenerate a single chapter, optionally updating other chapters for coherence.

**Body:** `{ chapterIndex, generalFeedback? }`

- Returns `400` for an invalid `chapterIndex`.
- Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.
- Story `characters` are included as consistency context.
- The story's `aiGuideline` is included as style guidance when provided.
- Regenerated chapters receive updated bilingual `title`s; an author-provided chapter `seed` is preserved when non-empty.
- Responds `202` and runs the job in the background.

## Staged (interactive) authoring

Additive, opt-in endpoints used by the `/create` wizard. They only accept stories with
`generationMode: "staged"`; all other stories get `400 { code: "NOT_STAGED" }`. Model ids are
validated against the same catalogue as `/api/v1`, and every model route also accepts an optional
`effort` (`none`…`max`) that must be supported by the chosen model — an unsupported pair returns
`400 INVALID_MODEL` rather than being clamped.

Each endpoint returns `202` and runs in the background (`generating: true`). While running,
`GET /api/stories/:id` reports `stage`, `jobProgress: { stage, done, total, currentLabel }` and
`generationError`. The job heartbeat is `generatingSince`: if it goes quiet for
`GENERATION_STALL_MINUTES` (default 15) the flag is cleared on the next read.

### `POST /api/stories/:id/outline`

*Auth + creator access + author.* Stage 1 — plan the story (bilingual synopsis, cast, chapter
titles/premises). Writes no prose.

**Body:** `{ model?, effort?, feedback? }` — `feedback` switches the call into "adjust the current plan"
and is capped at 4000 characters.

Returns `400` when the seed is blank or the story has no chapters.

### `POST /api/stories/:id/outline/chat`

*Auth + creator access + author.* Synchronous **rewrite-planning discussion**. Unlike the stage
endpoints below, it runs no job: `generating` stays `false` and there is no `202`.

**Body:** `{ messages: [{ role: "user" | "assistant", content }], mode?: "chat" | "review", model?, effort?, locale? }`

- The transcript lives **client-side only** (nothing is persisted); the server caps it at 20 messages
  of 2000 characters each.
- Returns `200 { reply, brief }`. `reply` is the message shown to the author, written in `locale`
  (`en` fallback, `fr` supported). `brief` is a short structured summary of the **intent the author
  actually confirmed** for the next version — empty until a change is agreed. The client sends it as
  `feedback` when it calls `/outline`.
- `mode: "review"` asks for proactive improvement ideas and questions after a plan is produced; it
  always returns `brief: ""` because suggestions are not accepted changes.

Returns `409 { code: "STORY_GENERATING" }` while a job runs, `400 { code: "OUTLINE_REQUIRED" }`
before any outline exists, and `400 { code: "INVALID_MESSAGES" }` when `mode` is `chat` and no usable
message is provided.

### `POST /api/stories/:id/generate-chapters`

*Auth + creator access + author.* Stage 2 — write the approved outline one chapter at a time, in
order, each fed the synopsis plus the recaps of the previous chapters. Also sets
`outline.approvedAt`.

**Body:** `{ model? }`

Returns `400 { code: "OUTLINE_REQUIRED" }` when no outline exists yet.

### `POST /api/stories/:id/validate`

*Auth + creator access + author.* Stage 3 (optional) — quality checks after the chapters exist.

**Body:** `{ mode: "basic" | "ai_review" | "none", model? }`

- `basic` — free deterministic checks (sentence count vs target, duplicate pairs, identical
  translations, length mismatch).
- `ai_review` — the above plus one AI review call per chapter.
- `none` — mark the story `ready` immediately, no AI call.

Findings are stored per chapter in `chapters[].issues` and shown on the review page.

### `POST /api/stories/:id/reset-outline`

*Auth + creator access + author.* Return to stage `outline` and clear `outline.approvedAt` so the
plan can be re-iterated. Keeps existing chapters and sentences. Returns `409` while a job runs.

## API Keys — `/api/keys`

Self-service API keys for the [public API](PUBLIC_API.md). All endpoints are **auth required** and only operate on the current user's keys. `POST` additionally requires **creator access**.

The raw key is returned exactly once, on creation. Only a SHA-256 hash and a non-secret prefix are stored.

### `GET /api/keys`

List the current user's keys, newest first.

**Response `200`:**

```json
{
  "keys": [
    {
      "id": "66f1c2...",
      "name": "My reading app",
      "prefix": "stc_live_AbCdEfGh",
      "scopes": ["stories:read"],
      "createdAt": "2026-10-17T09:12:00.000Z",
      "lastUsedAt": null
    }
  ],
  "maxKeys": 5
}
```

### `POST /api/keys`

*Auth required. Creator access required.*

**Body:** `{ "name": "My reading app", "writeAccess": false }` — `name` is required, trimmed, 1–50 characters. `writeAccess` is optional (default `false`); when `true` the key receives both `stories:read` and `stories:write`.

- Returns `400` when the name is missing, blank or too long.
- Returns `400` with `code: "API_KEY_LIMIT_REACHED"` when the account already has 5 keys.
- Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.

**Response `201`:**

```json
{
  "key": "stc_live_...",
  "apiKey": { "id": "...", "name": "My reading app", "prefix": "stc_live_AbCdEfGh", "scopes": ["stories:read", "stories:write"], "createdAt": "...", "lastUsedAt": null },
  "warning": "Store this key now. It cannot be retrieved again."
}
```

### `DELETE /api/keys/:id`

*Auth required. Owner only.* Revoke a key by deleting it. Returns `204` on success, or `404` when the id is invalid or belongs to another user.

## Text-to-Speech Requests — `/api/tts-requests`

Queue for narrated audio. The Python worker described in [TTS_WORKER.md](TTS_WORKER.md) synthesizes
one clip per sentence and assembles three renders — `lang1`, `lang2` and a sentence-interleaved
`bilingual` version.

One document exists per **(story, language)** pair, so a bilingual story queues two entries (`lang1`
and `lang2`). Posting the same pair again re-queues the existing document and resets its attempts
instead of creating a duplicate.

### `POST /api/tts-requests`

*Auth required. Creator access required.*

**Body**

```json
{ "storyId": "66f1c2...", "languages": ["lang1", "lang2"] }
```

| Field | Required | Notes |
|---|---|---|
| `storyId` | yes | Must be a story owned by the caller |
| `languages` | no | Non-empty subset of `lang1`, `lang2`; defaults to both |

**Responses**

| Status | Description |
|---|---|
| `202` | Queued; returns `{ message, requests: [{ id, storyId, lang, status, requestedAt }] }` |
| `400` | `INVALID_STORY_ID`, `INVALID_LANGUAGES`, or `NO_CHAPTERS` (story has no sentences) |
| `401` | Authentication required |
| `403` | Not the author, or `CREATOR_ACCESS_REQUIRED` |
| `404` | Story not found |

### `GET /api/tts-requests?storyIds=a,b,c`

*Auth required.* Batched status lookup for the caller's own requests. At most 50 ids per call.

**Response `200`**

```json
{
  "data": [
    {
      "id": "...",
      "storyId": "...",
      "lang": "lang1",
      "status": "processing",
      "phase": "synthesize",
      "progress": { "done": 12, "total": 40 },
      "error": "",
      "requestedAt": "..."
    }
  ]
}
```

`status` moves `queued` → `processing` → `done`, or `failed` on a terminal error. `phase` is
`synthesize`, `render` or `done`. A quota failure puts the request back to `queued` with
`error: "QUOTA_EXCEEDED"` instead of burning an attempt.

Returns `400` with `INVALID_STORY_ID` or `TOO_MANY_IDS` for malformed input.

## Story Audio — `/api/stories/:id/audio`

Playback endpoints for the renders. Both apply the **same visibility rule as `GET /api/stories/:id`**:
a draft's audio is author-only, a published story's audio is readable by anyone.

### `GET /api/stories/:id/audio`

Lists the newest render of each variant for the story.

**Response `200`**

```json
{
  "storyId": "...",
  "variants": [
    {
      "variant": "lang1",
      "durationMs": 312400,
      "sizeBytes": 5012233,
      "createdAt": "...",
      "url": "/api/stories/.../audio/lang1"
    }
  ]
}
```

`variants` is empty until the worker finishes; it is not an error.

### `GET /api/stories/:id/audio/:variant`

Streams the audio file. `variant` is `lang1`, `lang2` or `bilingual`. Supports `ETag`,
`Last-Modified` and **HTTP Range** (206), so seeking works in an `<audio>` element.

| Status | Description |
|---|---|
| `200` / `206` | Audio bytes (`audio/mpeg`) |
| `400` | `INVALID_VARIANT` or `INVALID_STORY_ID` |
| `403` | Draft belonging to another user |
| `404` | `AUDIO_NOT_READY` (nothing rendered yet) or `AUDIO_MISSING` (row exists, file gone) |

## Health Check

### `GET /api/health`

Returns `{ status: "ok" }`. Used by load balancers and monitoring probes.
