# API Reference

All endpoints are prefixed with `/api`. The server returns JSON for all responses.

Authentication is session-based — the browser cookie is sent automatically. Endpoints marked **Auth required** return `401` if the session has no `userId`.

---

## Authentication — `/api/auth`

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

*Auth required.* Create a new story.

**Body**

```json
{
  "title": { "lang1": "The Cat", "lang2": "Le Chat" },
  "nativeLanguage": "en",
  "learningLanguage": "fr",
  "level": "beginner",
  "topic": "animals",
  "sentences": [
    { "lang1": "The cat sat on the mat.", "lang2": "Le chat était assis sur le tapis." }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title.lang1` | yes | |
| `title.lang2` | yes | |
| `nativeLanguage` | yes | Must differ from `learningLanguage` |
| `learningLanguage` | yes | |
| `level` | yes | `beginner` / `intermediate` / `advanced` |
| `topic` | no | Free-text tag |
| `sentences` | no | Array of `{ lang1, lang2 }` pairs; defaults to `[]` |

**Response `201`:** The created story object.

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

## Health Check

### `GET /api/health`

Returns `{ status: "ok" }`. Used by load balancers and monitoring probes.
