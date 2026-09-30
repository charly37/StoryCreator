# API Reference

All endpoints are prefixed with `/api`. The server returns JSON for all responses.

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

## Stories — `/api/stories`

### `GET /api/stories`

Browse published stories with optional filters and pagination.

**Query parameters**

| Param | Description |
|---|---|
| `nativeLang` | Filter by native language code (e.g. `en`) |
| `learningLang` | Filter by learning language code (e.g. `fr`) |
| `level` | `beginner`, `intermediate`, or `advanced` |
| `search` | Full-text search on title (both languages) and topic |
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
  "topic": "animals",
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
    { "seed": "Milo discovers the harbour", "targetSentences": 12 }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title.lang1` | yes | |
| `title.lang2` | no | Usually filled in by AI generation |
| `nativeLanguage` | yes | Must differ from `learningLanguage` |
| `learningLanguage` | yes | |
| `level` | yes | `beginner` / `intermediate` / `advanced` |
| `topic` | no | Free-text tag |
| `seed` | no | Story premise used for AI generation |
| `characters` | no | Array of `{ name, role, description, appearance }`; blank names are dropped, max 20 |
| `targetChapters` | no | Planned chapter count (1–10, default 1) |
| `chapters` | no | Array of `{ seed, targetSentences }`; defaults to `targetChapters` empty chapters |

**Response `201`:** The created story object.

Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.

---

### `PUT /api/stories/:id`

*Auth required. Author only.* Update story fields. All fields are optional — only supplied fields are updated.

**Body:** Same shape as `POST /api/stories`.

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

**Response `202`:** `{ message, storyId }`

### `POST /api/stories/:id/review`

*Auth required. Author only. Creator access required.* Apply per-sentence feedback via AI.

**Body:** `{ generalFeedback?, annotations: [{ chapterIndex, sentenceIndex, feedback }] }`

- Requires at least one annotation with non-empty `feedback`.
- Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.
- Story `characters` are included as consistency context.
- Responds `202` and runs the patch job in the background.

### `POST /api/stories/:id/regenerate-chapter`

*Auth required. Author only. Creator access required.* Regenerate a single chapter, optionally updating other chapters for coherence.

**Body:** `{ chapterIndex, generalFeedback? }`

- Returns `400` for an invalid `chapterIndex`.
- Returns `403` with `code: "CREATOR_ACCESS_REQUIRED"` when the account lacks `canCreateStories`.
- Story `characters` are included as consistency context.
- Responds `202` and runs the job in the background.

### `POST /api/stories/:id/approve`

*Auth required. Author only.* Mark an AI-generated story as reviewed.

- Returns `400` if the story has no sentences.
- AI-generated stories must be approved before `POST /:id/publish` succeeds.

**Response `200`:** `{ approved: true }`

---

## Health Check

### `GET /api/health`

Returns `{ status: "ok" }`. Used by load balancers and monitoring probes.
