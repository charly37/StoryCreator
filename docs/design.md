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

---

## Data Models

### `Story`

| Field | Type | Notes |
|---|---|---|
| `title.lang1` | String | Title in native language |
| `title.lang2` | String | Title in learning language |
| `sentences` | `[{ lang1, lang2 }]` | Ordered sentence pairs |
| `sentenceCount` | Number | Auto-computed pre-save hook |
| `nativeLanguage` | String | e.g. `"en"`, `"fr"` |
| `learningLanguage` | String | Must differ from `nativeLanguage` |
| `level` | Enum | `beginner` \| `intermediate` \| `advanced` |
| `topic` | String | Optional free-text topic tag |
| `authorId` | ObjectId → User | |
| `authorName` | String | Denormalized for read performance |
| `published` | Boolean | Default `false` |
| `createdAt` / `updatedAt` | Date | Managed by Mongoose `timestamps` |

Indexes: `{ nativeLanguage, learningLanguage, published }` (compound for browse queries), `{ authorId }` (for "my stories").

### `User`

| Field | Type | Notes |
|---|---|---|
| `username` | String | Unique, 3–30 chars |
| `email` | String | Unique, lowercased |
| `password` | String | bcrypt hash |
| `uiLanguage` | Enum | `en` \| `fr`, default `en` |
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
    StoryEditorPage.tsx — Draft editor (sentence CRUD)
    StoryReadPage.tsx   — Bilingual reading view
    LoginPage.tsx
    RegisterPage.tsx
    ProfilePage.tsx
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
  i18n.ts             — i18next config (client-side)
  locales/
    en.json
    fr.json
```

## Session Management

Sessions are stored in MongoDB (`connect-mongo`). The session cookie has a 7-day TTL (`maxAge: 7 days`), is `httpOnly`, and uses `sameSite: lax`. `touchAfter: 24 * 3600` prevents unnecessary session document writes on every request.

> For production, set `cookie.secure: true` and serve over HTTPS.
