"""run_ml_stages chains separation -> concurrent transcribe+pitch, no translation."""
from dataclasses import dataclass, field

import ml_stages


@dataclass
class FakeWord:
    word: str
    start: float
    end: float


@dataclass
class FakeSegment:
    text: str
    start: float
    end: float
    words: list = field(default_factory=list)


def _install_fake_stages(monkeypatch, calls):
    def fake_separate(input_path, output_dir):
        calls.append(("separate", input_path, output_dir))
        return {"vocals": "fake/vocals.wav", "no_vocals": "fake/no_vocals.wav"}

    def fake_transcribe(vocal_path, language="ro"):
        calls.append(("transcribe", vocal_path, language))
        return {"segments": [FakeSegment(" Salut ", 1.0, 2.0, [FakeWord(" Salut", 1.0, 2.0)])]}

    def fake_extract_pitch(vocal_path):
        calls.append(("extract_pitch", vocal_path))
        return {"notes": [{"pitch": 60, "start": 0.0, "end": 1.0, "velocity": 0.5}], "midi": object()}

    monkeypatch.setattr(ml_stages, "separate", fake_separate)
    monkeypatch.setattr(ml_stages, "transcribe", fake_transcribe)
    monkeypatch.setattr(ml_stages, "extract_pitch", fake_extract_pitch)


def test_chains_stages_and_returns_untranslated_lines(monkeypatch, tmp_path):
    calls = []
    _install_fake_stages(monkeypatch, calls)

    result = ml_stages.run_ml_stages("song.mp3", tmp_path, source_language="ro")

    assert calls[0] == ("separate", "song.mp3", str(tmp_path / "stems"))
    assert ("transcribe", "fake/vocals.wav", "ro") in calls
    assert ("extract_pitch", "fake/vocals.wav") in calls
    assert result["stems"]["vocals"] == "fake/vocals.wav"
    line = result["lines"][0]
    assert line["originalText"] == "Salut"
    assert line["translatedText"] is None  # translation is NOT this module's job
    assert line["words"] == [{"text": "Salut", "start": 1.0, "end": 2.0}]
    assert result["pitch_data"]["notes"][0]["pitch"] == 60
    assert set(result["timings"]) == {"demucs", "whisper_and_pitch_concurrent"}


def test_creates_output_dir(monkeypatch, tmp_path):
    _install_fake_stages(monkeypatch, [])
    out = tmp_path / "nested" / "out"
    ml_stages.run_ml_stages("song.mp3", out)
    assert out.is_dir()
