"""Automated sanity checks on Demucs stem output (Phase 1.1).

This does NOT check separation quality (bleed/artifacts) — that requires
a human listening. It only catches the "something is obviously broken"
cases (missing files, wrong duration, silent output) before you spend
time on the manual review in notes/phase1.md.
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

INPUT_SONG = Path("test_data/input_song.mp3")
STEMS_DIR = Path("output/stems/htdemucs/input_song")
VOCALS = STEMS_DIR / "vocals.wav"
NO_VOCALS = STEMS_DIR / "no_vocals.wav"

DURATION_TOLERANCE_SEC = 0.5
SILENCE_RMS_THRESHOLD = 0.001


def get_duration_sec(path: Path) -> float:
    info = sf.info(str(path))
    return info.frames / info.samplerate


def get_rms(path: Path) -> float:
    data, _ = sf.read(str(path))
    return float(np.sqrt(np.mean(np.square(data))))


def main() -> None:
    missing = [p for p in (INPUT_SONG, VOCALS, NO_VOCALS) if not p.exists()]
    if missing:
        print("FAIL — required files missing:")
        for p in missing:
            print(f"  - {p}")
        sys.exit(1)

    input_duration = get_duration_sec(INPUT_SONG)
    vocals_duration = get_duration_sec(VOCALS)
    no_vocals_duration = get_duration_sec(NO_VOCALS)

    print(f"Input duration:      {input_duration:.2f}s")
    print(f"Vocals duration:     {vocals_duration:.2f}s")
    print(f"No-vocals duration:  {no_vocals_duration:.2f}s")

    errors = []
    if abs(vocals_duration - input_duration) > DURATION_TOLERANCE_SEC:
        errors.append(
            f"vocals.wav duration ({vocals_duration:.2f}s) differs from "
            f"input ({input_duration:.2f}s) by more than {DURATION_TOLERANCE_SEC}s"
        )
    if abs(no_vocals_duration - input_duration) > DURATION_TOLERANCE_SEC:
        errors.append(
            f"no_vocals.wav duration ({no_vocals_duration:.2f}s) differs from "
            f"input ({input_duration:.2f}s) by more than {DURATION_TOLERANCE_SEC}s"
        )

    vocals_rms = get_rms(VOCALS)
    no_vocals_rms = get_rms(NO_VOCALS)
    print(f"Vocals RMS:          {vocals_rms:.5f}")
    print(f"No-vocals RMS:       {no_vocals_rms:.5f}")

    if vocals_rms < SILENCE_RMS_THRESHOLD:
        errors.append(f"vocals.wav is near-silent (RMS {vocals_rms:.5f}) — separation likely failed")
    if no_vocals_rms < SILENCE_RMS_THRESHOLD:
        errors.append(f"no_vocals.wav is near-silent (RMS {no_vocals_rms:.5f}) — separation likely failed")

    if errors:
        print("\nFAIL:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("\nPASS — stems exist, durations match input, neither stem is silent.")
    print("Quality (bleed/artifacts) is NOT checked here — do the manual listening review next (notes/phase1.md).")


if __name__ == "__main__":
    main()
