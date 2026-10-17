#!/usr/bin/env python3
"""
StoryCreatorAgent.py — generate a Portuguese-learning story idea and create it
through the StoryCreator public API.

Workflow:
  1. An OpenAI agent invents a beginner-friendly European Portuguese story idea
     (English/Portuguese titles, cast, target vocabulary and a seed premise).
  2. The idea is sent to `POST /api/v1/stories`, which starts AI generation.
  3. The script polls `GET /api/v1/stories/{id}` until the story is ready
     (or reports the generation error).

Environment:
  STORYCREATOR_API_KEY   API key with the `stories:write` scope (required)
  STORYCREATOR_API_URL   Base URL of the StoryCreator server
                         (default: http://localhost:3000)
  OPEN_AI_KEY            OpenAI key used by the idea agent
                         (OPENAI_API_KEY is accepted as a fallback)
  STORYCREATOR_IDEMPOTENCY_KEY
                         Optional stable key for retries (used by the Helm CronJob)
                         CLI --idempotency-key takes precedence
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from agents import Agent, Runner

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(levelname)s %(message)s",
)
log = logging.getLogger("storycreator-agent")

DEFAULT_API_URL = "http://localhost:3000"
SUPPORTED_LEVELS = ("beginner", "intermediate", "advanced")
# Mirrors ALLOWED_AI_MODELS in src/services/storyGenerationService.ts.
ALLOWED_STORY_MODELS = ("gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-5-mini")

# Random ingredients used to vary the idea prompt on every run.
THEMES = [
    "daily routine",
    "food and cafés",
    "family and neighbours",
    "travel and holidays",
    "weather and seasons",
    "shopping at the market",
    "hobbies and free time",
    "animals and pets",
    "school and work",
    "transport in the city",
    "health and the pharmacy",
    "a walk by the river",
]

PROTAGONISTS = [
    "a curious child",
    "an elderly neighbour",
    "a young student",
    "a friendly baker",
    "a bus driver",
    "a small dog",
    "a visiting cousin",
    "a retired teacher",
]

PLOT_TWISTS = [
    "a small misunderstanding that gets resolved kindly",
    "a lost object that turns up in an unexpected place",
    "a surprise visit that changes the plans",
    "a first-time experience that feels scary but ends well",
    "a helpful stranger who speaks only Portuguese",
    "a change in the weather that forces a new plan",
    "a shared meal that brings two people together",
]

JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


class StoryCreatorError(RuntimeError):
    """Raised when the StoryCreator API rejects a request or generation fails."""


# ---------------------------------------------------------------------------
# Idea generation
# ---------------------------------------------------------------------------

def _build_idea_agent(model: str) -> Agent:
    instructions = """You invent short, warm story ideas for beginners learning European Portuguese.

You will receive a theme, a main character and a plot element. Invent a story that:
- Is set in everyday Portugal (a home, a café, a market, a neighbourhood, a bus...).
- Has a simple, concrete plot that a beginner can follow.
- Uses European Portuguese (pt-PT), not Brazilian Portuguese.
- Teaches useful A1-A2 vocabulary through repetition in context.
- Is suitable for a learner with a small vocabulary.

Return ONLY a JSON object (no markdown fences, no extra prose) with exactly these keys:
{
  "title_native": "title in the learner's native language",
  "title_learning": "title in the language being learned (European Portuguese unless stated otherwise)",
  "theme": "2-4 word theme label",
  "vocabulary": ["8 to 12 beginner Portuguese words or short phrases used in the story"],
  "characters": [
    {"name": "...", "role": "...", "description": "...", "appearance": "..."}
  ],
  "seed": "2-4 sentence premise written as instructions for a bilingual story writer: name the setting, the characters, the simple conflict and the resolution. Explicitly ask for simple European Portuguese, short sentences in the present tense, and natural reuse of the vocabulary list."
}

