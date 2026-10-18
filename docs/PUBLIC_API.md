# Public API v1

A key-authenticated API for published stories and for creating new stories with
the platform's AI writer. It is intended for external tools (reading apps,
export scripts, integrations) that want bilingual story content without going
through the website.

- **Base path:** `/api/v1`
- **Content type:** `application/json`
- **Read:** published stories (list, detail, metadata) — requires `stories:read`
- **Write:** create a story from a seed; the AI writer generates the chapters asynchronously — requires `stories:write`
- **Not available:** updating, deleting, unpublishing, or publishing existing stories. Those stay website-only.

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

### Scopes

| Scope | Grants |
|---|---|
| `stories:read` | List, read and browse published stories |
| `stories:write` | Create stories (always issued together with `stories:read`) |

Read-only keys keep working unchanged. Write access is opt-in when the key is
created.

### Creating and revoking keys

Keys are managed from the website at **Profile → API keys** while logged in, or
with the endpoints below (session cookie auth, not an API key):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List your keys (prefix + metadata, never the secret) |
| `POST` | `/api/keys` | Create a key — the raw key is returned **once** |
| `DELETE` | `/api/keys/:id` | Revoke a key immediately |

`POST /api/keys` body: `{ "name": "My reading app", "writeAccess": true }`.
`name` is required (1–50 characters); `writeAccess` is optional and defaults to
`false`. When `true`, the key receives both `stories:read` and `stories:write`.

Creator access (`canCreateStories: true`) is required to create keys, and is
re-checked on every write request. A maximum of **5** keys can exist per account
at any time.

```bash
# Create a read+write key
curl -X POST https://your-host/api/keys \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"name":"Publishing pipeline","writeAccess":true}'
```

```json
{
  "key": "stc_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  "apiKey": {
    "id": "66f1c2...",
    "name": "My reading app",
    "prefix": "stc_live_AbCdEfGh",
    "scopes": ["stories:read", "stories:write"],
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
| `search` | string | — | Case-insensitive match on either title or labels (max 100 chars) |
| `author` | string | — | Exact username (case-insensitive, max 30 chars) — returns only that user's published stories |
| `sort` | string | `newest` | `newest` or `oldest` |
| `page` | integer | `1` | 1-based page number |
| `limit` | integer | `12` | Page size, clamped to **50** |

Unknown language codes, levels, sort values, non-numeric `page`/`limit` values
and an over-long `author` return `400 INVALID_PARAMETER`. An `author` that does
not resolve to an account returns an empty `data` array with `total: 0`
(**not** `404`).

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
      "labels": ["animals", "friendship"],
      "authorName": "alice",
      "publisherDisplayName": "alice(key-automation)",
      "creationSource": "api",
      "createdViaApiKeyName": "key-automation",
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

# Only published stories authored by the user "charly"
curl -s "https://your-host/api/v1/stories?author=charly&limit=50" \
  -H "Authorization: Bearer $STORYCREATOR_API_KEY"
```

Only **published** stories are ever listed, so `author` implicitly means
"published stories by that user" — drafts are never returned by this endpoint.

---

### `POST /api/v1/stories`

Create a draft and start AI generation. Requires the `stories:write` scope.

The story is created immediately with empty chapters; generation runs in the
background. The response is `202 Accepted` with a `Location` header and a
`pollUrl` — poll `GET /api/v1/stories/:id` until `data.status.state` is `ready`
(or `failed`).

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `title.lang1` | string | yes | Title in the native language |
| `title.lang2` | string | no | Title in the learning language (the AI fills it when blank) |
| `nativeLanguage` | string | yes | Supported language code (see `/metadata`) |
| `learningLanguage` | string | yes | Supported language code; must differ from `nativeLanguage` |
| `level` | string | yes | `beginner`, `intermediate` or `advanced` |
| `seed` | string | yes | Story premise used by the AI |
| `labels` | array | no | Free-text labels (`string[]`, deduplicated, max 20) |
| `topic` | string | no | Legacy single-label alias; converted into `labels` when provided |
| `characters` | array | no | `[{ name, role, description, appearance }]`, max 20 |
| `aiGuideline` | string | no | Private style guidance (max 2000 chars) |
| `aiModel` | string | no | `gpt-4o-mini` (default), `gpt-4.1-mini`, `gpt-4o`, `gpt-5-mini` |
| `targetChapters` | integer | no | 1–10, default `1` (ignored when `chapters` is provided) |
| `chapters` | array | no | `[{ title?, seed?, targetSentences? }]`, max 10; `targetSentences` 1–100 |
| `published` | boolean | no | Default `false`. When `true`, the story is published automatically once generation produces content |

