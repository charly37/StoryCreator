#!/usr/bin/env python3
"""
TtsWorker.py — poll the StoryCreator TTS request queue and report what is waiting.

Step 1 of the audio framework: this worker is deliberately read-only. It connects
to MongoDB, watches the `ttsrequests` collection for documents with
`status == "queued"`, and logs each one exactly once per process lifetime. It does
NOT claim jobs, does NOT synthesize audio, and never writes to the database.

Because it never touches the documents, a job that stays `queued` would be logged
on every poll. An in-memory set of seen `_id`s keeps the log to one line per job
(and one repeat after a restart, which is harmless).

Environment:
  MONGODB_URI     MongoDB connection string (required)
  POLL_INTERVAL   Seconds between polls (default: 5)
  LOG_LEVEL       debug | info | warn | error | ... (default: INFO)

CLI flags mirror the environment variables and take precedence, matching
DialectHubAgent/StoryCreatorAgent.py:

  python -u TtsWorker/TtsWorker.py --once --poll-interval 2
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from typing import Any

from pymongo import MongoClient
from pymongo.collection import Collection

DEFAULT_POLL_INTERVAL = 5.0
COLLECTION_NAME = "ttsrequests"
BATCH_SIZE = 50

# Accept both the pino vocabulary used by the Node backend / Helm values and the
# standard logging names.
LOG_LEVEL_ALIASES = {
    "TRACE": "DEBUG",
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "WARN": "WARNING",
    "WARNING": "WARNING",
    "ERROR": "ERROR",
    "FATAL": "CRITICAL",
    "SILENT": "CRITICAL",
}


def _log_level() -> int:
    raw = os.environ.get("LOG_LEVEL", "INFO").upper()
    return getattr(logging, LOG_LEVEL_ALIASES.get(raw, "INFO"))


logging.basicConfig(
    level=_log_level(),
    stream=sys.stdout,
    format="%(levelname)s %(message)s",
)
log = logging.getLogger("tts-worker")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Watch the StoryCreator TTS request queue (read-only).",
    )
    parser.add_argument(
        "--mongo-uri",
        default=os.environ.get("MONGODB_URI", ""),
        help="MongoDB connection string (default: $MONGODB_URI)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.environ.get("POLL_INTERVAL", DEFAULT_POLL_INTERVAL)),
        help=f"Seconds between polls (default: {DEFAULT_POLL_INTERVAL:g})",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Poll a single time and exit (useful for smoke tests).",
    )
    return parser.parse_args(argv)


def connect(mongo_uri: str) -> tuple[MongoClient, Collection]:
    """Open the client and fail fast if the deployment is unreachable."""
    client: MongoClient = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000)
    client.admin.command("ping")
    return client, client.get_default_database()[COLLECTION_NAME]


def poll_once(collection: Collection, seen: set[Any]) -> int:
    """Log every queued request not yet announced. Returns how many were new."""
    new_jobs = 0
    cursor = (
        collection.find({"status": "queued"}, {"storyId": 1, "lang": 1, "requestedAt": 1})
        .sort("requestedAt", 1)
        .limit(BATCH_SIZE)
    )
    for doc in cursor:
        request_id = doc["_id"]
        if request_id in seen:
            continue
        seen.add(request_id)
        new_jobs += 1
        log.info(
            "Found TTS request %s for story %s (%s), queued at %s",
            request_id,
            doc.get("storyId"),
            doc.get("lang"),
            doc.get("requestedAt"),
        )
    return new_jobs


def run(args: argparse.Namespace) -> int:
    if not args.mongo_uri:
        log.error("MONGODB_URI is not set (or pass --mongo-uri)")
        return 1
    if args.poll_interval <= 0:
        log.error("--poll-interval must be greater than zero")
        return 1

    client, collection = connect(args.mongo_uri)
    log.info(
        "Watching collection %s every %gs (read-only; no audio generation yet)",
        COLLECTION_NAME,
        args.poll_interval,
    )

    stop = False

    def _request_stop(signum: int, _frame: Any) -> None:
        nonlocal stop
        log.info("Received signal %s, shutting down", signum)
        stop = True

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    seen: set[Any] = set()
    try:
        while not stop:
            poll_once(collection, seen)
            if args.once:
                break
            # Sleep in short slices so SIGTERM is honoured promptly.
            deadline = time.monotonic() + args.poll_interval
            while not stop and time.monotonic() < deadline:
                time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
    finally:
        client.close()

    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except KeyboardInterrupt:
        log.warning("Interrupted")
        return 130
    except Exception as exc:  # noqa: BLE001 - top-level guard for a long-running worker
        log.exception("Unexpected failure: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
