# StoryCreatorAgent

Generates a random idea for an easy Portuguese-learning story with an OpenAI
agent, then creates the story through the StoryCreator public API
(`POST /api/v1/stories`) and waits for the AI writer to finish.

## Requirements

- An API key created with **Profile → API keys → "Allow creating stories (uses AI)"**
  (scope `stories:write`).
- An OpenAI key for the idea agent.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `STORYCREATOR_API_KEY` | yes | API key with the `stories:write` scope |
| `STORYCREATOR_API_URL` | no | Server base URL (default `http://localhost:3000`) |
| `OPEN_AI_KEY` | yes | OpenAI key for the idea agent (`OPENAI_API_KEY` also accepted) |
| `STORYCREATOR_IDEMPOTENCY_KEY` | no | Stable retry key; the Helm CronJob sets it to the Job name |

## Local usage

```bash
pip install -r requirements.txt

export OPEN_AI_KEY=sk-...
export STORYCREATOR_API_KEY=stc_live_...
export STORYCREATOR_API_URL=http://localhost:3000

# Preview the generated idea and request without calling the API
python StoryCreatorAgent.py --dry-run

# Create a 3-chapter, 8-sentences-per-chapter beginner story and publish it
python StoryCreatorAgent.py --chapters 3 --sentences-per-chapter 8 --output story.json
```

Each run picks a random theme, protagonist and plot twist, so repeated runs
produce different stories.

CLI reference, Docker image, Helm CronJob configuration, idempotency behaviour
and troubleshooting: **[docs/STORY_AGENT.md](../docs/STORY_AGENT.md)**.

## Reading a story

`StoryCreatorGetter.py` fetches one story with `GET /api/v1/stories/:id` and
prints the bilingual text. It needs a key with the `stories:read` scope and no
OpenAI key.

```bash
# Default story id 6ad3da2d233a762967c9e718
python StoryCreatorGetter.py

# Explicit id; JSON instead of parallel text; full response saved to disk
python StoryCreatorGetter.py 66f0a1b2c3d4e5f60718293a --format json --output story.json
```

Options: `--api-url`, `--api-key`, `--format text|json`, `--timeout`, `--output`.
The story id can also come from `STORYCREATOR_STORY_ID`.

Exit codes: `0` on success, `1` for API/auth/network errors, `2` when the story
is not found (unpublished or invisible to the key). A write-scoped key can read
its own drafts and sees the `status` block (`generating` / `ready` / `failed`).

## Docker

Build from the repository root (the GitHub Actions workflow already does this):

```bash
docker build -t storycreator-scripts:dev -f pythonDockerBaseImage/Dockerfile .
```

Run:

```bash
docker run --rm \
  -e STORYCREATOR_API_URL=https://bilingualstory.net \
  -e STORYCREATOR_API_KEY=stc_live_... \
  -e OPEN_AI_KEY=sk-... \
  storycreator-scripts:dev \
  --chapters 3 --sentences-per-chapter 8
```

Like the website, story generation costs an OpenAI call. The per-key API rate
limit (default 60 requests/minute) is the only throttle; run the agent on a
schedule you are comfortable paying for.
