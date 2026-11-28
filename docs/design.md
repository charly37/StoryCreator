# StoryCreator - System Design

## Architecture Overview

StoryCreator is a bilingual story reading and writing platform. Users can author parallel-text stories (each sentence stored in two languages) and publish them for other learners to read. The application is a classic full-stack TypeScript monorepo: an Express.js REST API backed by MongoDB, serving a React SPA.

```
Browser
  └── React SPA (Webpack bundle in public/)
        └── /api/*     →  Express.js server (src/server.ts)
                            └── MongoDB Atlas (Mongoose)

External clients
  └── /api/v1/*  (API key)  →  same Express server, read-only
```

## Key Features

### 1. **Bilingual Stories**
- Every story has a title and an ordered list of sentences in two languages (`lang1` and `lang2`).
- `lang1` is the author's native language; `lang2` is the language being learned.
- Readers can toggle between languages sentence-by-sentence while reading.
- The reader also supports keyboard navigation: `←` / `→` move between sentences and `↑` / `↓` hide / reveal the native translation, mirroring the on-screen buttons. A caption under the navigation row advertises the shortcuts (hidden on small screens).

### 2. **Story Lifecycle**
- Stories are created as drafts (`published: false`) and only visible to their author.
- Authors add and edit sentences in the Story Editor.
- Publishing (`POST /api/stories/:id/publish`) toggles the `published` flag, making the story visible in the public browse view.
- A story with no sentences cannot be published.

### 3. **Browse & Discovery**
- Public browse page lists all published stories with pagination (12 per page).
- Filters: native language, learning language, difficulty level, and free-text search (title + labels).

### 4. **Internationalized UI**
- The interface itself supports English and French via i18next.
- Language preference is stored on the user account (`uiLanguage`) and persisted across sessions.
- The browser language is used as a fallback when no preference is stored.