Rules:
- 1 to 3 characters maximum.
- Vocabulary must be everyday nouns, verbs, adjectives or set phrases that actually appear in the story.
- Keep the premise concrete; no fantasy worlds, no complex timelines.
"""

    return Agent(
        name="PortugueseStoryIdeaAgent",
        instructions=instructions,
        model=model,
    )


def _extract_json(text: str) -> dict[str, Any]:
    """Parses the first JSON object from an agent response, tolerating fences."""
    match = JSON_FENCE.search(text)
    candidate = match.group(1) if match else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise StoryCreatorError(f"The idea agent did not return JSON: {text[:400]}")

    try:
        data = json.loads(candidate[start:end + 1])
    except json.JSONDecodeError as exc:
        raise StoryCreatorError(f"Could not parse the idea agent response: {exc}") from exc

    if not isinstance(data, dict):
        raise StoryCreatorError("The idea agent response was not a JSON object")
    return data


def _normalize_idea(raw: dict[str, Any]) -> dict[str, Any]:
    def as_text(value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    title_native = as_text(raw.get("title_native"))
    title_learning = as_text(raw.get("title_learning"))
    seed = as_text(raw.get("seed"))
    if not title_native:
        raise StoryCreatorError("The idea agent did not provide 'title_native'")
    if not seed:
        raise StoryCreatorError("The idea agent did not provide 'seed'")

    raw_vocabulary = raw.get("vocabulary")
    if not isinstance(raw_vocabulary, list):
        raw_vocabulary = []
    vocabulary = [
        as_text(word)
        for word in raw_vocabulary
        if as_text(word)
    ][:12]

    characters: list[dict[str, str]] = []
    if isinstance(raw.get("characters"), list):
        for entry in raw["characters"][:3]:
            if not isinstance(entry, dict):
                continue
            character = {
                "name": as_text(entry.get("name")),
                "role": as_text(entry.get("role")),
                "description": as_text(entry.get("description")),
                "appearance": as_text(entry.get("appearance")),
            }
            if character["name"]:
                characters.append(character)

    return {
        "title_native": title_native,
        "title_learning": title_learning,
        "theme": as_text(raw.get("theme")),
        "vocabulary": vocabulary,
        "characters": characters,
        "seed": seed,
    }


async def generate_story_idea(
    *,
    model: str,
    level: str,
    chapters: int,
    sentences_per_chapter: int,
    theme: str,
    native_language: str,
    learning_language: str,
) -> dict[str, Any]:
    chosen_theme = theme.strip() or random.choice(THEMES)
    protagonist = random.choice(PROTAGONISTS)
    twist = random.choice(PLOT_TWISTS)

    prompt = f"""Invent a story idea for a learner whose native language is {native_language}
and who is learning {learning_language} at {level} level.

Theme: {chosen_theme}
Main character: {protagonist}
Plot element: {twist}
Length: {chapters} chapter(s) of about {sentences_per_chapter} sentences each.

