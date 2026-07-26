"""container/process.py pure helpers: input discovery and output writing."""
import importlib.util
import json
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "process_entrypoint", Path(__file__).resolve().parents[1] / "container" / "process.py"
)
process = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(process)


class FakeMidi:
    def write(self, path):
        Path(path).write_bytes(b"MThd fake")


def _fake_result():
    return {
        "stems": {"vocals": "x/vocals.wav", "no_vocals": "x/no_vocals.wav"},
        "lines": [{"lineNumber": 1, "originalText": "Salut", "translatedText": None,
                   "startTime": 0.0, "endTime": 1.0,
                   "words": [{"text": "Salut", "start": 0.0, "end": 1.0}]}],
        "pitch_data": {"notes": [{"pitch": 60, "start": 0.0, "end": 1.0, "velocity": 0.5}],
                       "midi": FakeMidi()},
        "timings": {"demucs": 1.0, "whisper_and_pitch_concurrent": 2.0},
    }


def test_find_input_song_picks_audio_file(tmp_path):
    (tmp_path / "notes.txt").write_text("not audio")
    (tmp_path / "input_song.mp3").write_bytes(b"\xff\xfb")
    assert process.find_input_song(tmp_path).name == "input_song.mp3"


def test_find_input_song_errors_on_empty_dir(tmp_path):
    with pytest.raises(FileNotFoundError):
        process.find_input_song(tmp_path)


def test_write_outputs_threads_song_id_through_every_file(tmp_path):
    process.write_outputs(_fake_result(), tmp_path, song_id="test-song-001", source_language="ro")

    transcript = json.loads((tmp_path / "transcript.json").read_text(encoding="utf-8"))
    assert transcript["songId"] == "test-song-001"
    assert transcript["sourceLanguage"] == "ro"
    assert transcript["lines"][0]["originalText"] == "Salut"
    assert transcript["lines"][0]["translatedText"] is None

    pitch = json.loads((tmp_path / "pitch.json").read_text(encoding="utf-8"))
    assert pitch["songId"] == "test-song-001"
    assert pitch["notes"][0]["pitch"] == 60

    timings = json.loads((tmp_path / "timings.json").read_text(encoding="utf-8"))
    assert timings["demucs"] == 1.0

    assert (tmp_path / "melody.mid").exists()
