# StoryCreator - System Design

## Architecture Overview

StoryCreator is a bilingual story reading and writing platform. Users can author parallel-text stories (each sentence stored in two languages) and publish them for other learners to read. The application is a classic full-stack TypeScript monorepo: an Express.js REST API backed by MongoDB, serving a React SPA.

```
Browser
  └── React SPA (Webpack bundle in public/)
        └── /api/*  →  Express.js server (src/server.ts)
                            └── MongoDB Atlas (Mongoose)
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
- Authors write a **story seed** and optional per-chapter premises in the Story Editor.
- An optional **Story Characters** panel lets authors define the cast. Each entry has `name`, `role`, `description` and `appearance`. The cast is injected into every AI prompt (generation, chapter regeneration, and feedback patching) to keep characterization consistent.
- If the cast is left empty, the AI invents one and it is written back to the story after generation, so the author can review and refine it. Author-entered characters are never overwritten.
- `POST /api/stories/:id/generate` runs asynchronously (`generating: true`); the client polls `GET /api/stories/:id` until it completes.
- The Review page (`StoryReviewPage`) allows editing metadata, chapter premises and the cast, annotating individual sentences, applying feedback, regenerating a single chapter, and approving the story.
- AI-generated stories must be approved before they can be published.

---

## Data Models

### `Story`

| Field | Type | Notes |
|---|---|---|
| `title.lang1` | String | Title in native language |
| `title.lang2` | String | Title in learning language (filled in by AI generation) |
| `chapters` | `[{ seed, targetSentences, sentences: [{ lang1, lang2 }] }]` | Ordered chapters, each holding parallel sentence pairs |
| `characters` | `[{ name, role, description, appearance }]` | Author-defined cast used to keep AI output consistent |
| `seed` | String | Story premise used for AI generation (read-only during review) |
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
| `approved` | Boolean | Author approved the story after review |
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
    StoryReviewPage.tsx — AI review (feedback, regenerate, approve)
    StoryPreviewPage.tsx — Pre-publish preview
    StoryReadPage.tsx   — Bilingual reading view
    LoginPage.tsx
    RegisterPage.tsx
    ProfilePage.tsx     — Account details (username, email, member since, creator access)
    MyStoriesPage.tsx   — User's drafts + published stories
  utils/
    languages.ts     — Supported language list
```

## Backend Structure

```
src/
  server.ts           — Express app, middleware, startup
  config/
    database.ts       — Mongoose connection
  models/
    Story.ts          — Mongoose schema + IStory interface
    User.ts           — Mongoose schema + IUser interface
  routes/
    auth.ts           — /api/auth/* endpoints
    stories.ts        — /api/stories/* endpoints
  services/
    aiService.ts      — OpenAI prompts (generate / patch / regenerate)
  i18n.ts             — i18next config (client-side)
  locales/
    en.json
    fr.json
```

## Session Management

Sessions are stored in MongoDB (`connect-mongo`). The session cookie has a 7-day TTL (`maxAge: 7 days`), is `httpOnly`, and uses `sameSite: lax`. `touchAfter: 24 * 3600` prevents unnecessary session document writes on every request.

> For production, set `cookie.secure: true` and serve over HTTPS.
