# TODO List

## Secure Session Cookie for Production

The session cookie has `secure: false` in `src/server.ts`. This must be set to `true` before deploying behind HTTPS to prevent the cookie from being sent over plain HTTP.

```ts
// src/server.ts
cookie: {
  secure: process.env.NODE_ENV === 'production',
  ...
}
```

Also verify `app.set('trust proxy', 1)` is correct for your reverse-proxy setup (already present).

---

## Add Playwright / Integration Tests

The project has no automated tests. Following the same pattern as PortugueseLearning, add a `tests/` directory with Playwright end-to-end tests covering:

- Register, login, logout flow
- Create a story, add sentences, publish
- Browse and filter public stories
- Read a story (bilingual toggle)

Add a `playwright.config.ts` and the following scripts to `package.json`:

```json
"test": "playwright test",
"test:headed": "playwright test --headed",
"test:ui": "playwright test --ui",
"test:report": "playwright show-report"
```

---

## Story Import / Bulk Sentence Loading

Currently sentences must be added one at a time in the editor. A useful improvement would be a bulk-import feature — paste a block of text with `lang1 | lang2` pairs per line and have the editor split them into sentences automatically.

---

## Language Code Normalisation

`nativeLanguage` and `learningLanguage` are stored as free-text strings with no validation beyond "they must differ". Consider enforcing a fixed list of language codes (e.g. BCP 47 tags) to prevent inconsistent values like `"English"` vs `"en"` appearing in the browse filters.

---

## Sentence Count TTL / Story Cleanup

There is no mechanism to clean up abandoned draft stories. Consider adding:
- A TTL index on drafts older than N days with zero sentences, or
- A user-facing "delete draft" prompt for old unpublished stories

---

## Profile Page — Language Preference Update

The Profile page currently displays account information but does not allow the user to change their `uiLanguage` preference. Add a language selector that calls a `PATCH /api/auth/profile` (or equivalent) endpoint.

---

## Pagination on "My Stories" Page

`GET /api/stories/mine` returns all user stories with no pagination. For users with many stories this could become slow. Add cursor- or page-based pagination consistent with the public browse endpoint.

---

## Flush Logs on Shutdown

The backend has no `SIGTERM`/`SIGINT` handling, so pino's asynchronous stdout
write can lose the last records when Kubernetes terminates a pod. Add shutdown
handlers that stop accepting connections, call `logger.flush()`, and exit, plus
`uncaughtException`/`unhandledRejection` handlers that log at `fatal` and flush
before exiting. See [LOGGING.md](LOGGING.md#troubleshooting).

---

## Resume an Interrupted Staged Generation

Staged stories keep partial progress: chapters already written stay on the story, and
`GET /api/stories/:id` releases a job whose heartbeat went quiet (`generatingSince` +
`GENERATION_STALL_MINUTES`, default 15). But there is no "resume from chapter N" action — the only
retry is `POST /api/stories/:id/generate-chapters`, which rewrites every chapter and pays for all
of them again.

Add a `fromChapter` option (or detect empty chapters automatically) so an interrupted run — pod
restart, provider timeout — only regenerates the missing chapters.

---

## Chat-Style Outline Iteration

Stage 1 supports direct editing plus a single free-text "adjust with AI" box, so each round of
feedback is stateless. A conversational thread would let the author argue with the planner across
turns without re-sending the whole plan. Needs a messages collection and a thread UI, which is why
it was left out of the first version.