### 5. **User Accounts**
- Session-based authentication (express-session backed by MongoDB via connect-mongo).
- Passwords hashed with bcryptjs (salt rounds: 12).
- Each user has a `uiLanguage` preference (`en` | `fr`).
- Story creation is restricted to accounts with `canCreateStories: true`. New accounts default to `false`; an administrator grants access directly in MongoDB (see [Granting creator access](SETUP.md#granting-creator-access)) — there is no self-service upgrade.

### 6. **AI Story Generation & Review**
- Authors write a **story seed**, optional per-chapter **premises**, and reader-facing bilingual chapter **titles** in the Story Editor.
- A chapter's `seed` is an authoring-only premise used for AI generation — it is never shown to readers, and is preserved across generation/regeneration. The reader-facing heading comes from the chapter's bilingual `title` (falling back to a localized "Chapter N" when empty).
- Authors may also provide an optional **AI writing guideline** (style/voice instruction). It is private authoring metadata, persisted on the story, reused for generation/regeneration, and never shown to readers.
- An optional **Story Characters** panel lets authors define the cast. Each entry has `name`, `role`, `description` and `appearance`. The cast is injected into every AI prompt (generation and chapter regeneration) to keep characterization consistent.
- If the cast is left empty, the AI invents one and it is written back to the story after generation, so the author can review and refine it. Author-entered characters are never overwritten.
- `POST /api/stories/:id/generate` runs asynchronously (`generating: true`); the client polls `GET /api/stories/:id` until it completes.
- **Model and thinking level.** The catalogue lives in `src/shared/aiModels.ts` and is imported by both the server and the client. `gpt-4o-mini` remains the default everywhere (schema defaults, service fallbacks, API defaults, agent) and the two premium entries (`gpt-5.6-luna`, `gpt-5.4-mini`) are strictly opt-in. `reasoning_effort` is sent only when the author explicitly chooses a level: an unset value omits the parameter, so existing stories keep the provider's default behaviour and cost. Reasoning calls use a separate request shape in `aiService.callJson` — no `temperature`/`top_p`/`logprobs`, plus a `max_completion_tokens` budget large enough to cover the hidden reasoning tokens.
- The Review page (`StoryReviewPage`) allows editing metadata, chapter titles, premises and the cast, reviewing sentence output in read-only mode, regenerating a single chapter, regenerating the whole story, and publishing/unpublishing.

- **Interactive staged mode (opt-in, website only).** Stories created with `generationMode: 'staged'` go through three explicit stages instead of one call:
  1. **Outline** — planning only: bilingual synopsis, cast, chapter titles and premises. No prose, so it is cheap enough to iterate on; the author edits the fields directly and discusses the next version with the AI in a chat. The chat is a planning partner: it asks clarifying questions, proposes concrete options, and maintains a short **brief** of the intent the author confirmed. “Adjust with AI” regenerates the plan from that brief (disabled until one exists). The transcript stays in the browser; the brief is what crosses to the server.
  2. **Chapters** — written one AI call per chapter, in order. Each call receives the synopsis plus the recaps of the chapters already written (bounded context — never the full text of earlier chapters).
  3. **Validation (optional)** — offered *after* the chapters exist, as a choice with its cost in AI calls: skip, deterministic checks (free), or one AI review call per chapter. Findings are stored per chapter in `chapters[].issues`.
  - `stage` tracks the position (`setup` → `outline` → `chapters` → `validation` → `ready`); `generating` still means "a job is running in this stage".
  - UI: `/create` starts a story, `/create/:id` resumes one (the wizard is resumable from My Stories).
  - `POST /api/v1/stories` and `POST /api/stories/:id/generate` stay **one-shot**; the public API pins `generationMode: 'quick'`.
  - Robustness: staged jobs write with targeted `updateOne` calls (never a full `save()` on a document read minutes earlier, which would clobber author edits), and a heartbeat (`generatingSince`) lets `GET /api/stories/:id` release a job whose process died (`GENERATION_STALL_MINUTES`, default 15).

### 7. **Public API & API Keys**
- Accounts with `canCreateStories` create up to **5** API keys from **Profile → API keys**.
- Raw keys are shown exactly once. Only a SHA-256 hash and a non-secret, indexed prefix are stored.
- `/api/v1` is key-authenticated (`Authorization: Bearer`):
  - `stories:read` — list, detail and metadata for **published** stories.
  - `stories:write` (opt-in per key, always paired with read) — `POST /api/v1/stories` creates a draft from a seed and starts the same AI generation pipeline as the website. Generation runs asynchronously; clients poll `GET /api/v1/stories/:id`, where write-scoped owners can see their own drafts plus a `status` block (`generating` / `ready` / `failed`).
- `published: true` at creation defers publishing until generation produces content. There is no update/delete/publish surface over the API.
- `Idempotency-Key` on create prevents duplicate paid AI calls on retries.
- Responses are built by an explicit allow-list serializer, so authoring metadata (`seed`, `aiGuideline`, `characters`, `authorId`, `generating` outside the owner status block, AI counters) is never exposed publicly.
- Requests are rate limited per key (`PUBLIC_API_RATE_LIMIT_PER_MIN`, default 60/min) and CORS is open for `GET`/`POST` so browser-based tools can call it.
- The session-based `/api/*` surface is unchanged; v1 is additive and breaking changes ship as `/api/v2`.
- See [PUBLIC_API.md](PUBLIC_API.md).

---

## Data Models

### `Story`

| Field | Type | Notes |
|---|---|---|
| `title.lang1` | String | Title in native language (optional — AI-generated when blank) |
| `title.lang2` | String | Title in learning language (filled in by AI generation) |
| `chapters` | `[{ title: { lang1, lang2 }, seed, targetSentences, sentences: [{ lang1, lang2 }] }]` | Ordered chapters, each holding a reader-facing bilingual title, an authoring-only premise, and parallel sentence pairs |
| `characters` | `[{ name, role, description, appearance }]` | Author-defined cast used to keep AI output consistent |
| `seed` | String | Story premise used for AI generation (read-only during review); the per-chapter `seed` is likewise an authoring-only premise never shown to readers |
| `aiGuideline` | String | Optional private writing-style guideline applied to generation and chapter regeneration |
| `targetChapters` | Number | Planned chapter count (1–10) |
| `sentenceCount` | Number | Auto-computed pre-save hook |
| `nativeLanguage` | String | e.g. `"en"`, `"fr"` |
| `learningLanguage` | String | Must differ from `nativeLanguage` |
| `level` | Enum | `beginner` \| `intermediate` \| `advanced` |
| `labels` | `string[]` | Optional free-text labels |
| `authorId` | ObjectId → User | |
| `authorName` | String | Denormalized for read performance |
| `creationSource` | Enum | `ui` \| `api` (set at creation time) |
| `createdViaApiKeyName` | String | Snapshot of the API key name when `creationSource = api` |
| `published` | Boolean | Default `false` |
| `generating` | Boolean | True while an async AI job is running |
| `isAIGenerated` | Boolean | Set once AI generation completes |
| `createdAt` / `updatedAt` | Date | Managed by Mongoose `timestamps` |

Indexes: `{ nativeLanguage, learningLanguage, published }` (compound for browse queries), `{ authorId }` (for "my stories").

### `User`

| Field | Type | Notes |
|---|---|---|
| `username` | String | Unique, 3–30 chars |
| `email` | String | Unique, lowercased |
| `password` | String | bcrypt hash |
| `uiLanguage` | Enum | `en` \| `fr`, default `en` |
| `canCreateStories` | Boolean | Default `false`; grants access to story creation and the AI authoring endpoints |
| `createdAt` | Date | |

### `ApiKey`

| Field | Type | Notes |
|---|---|---|
| `name` | String | User-supplied label, 1–50 chars |
| `prefix` | String | First 17 characters of the key, unique, indexed |
| `keyHash` | String | SHA-256 hex digest, unique, `select: false` |
| `ownerId` | ObjectId → User | Indexed |
| `scopes` | `[String]` | Default `["stories:read"]` |
| `lastUsedAt` | Date | Updated at most once every 5 minutes per key |
| `createdAt` / `updatedAt` | Date | Managed by Mongoose `timestamps` |

Keys are revoked by hard delete; the raw secret is never persisted.

### `TtsRequest`

Text-to-speech queue. One document per `(story, lang)` pair; the collection **is** the job queue
(no external broker). The website creates the document, the worker owns the pipeline fields.

| Field | Type | Notes |
|---|---|---|
| `storyId` | ObjectId → Story | Indexed |
| `lang` | Enum | `lang1` \| `lang2` — one voice track per language |
| `status` | Enum | `queued` \| `processing` \| `done` \| `failed` |
| `phase` | Enum | `synthesize` \| `render` \| `done` |
| `requestedBy` | ObjectId → User | Indexed |
| `attempts` | Number | Incremented on every claim; capped by `TTS_MAX_ATTEMPTS` |
| `error` | String | Empty while queued |
| `storyHash` | String | sha256 over both language tracks, written at claim time |
| `clips` | `[{ chapterIndex, sentenceIndex, key }]` | Per-sentence manifest of content-addressed clips |
| `progress` | `{ done, total }` | Sentences synthesized so far |
| `startedAt` / `finishedAt` | Date | |
| `requestedAt` | Date | Used to order the queue (oldest first) |
| `createdAt` / `updatedAt` | Date | Managed by Mongoose `timestamps` |

Indexes: `{ storyId, lang }` **unique** (makes `POST` an idempotent upsert and doubles as
"regenerate") and `{ status, requestedAt }` (worker poll order).

### `TtsRender`

Derived, disposable audio artifacts — one row per story version and variant. Re-rendering a changed
story inserts new rows rather than overwriting, so the API can serve the newest row per variant and
stale audio falls out of the UI by itself.

| Field | Type | Notes |
|---|---|---|
| `storyId` | ObjectId → Story | Indexed |
| `storyHash` | String | Version of the story text the render was built from |
| `variant` | Enum | `lang1` \| `lang2` \| `bilingual` |
| `key` | String | Path relative to `AUDIO_PATH` |
| `durationMs` / `sizeBytes` | Number | Measured during assembly |
| `createdAt` / `updatedAt` | Date | |

Index: `{ storyId, storyHash, variant }` **unique** (the worker upserts on it).

---

## Frontend Structure

```
src/client/
  index.tsx          — React entry point, i18n init
  App.tsx            — Router, theme, auth state
  components/
    Header.tsx       — Top navigation bar
    LandingPage.tsx  — Home / hero page
    StoriesPage.tsx  — Public browse with filters
    StoryEditorPage.tsx — Story editor (seed, chapters, characters)
    StoryReviewPage.tsx — AI review (chapter/story regenerate, publish/unpublish)
    StoryPreviewPage.tsx — Pre-publish preview (wraps StoryReader)
    StoryReadPage.tsx   — Bilingual reading view (wraps StoryReader)
    StoryReader.tsx     — Shared reader UI: sentence nav, keyboard shortcuts,
                          translation toggles, chapter jumps, progress
    LoginPage.tsx
    RegisterPage.tsx
    ProfilePage.tsx     — Account details (username, email, member since, creator access)
    ApiKeysSection.tsx  — Self-service API key create / reveal-once / revoke
    MyStoriesPage.tsx   — User's drafts + published stories
    AboutPage.tsx       — About (project story, GitHub link, creator-access note)
  utils/
    languages.ts     — Supported language list
```

### Responsive / mobile conventions

The UI is CSS-only responsive (`sx` objects); there are **no `useMediaQuery` hooks for layout** and no
JS-driven layout switches. Breakpoints are MUI defaults: `sm` (600 px) and `md` (900 px).

- **Navigation (`Header.tsx`)**: a single `navItems` array feeds both the desktop `Button` cluster
  (`display: { xs: 'none', md: 'flex' }`) and the mobile left `SwipeableDrawer` (280 px), opened by a
  hamburger `IconButton` (`display: { xs: 'block', md: 'none' }`). Every drawer row closes the drawer
  before navigating. `md` is the only nav switch point.
- **Headers / action rows**: never use a bare `justify-content: space-between` row. Add `flexWrap: 'wrap'`
  (and `gap`), and `flexDirection: { xs: 'column', sm: 'row' }` when the row holds buttons.
- **Fixed widths**: replace `minWidth: 220` with `minWidth: { xs: '100%', sm: 220 }` and
  `width: 140` with `width: { xs: '100%', sm: 140 }` so form controls fill the row on phones.
- **Padding**: page shells use `pt: { xs: 9, md: 10 }` (56 px AppBar on xs, 64 px on `sm+`), and papers use
  `p: { xs: 2, sm: 3 }`.
- **Typography**: `h3`/`h4`/`h5` scale down below `sm` via media queries in the theme (`App.tsx`).
- **Tabs**: use `variant="scrollable" allowScrollButtonsMobile` (never let tabs squeeze).
- **Buttons**: `width: { xs: '100%', sm: 'auto' }` inside a stacked action row.
- **Input mode**: layout stays CSS-only, but *interaction* may adapt to the device's input. The single
  allowed media query is `useTouchInput()` (`src/client/utils/useTouchInput.ts`, `(any-pointer: coarse)`).
  `StoryReader` uses it to offer gestures on phones/tablets and keyboard hints on desktop: a horizontal
  swipe ≥ 50 px (1.5:1 axis dominance, < 800 ms) changes sentence, a tap (≤ 10 px, < 400 ms) toggles the
  translation. Mouse input, the arrow keys and the Previous/Next buttons are unaffected.
- **Gesture surface**: the sentence card sets `touchAction: 'pan-y pinch-zoom'`. Without it Android claims
  every horizontal drag for scrolling and fires `pointercancel`, so `pointerup` never arrives and swipes
  are silently dropped. Gestures still never call `preventDefault`, so vertical scrolling and pinch-zoom
  keep working. The handler also treats `pointercancel` as an end-of-gesture (using the last
  `pointermove` position, tap disabled) and ignores gestures starting within 24 px of a screen edge so the
  Android back-gesture / iOS edge-swipe-back don't hijack "swipe right = previous sentence".
- **Testing gestures**: synthetic `PointerEvent`s do **not** reproduce browser touch-action arbitration —
  verify with real touch input (Chrome DevTools device mode, or CDP `Emulation.setTouchEmulationEnabled`
  + `Input.dispatchTouchEvent`).

Verify changes at 360–375 px: `document.body.scrollWidth` must not exceed `window.innerWidth`, and repeat
the check in `fr` (French strings are 15–25 % longer).

## Backend Structure

```
src/
  server.ts           — Express app, middleware, startup
  config/
    database.ts       — Mongoose connection
    logger.ts         — pino logger (JSON, redaction, LOG_LEVEL, child loggers)
  middleware/
    requireApiKey.ts  — Bearer/X-API-Key auth for /api/v1
  models/
    Story.ts          — Mongoose schema + IStory interface
    User.ts           — Mongoose schema + IUser interface
    ApiKey.ts         — Hashed API keys (prefix + SHA-256 hash)
  routes/
    auth.ts           — /api/auth/* endpoints
    stories.ts        — /api/stories/* endpoints
    apiKeys.ts        — /api/keys/* (session-authenticated key management)
    publicApi.ts      — /api/v1/* (key-authenticated, read-only)
  serializers/
    publicStory.ts    — Allow-list shaping for public story responses
  services/
    aiService.ts      — OpenAI prompts (one-shot generate / regenerate; staged outline / chapter / review / planning chat)
    storyGenerationService.ts — Job orchestration (one-shot + staged: outline, chapters, validation)
    outlineChatService.ts — Synchronous rewrite-planning chat (context assembly, no job, aiCallCount)
    storyJobService.ts — Single-flight job guard, targeted writes, stall sweep, sentence recount
    apiKeyService.ts  — Hashing, generation, lookup, last-used tracking
  i18n.ts             — i18next config (client-side)
  locales/
    en.json
    fr.json
```

## Session Management

Sessions are stored in MongoDB (`connect-mongo`). The session cookie has a 7-day TTL (`maxAge: 7 days`), is `httpOnly`, and uses `sameSite: lax`. `touchAfter: 24 * 3600` prevents unnecessary session document writes on every request.

> For production, set `cookie.secure: true` and serve over HTTPS.

## Logging

The backend logs with **pino** (`src/config/logger.ts`) to stdout as one JSON
object per line, which Docker/Kubernetes log collection forwards to
VictoriaLogs unchanged. There are no HTTP access logs: `pino-http` is mounted
with `autoLogging: false` and only attaches a request id (`req.id`, echoed in the
`X-Request-Id` response header) and a request-scoped logger (`req.log`) so error
records can be correlated.

Records use string `level`, ISO `time`, `msg`, and `service`, plus `module`,
`req.id`, `storyId`, and a serialized `err` where relevant. Credentials
(`Authorization`, `X-API-Key`, cookies, passwords) are removed by redaction
rules; request bodies and API keys are never logged. `LOG_LEVEL` controls
verbosity (`debug` in development, `info` in production, `silent` when
`NODE_ENV=test`).

See [LOGGING.md](LOGGING.md) for the record schema, the complete list of logged
events, the Helm `app.logLevel` setting, and the VictoriaLogs collector
configuration (vlagent, Fluent Bit, Vector).

## Audio Requests

Narrated audio is queued in MongoDB rather than through a message broker: the `ttsrequests`
collection holds one document per `(story, language)`, and the author submits a request from the
My Stories list or the Review page (`POST /api/tts-requests`). Both entry points require author
ownership plus `canCreateStories`.

A long-running `Deployment` (`<release>-tts-worker`, disabled by default via `ttsWorker.enabled`)
runs `TtsWorker/TtsWorker.py` from the `charly37/storycreator-scripts` image (built from
`pythonDockerBaseImage/Dockerfile`). A Deployment rather than a CronJob is deliberate: audio is
demand-driven, so the worker must pick up a request within seconds, not at the next schedule tick.

The worker synthesizes **one clip per sentence** (content-addressed at
`clips/{voiceId}/{sha256(text)}.mp3`, so re-runs and resumes are free) and assembles three renders
with pydub: `lang1`, `lang2`, and `bilingual`, which interleaves the pair sentence by sentence with
the native language first. Clips are normalized to −16 LUFS and the mix is peak-normalized, following
`PortugueseLearning/vocal_lesson_creator/combine_mp3.py`. Files live on a `hostPath` volume that the
app mounts read-only and the worker mounts read-write; delivery is the gated
`GET /api/stories/:id/audio/:variant` route, so a draft's audio stays author-only.

Recovery is intentionally minimal: no heartbeat, no lease, no sweeper. On startup the worker requeues
documents left in `processing`, and because clips are content-addressed a restart resumes at the first
missing sentence. That is only safe with `replicas: 1`. See [TTS_WORKER.md](TTS_WORKER.md).
