# StoryCreator - AI Agent Guide

## Documentation Structure

This project follows a **lean README + detailed docs** pattern:

- **[README.md](../README.md)**: Short overview with Quick Start + features + links to docs
- **[docs/](../docs/)**: All detailed documentation organized by topic:
  - `SETUP.md` - Installation, environment setup, MongoDB Atlas, scripts
  - `design.md` - Architecture, features, project structure
  - `API.md` - Complete API reference (endpoints, payloads, response codes)
  - `AUTHENTICATION_SETUP.md` - User auth implementation
  - `TODO.md` - Planned improvements and known issues

**When documenting**: Keep README minimal. Add detailed content to the appropriate topic-specific doc file in `docs/`. Never duplicate content between README and docs.

## Architecture Overview

Full-stack bilingual story platform with **separated build systems**:
- **Backend**: Express.js 5 + TypeScript (compiled with `tsc` to `dist/`)
- **Frontend**: React 19 + TypeScript (bundled with webpack to `public/`)
- **Database**: MongoDB Atlas (cloud-hosted, connection via `MONGODB_URI`)
- **Deployment**: Docker multi-stage builds + Kubernetes/k3s via Helm (planned; mirrors PortugueseLearning)

Key architectural patterns:
- Backend serves static frontend from `public/` directory after both are built.
- **Bilingual content model**: every `Story` stores parallel-text pairs — `title.lang1`/`title.lang2` and `sentences[].lang1`/`sentences[].lang2`.
- **Draft/Published separation**: stories default to `published: false`; explicit publish action required (must have ≥1 sentence).
- **Author denormalization**: `authorName` stored on `Story` for efficient browse queries without joins.

## Critical Workflows

### Development
```bash
npm run dev          # Runs BOTH: backend (port 3000) + webpack-dev-server (port 8080)
                     # webpack proxies /api/* requests to backend
npm run dev:server   # Backend only (ts-node-dev, auto-restart)
npm run dev:client   # webpack-dev-server only
```

### Building
```bash
npm run build        # Sequentially: build:server THEN build:client
npm run build:server # tsc -p tsconfig.server.json → dist/
npm run build:client # webpack --mode production → public/bundle.js
npm start            # node dist/server.js (production)
```

### Testing
Tests are not yet implemented. Playwright is planned — the setup will mirror PortugueseLearning:
```bash
# (future)
npm test             # MongoDB Memory Server + Playwright
./run-tests.sh       # Wrapper that starts/stops in-memory MongoDB + runs Playwright
```
- Smoke tests will be tagged `@smoke` for CI runs.
- Prefer `getByRole()` selectors over `getByTestId()`.

### Deployment (planned)
- Production: Docker multi-stage build (`Dockerfile` — to be added)
- Deployed on k3s via Helm charts (`helm/story-creator/` — to be added)
- CI/CD: GitHub Actions builds and pushes images (mirrors PortugueseLearning workflow)

## Project-Specific Conventions

### Bilingual Content Model
Stories store parallel sentences in two languages (`lang1` and `lang2`):
```typescript
// src/models/Story.ts
interface ISentence { lang1: string; lang2: string; }
interface IStory {
  title: { lang1: string; lang2: string };
  sentences: ISentence[];
  nativeLanguage: string;   // author's native language
  learningLanguage: string; // language being learned
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  authorId: ObjectId;
  authorName: string;  // denormalized for browse efficiency
  published: boolean;
}
```
`sentenceCount` is auto-computed via a `pre('save')` hook — never set it manually.

### Supported Content Languages
17 languages defined in `src/client/utils/languages.ts` (LANGUAGES array):
Arabic, Chinese, Dutch, English, French, German, Hindi, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Swedish, Turkish, Ukrainian.

### Session Management
- Uses `express-session` with MongoDB store (`connect-mongo`)
- Session stored in `req.session.userId` (not JWT)
- Auth middleware: `requireAuth` checks `req.session.userId` existence
- Cookie config: `httpOnly: true`, `sameSite: 'lax'`, 7-day TTL
- `secure: false` in dev — **must be `true` in production** (Traefik handles HTTPS termination at ingress)
- `touchAfter: 24h` prevents unnecessary session DB writes

