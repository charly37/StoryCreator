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

### 2. **Story Lifecycle**
- Stories are created as drafts (`published: false`) and only visible to their author.
- Authors add and edit sentences in the Story Editor.
- Publishing (`POST /api/stories/:id/publish`) toggles the `published` flag, making the story visible in the public browse view.
- A story with no sentences cannot be published.

### 3. **Browse & Discovery**
- Public browse page lists all published stories with pagination (12 per page).
- Filters: native language, learning language, difficulty level, and free-text search (title + topic).

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
- The Review page (`StoryReviewPage`) allows editing metadata, chapter titles, premises and the cast, reviewing sentence output in read-only mode, regenerating a single chapter, regenerating the whole story, and publishing/unpublishing.

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
| `title.lang1` | String | Title in native language |
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
| `topic` | String | Optional free-text topic tag |
| `authorId` | ObjectId → User | |
| `authorName` | String | Denormalized for read performance |
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
    StoryPreviewPage.tsx — Pre-publish preview
    StoryReadPage.tsx   — Bilingual reading view
    LoginPage.tsx
    RegisterPage.tsx
    ProfilePage.tsx     — Account details (username, email, member since, creator access)
    ApiKeysSection.tsx  — Self-service API key create / reveal-once / revoke
    MyStoriesPage.tsx   — User's drafts + published stories
    AboutPage.tsx       — About (project story, GitHub link, creator-access note)
  utils/
    languages.ts     — Supported language list
```

## Backend Structure

```
src/
  server.ts           — Express app, middleware, startup
  config/
    database.ts       — Mongoose connection
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
    aiService.ts      — OpenAI prompts (generate / patch / regenerate)
    apiKeyService.ts  — Hashing, generation, lookup, last-used tracking
  i18n.ts             — i18next config (client-side)
  locales/
    en.json
    fr.json
```

## Session Management

Sessions are stored in MongoDB (`connect-mongo`). The session cookie has a 7-day TTL (`maxAge: 7 days`), is `httpOnly`, and uses `sameSite: lax`. `touchAfter: 24 * 3600` prevents unnecessary session document writes on every request.

> For production, set `cookie.secure: true` and serve over HTTPS.
