"""
Voice catalog for the TTS worker.

A voice ID is a *timbre*, not a language binding: the same voice can narrate any of the
supported languages. The per-language entries below exist so each language can have a
narrator whose accent fits, mirroring the approach already used in PortugueseLearning
(`data/TextToSpeechGenerator.py`).

Only `pt`, `fr` and `en` have curated IDs today (copied from PortugueseLearning).
Every other language falls back to `DEFAULT_VOICE` and logs a one-time warning — fill the
remaining entries in from the ElevenLabs dashboard when voices are chosen.
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

log = logging.getLogger("tts-worker")

# Curated voice per language code (ISO 639-1), matching PortugueseLearning.
VOICES: Dict[str, str] = {
    # European Portuguese accent
    "pt": "aLFUti4k8YKvtQGXv0UO",
    # French (Rachel)
    "fr": "ICk609TItINMseDpChFt",
    # English (Adam)
    "en": "pNInz6obpgDQGcFmaJgB",
}

# Multi-language capable timbre used when a language has no curated voice yet.
DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB"

_warned: set[str] = set()


def voice_for(language_code: str, override: Optional[str] = None) -> str:
    """Return the ElevenLabs voice ID for a language code.

    `override` (from `TTS_VOICE`) wins for every language, which is handy for testing.
    """
    if override:
        return override

    code = (language_code or "").strip().lower()
    voice = VOICES.get(code)
    if voice:
        return voice

    if code and code not in _warned:
        _warned.add(code)
        log.warning(
            "No curated voice for language '%s'; falling back to DEFAULT_VOICE %s",
            code,
            DEFAULT_VOICE,
        )
    return DEFAULT_VOICE
