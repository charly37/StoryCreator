import math
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
import wave
from unittest.mock import patch

import audio_render


class FakeClip:
    def __init__(self, samples):
        self.raw_data = struct.pack(f"<{len(samples)}h", *samples)
        self.max = max((abs(sample) for sample in samples), default=0)

    def set_sample_width(self, sample_width):
        if sample_width != audio_render.SAMPLE_WIDTH:
            raise AssertionError("unexpected sample width")
        return self


class BuildRenderTests(unittest.TestCase):
    def run_render(self, segments, clips, output_path, scratch_dir):
        captured = {}

        def fake_ffmpeg(command, **_kwargs):
            staged_path = Path(command[command.index("-i") + 1])
            with wave.open(str(staged_path), "rb") as staged:
                captured["channels"] = staged.getnchannels()
                captured["sample_width"] = staged.getsampwidth()
                captured["sample_rate"] = staged.getframerate()
                captured["frames"] = staged.getnframes()
                captured["pcm"] = staged.readframes(staged.getnframes())
            captured["command"] = command
            Path(command[-1]).write_bytes(b"mock-mp3")

        with patch.object(audio_render, "load_clip", side_effect=lambda path: clips[path.name]), patch.object(
            audio_render.subprocess, "run", side_effect=fake_ffmpeg
        ):
            result = audio_render.build_render(segments, output_path, scratch_dir=scratch_dir)
        return result, captured

    def test_stages_clips_in_order_with_existing_gaps_and_peak_gain(self):
        samples_by_name = {
            "one.mp3": [1000, -1000],
            "two.mp3": [2000, -2000],
            "three.mp3": [4000, -4000],
        }
        clips = {name: FakeClip(samples) for name, samples in samples_by_name.items()}
        segments = [
            {"path": "one.mp3", "chapterIndex": 0, "sentenceIndex": 0, "lang": "lang1"},
            {"path": "two.mp3", "chapterIndex": 0, "sentenceIndex": 0, "lang": "lang2"},
            {"path": "three.mp3", "chapterIndex": 1, "sentenceIndex": 0, "lang": "lang2"},
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "renders" / "story.mp3"
            scratch_dir = root / audio_render.RENDER_TEMP_DIR
            (duration_ms, size_bytes), captured = self.run_render(
                segments, clips, output_path, scratch_dir
            )

            expected_samples = (
                samples_by_name["one.mp3"]
                + [0] * (audio_render.LANGUAGE_GAP_MS * audio_render.SAMPLE_RATE // 1000)
                + samples_by_name["two.mp3"]
                + [0] * (audio_render.CHAPTER_GAP_MS * audio_render.SAMPLE_RATE // 1000)
                + samples_by_name["three.mp3"]
            )
            expected_pcm = struct.pack(f"<{len(expected_samples)}h", *expected_samples)
            self.assertEqual(captured["pcm"], expected_pcm)
            self.assertEqual(captured["channels"], 1)
            self.assertEqual(captured["sample_width"], 2)
            self.assertEqual(captured["sample_rate"], 44100)
            self.assertEqual(duration_ms, round(len(expected_samples) * 1000 / 44100))
            self.assertEqual(size_bytes, len(b"mock-mp3"))
            command = captured["command"]
            gain = float(command[command.index("-af") + 1].removeprefix("volume=").removesuffix("dB"))
            expected_gain = -0.1 - 20 * math.log10(4000 / 32768)
            self.assertAlmostEqual(gain, expected_gain, places=6)
            self.assertIn("128k", command)
            self.assertEqual(list(scratch_dir.iterdir()), [])

    def test_silent_render_skips_peak_gain(self):
        segments = [{"path": "silent.mp3", "chapterIndex": 0, "sentenceIndex": 0, "lang": "lang1"}]
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _, captured = self.run_render(
                segments,
                {"silent.mp3": FakeClip([0, 0])},
                root / "silent.mp3",
                root / audio_render.RENDER_TEMP_DIR,
            )
        self.assertNotIn("-af", captured["command"])

    def test_ffmpeg_failure_preserves_existing_output_and_cleans_workspace(self):
        segments = [{"path": "clip.mp3", "chapterIndex": 0, "sentenceIndex": 0, "lang": "lang1"}]
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "existing.mp3"
            output_path.write_bytes(b"previous-render")
            scratch_dir = root / audio_render.RENDER_TEMP_DIR
            with patch.object(audio_render, "load_clip", return_value=FakeClip([100, -100])), patch.object(
                audio_render.subprocess,
                "run",
                side_effect=subprocess.CalledProcessError(1, "ffmpeg"),
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    audio_render.build_render(segments, output_path, scratch_dir=scratch_dir)
            self.assertEqual(output_path.read_bytes(), b"previous-render")
            self.assertEqual(list(scratch_dir.iterdir()), [])

    def test_startup_cleanup_removes_only_stale_render_workspaces(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_dir = Path(temp_dir)
            scratch_dir = audio_dir / audio_render.RENDER_TEMP_DIR
            stale = scratch_dir / "render-stale"
            fresh = scratch_dir / "render-fresh"
            unrelated = scratch_dir / "keep-me"
            for path in (stale, fresh, unrelated):
                path.mkdir(parents=True)
            os.utime(stale, (50, 50))
            os.utime(fresh, (95, 95))

            removed = audio_render.cleanup_stale_render_temps(
                audio_dir, now=100, max_age_seconds=10
            )

            self.assertEqual(removed, 1)
            self.assertFalse(stale.exists())
            self.assertTrue(fresh.exists())
            self.assertTrue(unrelated.exists())


if __name__ == "__main__":
    unittest.main()