### Internationalization (i18n)
- Client-side only, using `react-i18next`
- UI languages: `en` (English), `fr` (French) — stored as `user.uiLanguage`
- Translation files: `src/locales/{en,fr}.json`
- Initialized in `src/i18n.ts`; consumed via `useTranslation()` hook
- On login, `App.tsx` calls `i18n.changeLanguage(user.uiLanguage)` to sync language with account preference
- LanguageDetector reads localStorage then navigator preference as fallback

### Frontend Routing
Uses **React Router v7** (`react-router-dom`). `BrowserRouter` wraps the app in `App.tsx`; all routes are declared with `<Routes>/<Route>`. Navigation uses `useNavigate()` and `<Navigate>`.

Key routes:
- `/` — LandingPage (hero + recent published stories)
- `/login`, `/register`, `/profile`
- `/stories` — Browse with filters (language pair, level, search)
- `/stories/mine` — User's drafts + published stories (auth required)
- `/stories/:id` — Read a story (bilingual toggle)
- `/stories/:id/edit` — Story editor (CRUD sentences, publish/unpublish)
- `*` → redirects to `/`

Express catch-all `app.get('/{*path}', ...)` serves `public/index.html` for all non-API routes — must be declared **last** in `server.ts`.

## API Endpoints Reference

### Authentication (`/api/auth`)
- `POST /register` — Create account (bcrypt 12 rounds; validates email/username uniqueness, password ≥6 chars); auto-logs in
- `POST /login` — Session creation (generic error to prevent email enumeration)
- `POST /logout` — Session destruction
- `GET /check-auth` — Returns current user if session valid (used on app startup for session restore)

### Stories (`/api/stories`)
- `GET /` — Browse published stories (filters: `nativeLang`, `learningLang`, `level`, `search`; pagination 12/page)
- `GET /mine` — User's own drafts + published (auth required)
- `GET /:id` — Full story with sentences (403 if draft and not author)
- `POST /` — Create new draft (auth required)
- `PUT /:id` — Update story (auth + author check)
- `DELETE /:id` — Delete story (auth + author check)
- `POST /:id/publish` — Toggle published flag (auth + author check; requires ≥1 sentence)

### Health
- `GET /api/health` — Returns `{ status: "ok" }`

## Database Models

### User (`src/models/User.ts`)
Key fields: `username` (unique, 3–30 chars), `email` (unique, lowercase), `password` (bcrypt hash), `uiLanguage` ('en' | 'fr'), `createdAt`

`comparePassword(candidate)` method available on the model instance.

### Story (`src/models/Story.ts`)
Key fields: `title.{lang1,lang2}`, `sentences[].{lang1,lang2}`, `sentenceCount` (auto), `nativeLanguage`, `learningLanguage`, `level`, `topic`, `authorId`, `authorName`, `published`, timestamps

**Indexes:**
- `{ nativeLanguage, learningLanguage, published }` — compound index for browse queries
- `{ authorId }` — for "my stories" page

### Session Store (via `connect-mongo`)
Session documents stored in MongoDB (same database). TTL: 7 days. `touchAfter: 24h` prevents redundant writes.

## Environment Variables

Development: `.env`
```
MONGODB_URI=mongodb+srv://...
SESSION_SECRET=random-string-change-in-production
NODE_ENV=development
PORT=3000
```

Testing (future): `.env.test` (auto-generated by `run-tests.sh`, never committed)

Production: Set as Kubernetes secrets or Helm values.

## Common Gotchas

1. **Port confusion**: Dev mode uses TWO ports (3000 backend, 8080 webpack). Production uses only 3000.
2. **Build order matters**: `build:server` must run before `build:client` (`npm run build` handles this).
3. **Static files**: Backend serves from `public/`, not `src/client/`. After `npm run build`, Express serves `public/index.html` + `public/bundle.js`.
4. **Session cookie `secure: false`**: Required in local dev (no HTTPS), but **must be `true` in production** to prevent session hijacking over HTTP.
5. **SPA catch-all position**: The `app.get('/{*path}', ...)` route in `server.ts` must be the **last** route registered; otherwise it swallows API routes.
6. **Draft access control**: `GET /api/stories/:id` returns 403 for draft stories when the requester is not the author — check this in frontend navigation.

## Material-UI Styling

Custom theme in `src/client/App.tsx`:
- Primary: `#2563eb` (blue), Secondary: `#7c3aed` (purple)
- Border radius: 12px for cards/papers, 8px for buttons
- No text transforms on buttons (`textTransform: 'none'`)
- MUI component library: `@mui/material` v9 with Emotion (`@emotion/react`, `@emotion/styled`)
