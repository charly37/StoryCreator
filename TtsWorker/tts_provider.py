"""
Text-to-speech providers for the StoryCreator worker.

Two implementations:

* `ElevenLabsProvider` — the provider already proven in PortugueseLearning
  (`eleven_flash_v2_5`, `mp3_44100_128`).
* `FakeProvider` — emits silence sized from the input text, so the whole
  clip -> render -> serve pipeline can be exercised without spending credits.
  Select it with `TTS_PROVIDER=fake`.

Quota exhaustion is signalled with `QuotaExceededError` so the worker can put the
request back on the queue instead of burning an attempt.
"""

from __future__ import annotations

import io
import logging
import os

log = logging.getLogger("tts-worker")

DEFAULT_MODEL_ID = "eleven_flash_v2_5"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_SPEED = 1.0


class QuotaExceededError(RuntimeError):
    """Raised when the provider reports that the account is out of credits."""


class TtsError(RuntimeError):
    """Raised for any other synthesis failure."""


def _is_quota_error(message: str) -> bool:
    lowered = message.lower()
    return "quota_exceeded" in lowered or ("401" in lowered and "quota" in lowered)


class ElevenLabsProvider:
    """Thin wrapper over `elevenlabs.client.ElevenLabs`."""

    def __init__(
        self,
        api_key: str,
        model_id: str = DEFAULT_MODEL_ID,
        output_format: str = DEFAULT_OUTPUT_FORMAT,
        speed: float = DEFAULT_SPEED,
    ) -> None:
        # Imported lazily so the fake provider works without the SDK installed.
        from elevenlabs.client import ElevenLabs

        self._client = ElevenLabs(api_key=api_key)
        self._model_id = model_id
        self._output_format = output_format
        self._speed = speed

    def synthesize(self, text: str, language_code: str, voice_id: str) -> bytes:
        from elevenlabs import VoiceSettings

        try:
            stream = self._client.text_to_speech.convert(
                text=text,
                voice_id=voice_id,
                language_code=language_code or None,
                model_id=self._model_id,
                output_format=self._output_format,
                voice_settings=VoiceSettings(speed=self._speed),
            )
            return b"".join(stream)
        except Exception as exc:  # noqa: BLE001 - SDK raises many shapes
            message = str(exc)
            if _is_quota_error(message):
                raise QuotaExceededError(f"ElevenLabs quota exceeded: {message}") from exc
            raise TtsError(f"ElevenLabs synthesis failed: {message}") from exc


class FakeProvider:
    """Writes silence instead of speech. No network, no credits."""

    def __init__(self, ms_per_char: int = 50, min_ms: int = 300) -> None:
        self._ms_per_char = ms_per_char
        self._min_ms = min_ms

    def synthesize(self, text: str, language_code: str, voice_id: str) -> bytes:
        from pydub import AudioSegment

        duration = max(self._min_ms, len(text) * self._ms_per_char)
        buffer = io.BytesIO()
        AudioSegment.silent(duration=duration, frame_rate=44100).export(buffer, format="mp3")
        return buffer.getvalue()


def build_provider(dry_run: bool = False):
    """Resolve the provider from the environment (`TTS_PROVIDER`)."""
    name = os.environ.get("TTS_PROVIDER", "elevenlabs").strip().lower()
    if dry_run or name == "fake":
        log.info("Using fake TTS provider (silence; no credits consumed)")
        return FakeProvider()

    api_key = os.environ.get("TEXT_TO_SPEECH_API_KEY", "").strip()
    if not api_key:
        raise TtsError("TEXT_TO_SPEECH_API_KEY is not set")

    speed = float(os.environ.get("TTS_SPEED", DEFAULT_SPEED))
    log.info(
        "Using ElevenLabs provider (model=%s, format=%s, speed=%s)",
        DEFAULT_MODEL_ID,
        DEFAULT_OUTPUT_FORMAT,
        speed,
    )
    return ElevenLabsProvider(api_key=api_key, speed=speed)
