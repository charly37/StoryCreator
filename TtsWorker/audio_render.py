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
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any, Iterable, Sequence
import wave

log = logging.getLogger("tts-worker")

TARGET_LUFS = -16.0
# BS.1770 needs enough material to integrate; shorter clips fall back to RMS.
MIN_LUFS_MS = 400

# Everything is normalized to one format before concatenation. pydub's
# `AudioSegment.silent()` defaults to 11025 Hz, so gaps generated without an explicit
# frame_rate would rely on implicit resampling during append.
SAMPLE_RATE = 44100
CHANNELS = 1
SAMPLE_WIDTH = 2
MP3_BITRATE = "128k"
RENDER_TEMP_DIR = ".tts-render-tmp"
STALE_RENDER_TEMP_SECONDS = 24 * 60 * 60
PEAK_HEADROOM_DB = 0.1

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


def cleanup_stale_render_temps(
    audio_dir: Path,
    *,
    now: float | None = None,
    max_age_seconds: int = STALE_RENDER_TEMP_SECONDS,
) -> int:
    """Remove abandoned render workspaces left by killed worker processes."""
    temp_root = audio_dir / RENDER_TEMP_DIR
    if not temp_root.is_dir():
        return 0

    cutoff = (time.time() if now is None else now) - max_age_seconds
    removed = 0
    for path in temp_root.iterdir():
        if not path.name.startswith("render-") or path.is_symlink() or not path.is_dir():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                shutil.rmtree(path)
                removed += 1
        except OSError as exc:
            log.warning("Could not remove stale render workspace %s: %s", path, exc)
    return removed


def gap_between(previous: dict, current: dict) -> int:
    """Silence inserted between two consecutive segments."""
    if previous.get("chapterIndex") != current.get("chapterIndex"):
        return CHAPTER_GAP_MS
    if previous.get("lang") != current.get("lang"):
        return LANGUAGE_GAP_MS
    return SENTENCE_GAP_MS


def build_render(
    segments: Sequence[dict], output_path: Path, *, scratch_dir: Path | None = None
) -> tuple[int, int]:
    """Assemble `segments` into an MP3 using disk-backed PCM staging.

    Each segment needs `chapterIndex`, `sentenceIndex`, `lang` and `path`. Returns
    `(duration_ms, size_bytes)`.
    """
    if not segments:
        raise ValueError("Cannot build a render from zero segments")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    scratch_root = scratch_dir or output_path.parent / RENDER_TEMP_DIR
    scratch_root.mkdir(parents=True, exist_ok=True)
    total_frames = 0
    peak_sample = 0

    with tempfile.TemporaryDirectory(prefix="render-", dir=scratch_root) as workspace:
        workspace_path = Path(workspace)
        staged_path = workspace_path / "staged.wav"
        encoded_path = workspace_path / "render.mp3"

        with wave.open(str(staged_path), "wb") as staged:
            staged.setnchannels(CHANNELS)
            staged.setsampwidth(SAMPLE_WIDTH)
            staged.setframerate(SAMPLE_RATE)

            previous: dict | None = None
            for segment in segments:
                if previous is not None:
                    gap_frames = round(gap_between(previous, segment) * SAMPLE_RATE / 1000)
                    remaining = gap_frames
                    silence_chunk = bytes(65536 - (65536 % SAMPLE_WIDTH))
                    while remaining:
                        frames = min(remaining, len(silence_chunk) // SAMPLE_WIDTH)
                        staged.writeframesraw(silence_chunk[: frames * SAMPLE_WIDTH])
                        total_frames += frames
                        remaining -= frames

                clip = load_clip(Path(segment["path"])).set_sample_width(SAMPLE_WIDTH)
                raw_data = clip.raw_data
                if len(raw_data) % (SAMPLE_WIDTH * CHANNELS):
                    raise ValueError(f"Clip {segment['path']} has incomplete PCM frames")
                staged.writeframesraw(raw_data)
                total_frames += len(raw_data) // (SAMPLE_WIDTH * CHANNELS)
                peak_sample = max(peak_sample, clip.max)
                previous = segment
                os.utime(workspace_path, None)
                del clip, raw_data

        if peak_sample:
            peak_dbfs = 20 * math.log10(peak_sample / (2 ** (SAMPLE_WIDTH * 8 - 1)))
            gain_db = -PEAK_HEADROOM_DB - peak_dbfs
        else:
            log.warning("Render has no measurable audio; skipping peak normalization")
            gain_db = 0.0

        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(staged_path),
            "-map",
            "0:a:0",
        ]
        if gain_db:
            command.extend(["-af", f"volume={gain_db:.8f}dB"])
        command.extend(
            [
                "-c:a",
                "libmp3lame",
                "-b:a",
                MP3_BITRATE,
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                str(CHANNELS),
                "-f",
                "mp3",
                str(encoded_path),
            ]
        )
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.replace(encoded_path, output_path)

    duration_ms = round(total_frames * 1000 / SAMPLE_RATE)
    size_bytes = output_path.stat().st_size
    rendered_peak = -PEAK_HEADROOM_DB if peak_sample else float("-inf")
    log.debug(
        "Rendered %s from %d clips (%.1fs, %d bytes, gain-adjusted peak %.1f dBFS)",
        output_path.name,
        len(segments),
        duration_ms / 1000,
        size_bytes,
        rendered_peak,
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
