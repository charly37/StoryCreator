"""
Clip -> render assembly for the TTS worker.

Ported from `PortugueseLearning/vocal_lesson_creator/combine_mp3.py`, which is the
proven implementation in this repo:

* every clip is normalized to -16 LUFS (ITU-R BS.1770) before it is mixed, with an
  RMS dBFS fallback for clips too short to measure;
* silence is generated between clips rather than trimmed from the source;
* the finished render is peak-normalized with `headroom=0.1`;
* export uses pydub's mp3 defaults (one encode, from decoded PCM).

Gaps differ from the vocabulary lessons on purpose: 1300/2000 ms gives a learner time
to recall a word, but would make story narration crawl.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any, Iterable, Sequence

log = logging.getLogger("tts-worker")

TARGET_LUFS = -16.0
# BS.1770 needs enough material to integrate; shorter clips fall back to RMS.
MIN_LUFS_MS = 400

# Everything is normalized to one format before concatenation. pydub's
# `AudioSegment.silent()` defaults to 11025 Hz, so gaps generated without an explicit
# frame_rate would rely on implicit resampling during append.
SAMPLE_RATE = 44100
CHANNELS = 1

SENTENCE_GAP_MS = 250
LANGUAGE_GAP_MS = 700
CHAPTER_GAP_MS = 1200


def normalize_lufs(segment: Any) -> Any:
    """Bring a clip to TARGET_LUFS, falling back to RMS for very short clips."""
    import numpy as np
    import pyloudnorm as pyln

    duration_ms = len(segment)
    samples = np.array(segment.get_array_of_samples(), dtype=np.float32)
    samples /= 2 ** (segment.sample_width * 8 - 1)
    if getattr(segment, "channels", 1) > 1:
        samples = samples.reshape((-1, segment.channels))

    loudness = float("-inf")
    if duration_ms >= MIN_LUFS_MS:
        meter = pyln.Meter(segment.frame_rate)
        loudness = meter.integrated_loudness(samples)

    if loudness == float("-inf") or math.isnan(loudness):
        if segment.dBFS == float("-inf"):
            return segment
        return segment.apply_gain(TARGET_LUFS - segment.dBFS)

    return segment.apply_gain(TARGET_LUFS - loudness)


def load_clip(path: Path) -> Any:
    from pydub import AudioSegment

    clip = AudioSegment.from_mp3(str(path))
    # Providers are not guaranteed to agree on rate/channel count; fixes the mix.
    clip = clip.set_frame_rate(SAMPLE_RATE).set_channels(CHANNELS)
    return normalize_lufs(clip)


def gap_between(previous: dict, current: dict) -> int:
    """Silence inserted between two consecutive segments."""
    if previous.get("chapterIndex") != current.get("chapterIndex"):
        return CHAPTER_GAP_MS
    if previous.get("lang") != current.get("lang"):
        return LANGUAGE_GAP_MS
    return SENTENCE_GAP_MS


def build_render(segments: Sequence[dict], output_path: Path) -> tuple[int, int]:
    """Concatenate `segments` into one MP3.

    Each segment needs `chapterIndex`, `sentenceIndex`, `lang` and `path`. Returns
    `(duration_ms, size_bytes)`.
    """
    from pydub import AudioSegment, effects

    if not segments:
        raise ValueError("Cannot build a render from zero segments")

    combined = None
    previous: dict | None = None
    for segment in segments:
        clip = load_clip(Path(segment["path"]))
        if combined is None:
            combined = clip
        else:
            combined += AudioSegment.silent(
                duration=gap_between(previous, segment), frame_rate=SAMPLE_RATE
            )
            combined += clip
        previous = segment

    try:
        combined = effects.normalize(combined, headroom=0.1)
    except ValueError:
        # pydub refuses to peak-normalize a segment with no audio data at all.
        log.warning("Render has no measurable audio; skipping peak normalization")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined.export(str(output_path), format="mp3")

    duration_ms = len(combined)
    size_bytes = output_path.stat().st_size
    log.debug(
        "Rendered %s from %d clips (%.1fs, %d bytes, gain-adjusted peak %.1f dBFS)",
        output_path.name,
        len(segments),
        duration_ms / 1000,
        size_bytes,
        combined.max_dBFS,
    )
    return duration_ms, size_bytes


def speech_segments(clips: Iterable[dict], lang: str) -> list[dict]:
    """Segments for a single language, in (chapter, sentence) order."""
    ordered = sorted(clips, key=lambda c: (c["chapterIndex"], c["sentenceIndex"]))
    return [{**clip, "lang": lang} for clip in ordered]


def bilingual_segments(lang1_clips: Iterable[dict], lang2_clips: Iterable[dict]) -> list[dict]:
    """Interleave per sentence, native language first.

    Ordering matches PortugueseLearning's translation-first convention: the listener
    hears the familiar language, then the language being learned.
    """
    by_key: dict[tuple[int, int], dict[str, dict]] = {}
    for lang, clips in (("lang1", lang1_clips), ("lang2", lang2_clips)):
        for clip in clips:
            key = (clip["chapterIndex"], clip["sentenceIndex"])
            by_key.setdefault(key, {})[lang] = {**clip, "lang": lang}

    ordered: list[dict] = []
    for key in sorted(by_key):
        pair = by_key[key]
        for lang in ("lang1", "lang2"):
            if lang in pair:
                ordered.append(pair[lang])
    return ordered