**Idempotency**

Send `Idempotency-Key: <unique value>` to make retries safe. Replaying the same
key returns the previously created story (`200`) instead of starting a second
paid AI generation.

**Response `202`**

```json
{
  "data": {
    "id": "66f0a1b2c3d4e5f60718293a",
    "status": "generating",
    "published": false,
    "pollUrl": "/api/v1/stories/66f0a1b2c3d4e5f60718293a"
  }
}
```

```bash
curl -X POST https://your-host/api/v1/stories \
  -H "Authorization: Bearer $STORYCREATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: story-2026-10-17-001" \
  -d '{
    "title": { "lang1": "The Patient Robot" },
    "nativeLanguage": "en",
    "learningLanguage": "pt",
    "level": "beginner",
    "seed": "A small robot learns to garden with the help of a neighbour.",
    "published": true
  }'
```

If generation fails, the story stays a draft and the failure is recorded on
`status.generationError`.

---

### `GET /api/v1/stories/:id`

Fetch one published story, including every chapter and sentence pair.

Draft, unpublished and non-existent stories return `404 NOT_FOUND` — the API
does not reveal whether an unpublished story exists. The exception is a
**write-scoped key reading its own story**: drafts are visible to their owner, so
the create → poll flow works before publishing.

Write-scoped owners also receive a `status` block:

```json
"status": { "state": "ready", "published": true, "generationError": "" }
```

`state` is `generating` while the AI job runs, `failed` if it errored (with a
truncated `generationError`), and `ready` otherwise. Public responses do not
include this block.

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
    "labels": ["animals", "friendship"],
    "authorName": "alice",
    "publisherDisplayName": "alice(key-automation)",
    "creationSource": "api",
    "createdViaApiKeyName": "key-automation",
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

Attribution fields:
- `creationSource` is `ui` for website-created stories and `api` for `/api/v1/stories` creations.
- `createdViaApiKeyName` is a snapshot of the API key name used at creation time (when source is `api`).
- `publisherDisplayName` is a convenience display field (`authorName` for UI stories, `authorName(keyName)` for API stories).

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
| `400` | `INVALID_PARAMETER` | Invalid query value, story id, or create body |
| `401` | `MISSING_API_KEY` | No `Authorization: Bearer` / `X-API-Key` header |
| `401` | `INVALID_API_KEY` | Unknown, malformed or revoked key |
| `403` | `INSUFFICIENT_SCOPE` | Key lacks the required `stories:read` / `stories:write` scope |
| `403` | `CREATOR_ACCESS_REQUIRED` | The key owner no longer has `canCreateStories` |
| `404` | `NOT_FOUND` | Story missing/unpublished, or unknown endpoint |
| `429` | `RATE_LIMITED` | Request limit exceeded for this key |
| `500` | `SERVER_ERROR` | Unexpected server failure (including generation failing to start) |

Unknown paths under `/api/v1` always return the JSON 404 envelope — never the
website's HTML shell.

---

## Rate limits

Each key gets **60 requests per minute** by default (configurable per deployment
with `PUBLIC_API_RATE_LIMIT_PER_MIN`). Limits are tracked per key, not per IP,
and apply to reads and story creation alike.

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
- `canCreateStories` is re-checked on every write request, so revoking creator
  access takes effect immediately. Existing keys are not deleted automatically.
- Story creation triggers a **paid** AI call. There is currently no daily quota;
  the per-key minute limit is the only throttle. Use `Idempotency-Key` to avoid
  duplicate generations on retries.
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
