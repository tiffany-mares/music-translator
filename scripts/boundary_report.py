"""Phase 2.5 mid-word documentation: what does stitching actually do at each
chunk boundary? Prints whole-song-run vs stitched lines around every cut.

Usage: python scripts/boundary_report.py <local_dir> <stitched_dir> <duration_seconds>
e.g.:  python scripts/boundary_report.py output output/stitched-2.5 215.4

Informational (always exit 0) - the findings get recorded in notes/phase2.md
section 2.5; the pass/fail judgment is the compare_s3_output.py gate.
"""
import json
import sys

CHUNK_SECONDS = 40.0
OVERLAP_SECONDS = 2.5


def cut_points(duration: float, chunk_seconds: float = CHUNK_SECONDS,
               overlap_seconds: float = OVERLAP_SECONDS) -> list:
    # One cut per interior chunk boundary; the chunk count comes from the same
    # loop compute_chunks uses, so the cuts match the real manifest.
    stride = chunk_seconds - overlap_seconds
    n_chunks, start = 1, 0.0
    while start + chunk_seconds < duration:
        n_chunks += 1
        start += stride
    return [round(stride * i + overlap_seconds / 2, 6) for i in range(1, n_chunks)]


def window_lines(lines: list, center: float, half_width: float = 3.0) -> list:
    return [l for l in lines
            if l["startTime"] < center + half_width and l["endTime"] > center - half_width]


def _fmt(lines):
    return [f"[{l['startTime']:7.2f}-{l['endTime']:7.2f}] {l['originalText']}" for l in lines]


def main() -> int:
    local_dir, stitched_dir, duration = sys.argv[1], sys.argv[2], float(sys.argv[3])
    local = json.load(open(f"{local_dir}/song_lyrics.json", encoding="utf-8"))["lines"]
    stitched = json.load(open(f"{stitched_dir}/transcript.json", encoding="utf-8"))["lines"]

    for cut in cut_points(duration):
        print(f"\n=== boundary cut at {cut}s ===")
        print("  whole-song run:")
        for s in _fmt(window_lines(local, cut)):
            print(f"    {s}")
        print("  stitched:")
        for s in _fmt(window_lines(stitched, cut)):
            print(f"    {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
