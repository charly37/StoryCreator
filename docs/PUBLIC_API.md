# Public API v1

A read-only, key-authenticated API for published stories. It is intended for
external tools (reading apps, export scripts, integrations) that want bilingual
story content without going through the website.

- **Base path:** `/api/v1`
- **Content type:** `application/json`
- **Access:** published stories only; every request requires an API key
- **No write access:** creating, editing, generating, publishing and deleting
  stories are not available over this API

The browser-facing API under `/api/*` is separate and remains session-based.

---

## Authentication

Send the key as a bearer token:

```http
Authorization: Bearer stc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key: <key>` is accepted as a convenience header, but `Authorization` is
preferred.

Keys look like `stc_live_` followed by 32 URL-safe characters. They are shown
**once**, when created, and only a SHA-256 hash is stored — a lost key cannot be
recovered, only revoked and replaced.

### Creating and revoking keys

Keys are managed from the website at **Profile → API keys** while logged in, or
with the endpoints below (session cookie auth, not an API key):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List your keys (prefix + metadata, never the secret) |
| `POST` | `/api/keys` | Create a key — the raw key is returned **once** |
| `DELETE` | `/api/keys/:id` | Revoke a key immediately |

`POST /api/keys` body: `{ "name": "My reading app" }` (1–50 characters).

Creator access (`canCreateStories: true`) is required to create keys. A maximum
of **5** keys can exist per account at any time.

```bash
# Create a key
curl -X POST https://your-host/api/keys \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"name":"My reading app"}'
```

```json
{
  "key": "stc_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  "apiKey": {
    "id": "66f1c2...",
    "name": "My reading app",
    "prefix": "stc_live_AbCdEfGh",
    "scopes": ["stories:read"],
    "createdAt": "2026-10-17T09:12:00.000Z",
    "lastUsedAt": null
  },
  "warning": "Store this key now. It cannot be retrieved again."
}
```

---

## Endpoints

### `GET /api/v1/stories`

List published stories, newest first.

**Query parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| `nativeLang` | string | — | Native-language code (see `/metadata`), e.g. `en` |
| `learningLang` | string | — | Learning-language code, e.g. `pt` |
| `level` | string | — | `beginner`, `intermediate` or `advanced` |
| `search` | string | — | Case-insensitive match on either title or topic (max 100 chars) |
| `sort` | string | `newest` | `newest` or `oldest` |
| `page` | integer | `1` | 1-based page number |
| `limit` | integer | `12` | Page size, clamped to **50** |

Unknown language codes, levels, sort values and non-numeric `page`/`limit`
values return `400 INVALID_PARAMETER`.

**Response `200`**

```json
{
  "data": [
    {
      "id": "66f0a1b2c3d4e5f60718293a",
      "title": { "lang1": "O Gato e o Sol", "lang2": "The Cat and the Sun" },
      "chapterCount": 3,
      "sentenceCount": 36,
      "nativeLanguage": "pt",
      "learningLanguage": "en",
      "level": "beginner",
      "topic": "animals",
      "authorName": "alice",
      "isAIGenerated": true,
      "createdAt": "2026-09-30T12:00:00.000Z",
      "updatedAt": "2026-10-02T08:15:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 42,
    "pages": 4,
    "hasNext": true
  }
}
```

```bash
curl -s "https://your-host/api/v1/stories?nativeLang=en&learningLang=pt&level=beginner&limit=5" \
  -H "Authorization: Bearer $STORYCREATOR_API_KEY"
```

---

### `GET /api/v1/stories/:id`

Fetch one published story, including every chapter and sentence pair.

Draft, unpublished and non-existent stories all return `404 NOT_FOUND` — the API
does not reveal whether an unpublished story exists.

**Response `200`**

```json
{
  "data": {
    "id": "66f0a1b2c3d4e5f60718293a",
    "title": { "lang1": "O Gato e o Sol", "lang2": "The Cat and the Sun" },
    "sentenceCount": 36,
    "nativeLanguage": "pt",
    "learningLanguage": "en",
    "level": "beginner",
    "topic": "animals",
    "authorName": "alice",
    "isAIGenerated": true,
    "createdAt": "2026-09-30T12:00:00.000Z",
    "updatedAt": "2026-10-02T08:15:00.000Z",
    "chapters": [
      {
        "title": { "lang1": "O Começo", "lang2": "The Beginning" },
        "sentences": [
          { "lang1": "O gato dormia ao sol.", "lang2": "The cat slept in the sun." }
        ]
      }
    ]
  }
}
```

```bash
curl -s "https://your-host/api/v1/stories/66f0a1b2c3d4e5f60718293a" \
  -H "Authorization: Bearer $STORYCREATOR_API_KEY"
```

---

### `GET /api/v1/metadata`

Filter values and pagination limits, useful for building UIs.

```json
{
  "data": {
    "languages": [
      { "code": "ar", "name": "Arabic", "nativeName": "العربية" }
    ],
    "levels": ["beginner", "intermediate", "advanced"],
    "pagination": { "defaultLimit": 12, "maxLimit": 50 }
  }
}
```

The `languages` array always matches the website's supported language list.

---

## Errors

All v1 errors use the same envelope:

```json
{ "error": { "code": "INVALID_PARAMETER", "message": "level must be one of: beginner, intermediate, advanced" } }
```

| Status | Code | Meaning |
|---|---|---|
| `400` | `INVALID_PARAMETER` | Invalid query value or story id |
| `401` | `MISSING_API_KEY` | No `Authorization: Bearer` / `X-API-Key` header |
| `401` | `INVALID_API_KEY` | Unknown, malformed or revoked key |
| `403` | `INSUFFICIENT_SCOPE` | Key lacks the required `stories:read` scope |
| `404` | `NOT_FOUND` | Story missing/unpublished, or unknown endpoint |
| `429` | `RATE_LIMITED` | Request limit exceeded for this key |
| `500` | `SERVER_ERROR` | Unexpected server failure |

Unknown paths under `/api/v1` always return the JSON 404 envelope — never the
website's HTML shell.

---

## Rate limits

Each key gets **60 requests per minute** by default (configurable per deployment
with `PUBLIC_API_RATE_LIMIT_PER_MIN`). Limits are tracked per key, not per IP.

Responses include the standard IETF `RateLimit-*` headers:

```http
RateLimit-Limit: 60
RateLimit-Remaining: 59
RateLimit-Reset: 12
```

A rejected request returns `429` with `code: "RATE_LIMITED"` and a `Retry-After`
header.

---

## Usage tracking and security notes

- `lastUsedAt` in `GET /api/keys` is updated at most once every **5 minutes**
  per key to avoid a database write on every request.
- Keys are stored as SHA-256 hashes with an indexed, non-secret prefix. Revoking
  a key deletes it, which invalidates it immediately.
- Revoking `canCreateStories` from an account does **not** invalidate keys that
  already exist — revoke the keys themselves if needed.
- The public payload is an explicit allow-list. Authoring internals (story seed,
  AI guideline, character descriptions, author ids, AI call counters) are never
  returned.

---

## Versioning policy

- The base path is versioned: `/api/v1`.
- Within `v1`, changes are **additive only** — new fields, new endpoints, new
  optional query parameters. Existing fields keep their meaning and type.
- Breaking changes ship under `/api/v2`; `v1` remains available during a
  deprecation window.
- The session-based `/api/*` surface used by the website is not versioned and
  may change with the app.
