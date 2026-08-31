# Authentication Implementation

## Overview

StoryCreator uses session-based authentication backed by MongoDB. There are no JWTs — a server-side session is created on login and destroyed on logout. All session documents are stored in the same MongoDB database using `connect-mongo`.

## Stack

| Concern | Library |
|---|---|
| Password hashing | `bcryptjs` (12 salt rounds) |
| Sessions | `express-session` |
| Session store | `connect-mongo` |
| User model | Mongoose (`src/models/User.ts`) |

## User Registration

**Endpoint:** `POST /api/auth/register`

Validation applied before saving:
- `username`, `email`, and `password` are all required
- Password must be at least 6 characters
- `uiLanguage` (optional) must be `"en"` or `"fr"` if provided
- Username and email must be unique — a `400` is returned with a specific message if either already exists

On success the session is created immediately (the user is logged in straight after registering) and a `201` with the user object is returned.

## User Login

**Endpoint:** `POST /api/auth/login`

- Looks up the user by email
- Calls `user.comparePassword()` which uses `bcrypt.compare`
- Returns a generic `"Invalid email or password"` message for both "user not found" and "wrong password" cases (prevents email enumeration)
- On success, stores `userId` in the session and returns the user object

## Session Lifecycle

- Session cookie: `httpOnly`, `sameSite: lax`, 7-day TTL
- `saveUninitialized: false` — no session document is written until the user authenticates
- `touchAfter: 24 * 3600` — session documents are only re-written once per day if unchanged, reducing DB writes
- Logout (`POST /api/auth/logout`) calls `req.session.destroy()`
- Auth check (`GET /api/auth/check-auth`) returns the current user or `401` — the React app calls this on startup to restore session state

## Protecting Routes

A `requireAuth` middleware in `src/routes/stories.ts` checks `req.session.userId` and returns `401` if absent. Apply it to any route that requires a logged-in user:

```ts
router.post('/', requireAuth, async (req, res) => { ... });
```

## Backend Components

- **[src/models/User.ts](../src/models/User.ts)** — Mongoose schema with `pre('save')` hook for hashing and `comparePassword` method
- **[src/routes/auth.ts](../src/routes/auth.ts)** — Register, login, logout, check-auth endpoints
- **[src/server.ts](../src/server.ts)** — Session middleware configuration and MongoDB store setup

## Frontend Components

- **[src/client/components/LoginPage.tsx](../src/client/components/LoginPage.tsx)** — Email + password form
- **[src/client/components/RegisterPage.tsx](../src/client/components/RegisterPage.tsx)** — Username, email, password, and UI language selector
- **[src/client/components/ProfilePage.tsx](../src/client/components/ProfilePage.tsx)** — Shows account info; logout button
- **[src/client/App.tsx](../src/client/App.tsx)** — Calls `GET /api/auth/check-auth` on mount to restore session; holds `user` state passed down via props

## Production Checklist

- [ ] Set `SESSION_SECRET` to a long random string (not the default)
- [ ] Set `cookie.secure: true` in `server.ts` when serving over HTTPS
- [ ] Ensure `MONGODB_URI` points to your production Atlas cluster
- [ ] Consider reducing session TTL (`maxAge`) for higher-security deployments
