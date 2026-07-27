"""Phase 2.1 done-when gate: does the SageMaker job's S3 output match Phase 1's
local output?

Usage: python scripts/compare_s3_output.py <local_phase1_dir> <sagemaker_download_dir>
e.g.:  python scripts/compare_s3_output.py output output/sagemaker-2.1

local dir holds song_lyrics.json (translated - only originalText/timing/words are
compared), pitch.json, stems/htdemucs/input_song/. Remote dir holds transcript.json
(untranslated by design - translation is the RunTranslation Lambda in Phase 2.3),
pitch.json, stems/htdemucs/input_song/.

GPU (float16/CUDA) vs CPU (int8) runs are not bit-identical; tolerances are wide
enough for that drift, tight enough to catch a wrong model or a broken stage
(the Phase 1.2 medium-vs-large-v3 quality gap was a ~30% line-count difference;
we allow ~14%).
"""
import difflib
import json
import statistics
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

LINE_COUNT_TOLERANCE = 5        # absolute lines (local baseline: 35)
WORD_COUNT_REL = 0.15
TEXT_SIMILARITY_MIN = 0.80      # concatenated originalText, casefolded
EDGE_TIMESTAMP_TOLERANCE_S = 3.0
STEM_DURATION_REL = 0.005
STEM_RMS_REL = 0.25
NOTE_COUNT_REL = 0.20           # local baseline: 697
MEDIAN_PITCH_TOLERANCE = 2      # semitones


def within(actual: float, expected: float, rel: float) -> bool:
    if expected == 0:
        return actual == 0
    return abs(actual - expected) / abs(expected) <= rel


def text_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.casefold(), b.casefold()).ratio()


def wav_stats(path: Path) -> dict:
    data, sr = sf.read(str(path))
    if data.ndim > 1:
        data = data.mean(axis=1)
    return {"duration": len(data) / sr, "rms": float(np.sqrt(np.mean(data**2)))}


def compare_stems(local_stem_dir: Path, remote_stem_dir: Path) -> list[str]:
    problems = []
    for name in ("vocals.wav", "no_vocals.wav"):
        local_p, remote_p = local_stem_dir / name, remote_stem_dir / name
        if not remote_p.exists():
            problems.append(f"stems: remote {name} missing")
            continue
        ls, rs = wav_stats(local_p), wav_stats(remote_p)
        if not within(rs["duration"], ls["duration"], STEM_DURATION_REL):
            problems.append(f"stems {name}: duration {rs['duration']:.2f}s vs local {ls['duration']:.2f}s")
        if not within(rs["rms"], ls["rms"], STEM_RMS_REL):
            problems.append(f"stems {name}: RMS {rs['rms']:.5f} vs local {ls['rms']:.5f} (>{STEM_RMS_REL:.0%})")
    return problems


def compare_transcripts(local_lines: list, remote_lines: list) -> list[str]:
    problems = []
    if abs(len(local_lines) - len(remote_lines)) > LINE_COUNT_TOLERANCE:
        problems.append(f"transcript line count: {len(remote_lines)} vs local {len(local_lines)} "
                        f"(tolerance +/-{LINE_COUNT_TOLERANCE})")
    lw = sum(len(l["words"]) for l in local_lines)
    rw = sum(len(l["words"]) for l in remote_lines)
    if not within(rw, lw, WORD_COUNT_REL):
        problems.append(f"transcript word count: {rw} vs local {lw} (>{WORD_COUNT_REL:.0%})")
    sim = text_similarity(" ".join(l["originalText"] for l in local_lines),
                          " ".join(l["originalText"] for l in remote_lines))
    if sim < TEXT_SIMILARITY_MIN:
        problems.append(f"transcript text similarity {sim:.2f} < {TEXT_SIMILARITY_MIN}")
    if local_lines and remote_lines:
        if abs(local_lines[0]["startTime"] - remote_lines[0]["startTime"]) > EDGE_TIMESTAMP_TOLERANCE_S:
            problems.append("transcript: first-line startTime drifted "
                            f"({remote_lines[0]['startTime']:.2f} vs {local_lines[0]['startTime']:.2f})")
        if abs(local_lines[-1]["endTime"] - remote_lines[-1]["endTime"]) > EDGE_TIMESTAMP_TOLERANCE_S:
            problems.append("transcript: last-line endTime drifted "
                            f"({remote_lines[-1]['endTime']:.2f} vs {local_lines[-1]['endTime']:.2f})")
    return problems


def compare_pitch_notes(local_notes: list, remote_notes: list) -> list[str]:
    problems = []
    if not within(len(remote_notes), len(local_notes), NOTE_COUNT_REL):
        problems.append(f"pitch note count: {len(remote_notes)} vs local {len(local_notes)} "
                        f"(>{NOTE_COUNT_REL:.0%})")
    if local_notes and remote_notes:
        lm = statistics.median(n["pitch"] for n in local_notes)
        rm = statistics.median(n["pitch"] for n in remote_notes)
        if abs(lm - rm) > MEDIAN_PITCH_TOLERANCE:
            problems.append(f"pitch median: {rm} vs local {lm} (> {MEDIAN_PITCH_TOLERANCE} semitones)")
    return problems


def main() -> int:
    local_dir, remote_dir = Path(sys.argv[1]), Path(sys.argv[2])
    local_lines = json.loads((local_dir / "song_lyrics.json").read_text(encoding="utf-8"))["lines"]
    remote_lines = json.loads((remote_dir / "transcript.json").read_text(encoding="utf-8"))["lines"]
    local_notes = json.loads((local_dir / "pitch.json").read_text(encoding="utf-8"))["notes"]
    remote_notes = json.loads((remote_dir / "pitch.json").read_text(encoding="utf-8"))["notes"]

    problems = []
    problems += compare_stems(local_dir / "stems" / "htdemucs" / "input_song",
                              remote_dir / "stems" / "htdemucs" / "input_song")
    problems += compare_transcripts(local_lines, remote_lines)
    problems += compare_pitch_notes(local_notes, remote_notes)
    if not (remote_dir / "melody.mid").exists():
        problems.append("remote melody.mid missing")

    print(f"Compared {remote_dir} against Phase 1 local {local_dir}:")
    print(f"  lines: {len(remote_lines)} vs {len(local_lines)} | "
          f"notes: {len(remote_notes)} vs {len(local_notes)}")
    if problems:
        print("FAIL - Phase 2.1 done-when NOT met:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("PASS - SageMaker output matches Phase 1 local output within tolerances.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
