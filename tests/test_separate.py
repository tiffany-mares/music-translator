from pathlib import Path

from stages.separate import stem_paths


def test_stem_paths_follows_demucs_layout():
    paths = stem_paths("test_data/input_song.mp3", "output/stems")

    assert paths["vocals"] == str(Path("output/stems") / "htdemucs" / "input_song" / "vocals.wav")
    assert paths["no_vocals"] == str(Path("output/stems") / "htdemucs" / "input_song" / "no_vocals.wav")


def test_stem_paths_uses_model_name_in_layout():
    paths = stem_paths("songs/melodie.mp3", "out", model="htdemucs_ft")

    assert paths["vocals"] == str(Path("out") / "htdemucs_ft" / "melodie" / "vocals.wav")


def test_stem_paths_strips_any_extension():
    paths = stem_paths("test_data/track.flac", "output/stems")

    assert "track" in paths["vocals"]
    assert ".flac" not in paths["vocals"]