The story will be generated by another AI writer from the seed you provide, so make the
seed self-contained: setting, characters, what happens, and how it ends.
"""
    log.info(
        "Generating idea | theme=%r | protagonist=%r | twist=%r",
        chosen_theme,
        protagonist,
        twist,
    )

    result = await Runner.run(_build_idea_agent(model), prompt, max_turns=3)
    idea = _normalize_idea(_extract_json(result.final_output or ""))
    if not idea["theme"]:
        idea["theme"] = chosen_theme
    return idea


# ---------------------------------------------------------------------------
# Request building
# ---------------------------------------------------------------------------

def build_story_payload(idea: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """Builds the `POST /api/v1/stories` body from the generated idea."""
    seed_parts = [idea["seed"]]
    if idea["vocabulary"]:
        seed_parts.append(
            "Naturally reuse these words and phrases: " + ", ".join(idea["vocabulary"]) + "."
        )
    seed_parts.append(
        f"Write in simple {args.learning_language_name} at {args.level} level, "
        "using short sentences and the present tense."
    )

    payload: dict[str, Any] = {
        "title": {
            "lang1": idea["title_native"],
            "lang2": idea["title_learning"],
        },
        "nativeLanguage": args.native_language,
        "learningLanguage": args.learning_language,
        "level": args.level,
        "topic": (idea["theme"] or args.theme)[:200],
        "seed": " ".join(part.strip() for part in seed_parts if part.strip()),
        "targetChapters": args.chapters,
        "chapters": [
            {"seed": "", "targetSentences": args.sentences_per_chapter}
            for _ in range(args.chapters)
        ],
        "published": args.publish,
    }

    if idea["characters"]:
        payload["characters"] = idea["characters"]
    if args.ai_model:
        payload["aiModel"] = args.ai_model

    return payload


# ---------------------------------------------------------------------------
# StoryCreator API client
# ---------------------------------------------------------------------------

def _format_api_error(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None

    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return (
                f"HTTP {response.status_code} "
                f"{error.get('code', 'ERROR')}: {error.get('message', '')}"
            )
        if isinstance(body.get("message"), str):
            return f"HTTP {response.status_code}: {body['message']}"

    return f"HTTP {response.status_code}: {response.text[:300]}"


class StoryCreatorApi:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def create_story(
        self,
        payload: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        response = await self._client.post(
            "/api/v1/stories",
            json=payload,
            headers={"Idempotency-Key": idempotency_key},
        )
        if response.status_code not in (200, 202):
            raise StoryCreatorError(f"Story creation failed — {_format_api_error(response)}")

        data = response.json().get("data")
        if not isinstance(data, dict) or not data.get("id"):
            raise StoryCreatorError(f"Unexpected create response: {response.text[:300]}")
        return data

    async def get_story(self, story_id: str) -> dict[str, Any]:
        response = await self._client.get(f"/api/v1/stories/{story_id}")
        if response.status_code != 200:
            raise StoryCreatorError(f"Could not fetch story — {_format_api_error(response)}")

        data = response.json().get("data")
        if not isinstance(data, dict):
            raise StoryCreatorError(f"Unexpected story response: {response.text[:300]}")
        return data


async def wait_for_story(
    api: StoryCreatorApi,
    story_id: str,
    *,
    poll_interval: float,
    timeout: float,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    last_state: str | None = None

    while True:
        story = await api.get_story(story_id)
        status = story.get("status") if isinstance(story.get("status"), dict) else {}
        state = status.get("state", "unknown")

        if state != last_state:
            log.info("Story %s state: %s", story_id, state)
            last_state = state

        if state == "ready":
            return story
        if state == "failed":
            raise StoryCreatorError(
                "Story generation failed: "
                + (status.get("generationError") or "unknown error")
            )

        if loop.time() >= deadline:
            raise StoryCreatorError(
                f"Timed out after {timeout:.0f}s waiting for story {story_id} "
                f"(last state: {state})"
            )
        await asyncio.sleep(poll_interval)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _bounded_int(minimum: int, maximum: int):
    def parse(value: str) -> int:
        try:
            number = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"'{value}' is not an integer") from exc
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"must be between {minimum} and {maximum}")
        return number

    return parse


def _default_idempotency_key() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"dialecthub-{stamp}-{uuid.uuid4().hex[:8]}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a random Portuguese-learning story idea with an AI agent and "
            "create the story through the StoryCreator public API."
        )
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("STORYCREATOR_API_URL", DEFAULT_API_URL),
        help=f"StoryCreator base URL (default: {DEFAULT_API_URL})",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("STORYCREATOR_API_KEY", ""),
        help="API key with the stories:write scope (default: $STORYCREATOR_API_KEY)",
    )
    parser.add_argument(
        "--level",
        choices=SUPPORTED_LEVELS,
        default="beginner",
        help="Story level (default: beginner)",
    )
    parser.add_argument(
        "--native-language",
        default="en",
        help="Native language code (default: en)",
    )
    parser.add_argument(
        "--learning-language",
        default="pt",
        help="Learning language code (default: pt)",
    )
    parser.add_argument(
        "--learning-language-name",
        default="European Portuguese",
        help="Human-readable learning language used in the seed prompt",
    )
    parser.add_argument(
        "--theme",
        default="",
        help="Optional theme; a random theme is chosen when omitted",
    )
    parser.add_argument(
        "--chapters",
        type=_bounded_int(1, 10),
        default=3,
        help="Number of chapters (1-10, default: 3)",
    )
    parser.add_argument(
        "--sentences-per-chapter",
        type=_bounded_int(1, 100),
        default=8,
        help="Target sentences per chapter (1-100, default: 8)",
    )
    parser.add_argument(
        "--model",
        default="gpt-4.1-mini",
        help="OpenAI model used to invent the story idea (default: gpt-4.1-mini)",
    )
    parser.add_argument(
        "--ai-model",
        choices=ALLOWED_STORY_MODELS,
        default=None,
        help="Optional model used by the server to write the story (default: server default)",
    )
    parser.add_argument(
        "--no-publish",
        dest="publish",
        action="store_false",
        help="Create a draft instead of publishing after generation",
    )
    parser.set_defaults(publish=True)
    parser.add_argument(
        "--idempotency-key",
        default="",
        help="Override the generated Idempotency-Key (useful for retries)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=5.0,
        help="Seconds between status polls (default: 5)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=900.0,
        help="Maximum seconds to wait for generation (default: 900)",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to write the idea, request and resulting story as JSON",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only generate the idea and print the API request; do not call the API",
    )
    return parser


async def run(args: argparse.Namespace) -> None:
    idea = await generate_story_idea(
        model=args.model,
        level=args.level,
        chapters=args.chapters,
        sentences_per_chapter=args.sentences_per_chapter,
        theme=args.theme,
        native_language=args.native_language,
        learning_language=args.learning_language,
    )
    payload = build_story_payload(idea, args)

    log.info(
        "Idea: %s / %s",
        idea["title_native"],
        idea["title_learning"] or "(no title in the learning language)",
    )
    log.info("Theme: %s", payload["topic"])
    log.info("Vocabulary: %s", ", ".join(idea["vocabulary"]) or "(none)")
    log.info("Seed: %s", payload["seed"])

    if args.dry_run:
        print(json.dumps({"idea": idea, "request": payload}, ensure_ascii=False, indent=2))
        return

    if not args.api_key:
        raise StoryCreatorError(
            "STORYCREATOR_API_KEY is not set (or pass --api-key). "
            "The key must have the stories:write scope."
        )

    idempotency_key = (
        args.idempotency_key.strip()
        or os.environ.get("STORYCREATOR_IDEMPOTENCY_KEY", "").strip()
        or _default_idempotency_key()
    )
    timeout = httpx.Timeout(60.0, connect=15.0)

    async with httpx.AsyncClient(
        base_url=args.api_url.rstrip("/"),
        headers={"Authorization": f"Bearer {args.api_key}"},
        timeout=timeout,
    ) as client:
        api = StoryCreatorApi(client)

        log.info("Creating story via %s (idempotency key: %s)", args.api_url, idempotency_key)
        created = await api.create_story(payload, idempotency_key)
        story_id = created["id"]
        log.info("Story queued: id=%s state=%s", story_id, created.get("status"))

        story = await wait_for_story(
            api,
            story_id,
            poll_interval=args.poll_interval,
            timeout=args.timeout,
        )

    status = story.get("status") if isinstance(story.get("status"), dict) else {}
    log.info("Story ready: id=%s", story.get("id", story_id))
    log.info("  title: %s / %s", story["title"]["lang1"], story["title"]["lang2"])
    log.info(
        "  chapters: %d | sentences: %s | published: %s",
        len(story.get("chapters", [])),
        story.get("sentenceCount", 0),
        status.get("published"),
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "idempotency_key": idempotency_key,
                    "idea": idea,
                    "request": payload,
                    "story": story,
                },
                handle,
                ensure_ascii=False,
                indent=2,
            )
        log.info("Wrote %s", args.output)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    openai_key = os.environ.get("OPEN_AI_KEY") or os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        log.error("OPEN_AI_KEY (or OPENAI_API_KEY) must be set for idea generation")
        return 1
    if not os.environ.get("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = openai_key

    if args.native_language == args.learning_language:
        log.error("--native-language and --learning-language must differ")
        return 1
    if args.poll_interval <= 0:
        log.error("--poll-interval must be greater than 0")
        return 1
    if args.timeout <= 0:
        log.error("--timeout must be greater than 0")
        return 1

    try:
        asyncio.run(run(args))
    except StoryCreatorError as exc:
        log.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        log.warning("Interrupted")
        return 130
    except Exception as exc:  # noqa: BLE001 - top-level guard for scheduled jobs
        log.exception("Unexpected failure: %s", exc)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
