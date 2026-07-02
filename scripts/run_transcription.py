"""Run faster-whisper against the Phase 1.1 vocal stem and dump artifacts.

Writes, per model size:
  output/transcript_{model}.json       - MongoDB-shaped lines (section 6.2)
  output/transcript_{model}.lines.srt  - one subtitle per line (check line timing)
  output/transcript_{model}.words.srt  - one subtitle per word (check the
                                         karaoke-highlight timing the done-when
                                         criterion is actually about)

Load an .srt over the vocal stem in any player (e.g. VLC: open vocals.wav,
then Subtitles > Add Subtitle File) instead of scrubbing raw JSON.
Alternatively, output/timing_preview.html (when generated) plays the stem
with live line/word highlighting - no player install needed.
"""
import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from stages.transcribe import to_lines, transcribe  # noqa: E402

VOCALS = REPO_ROOT / "output" / "stems" / "htdemucs" / "input_song" / "vocals.wav"


def format_srt_timestamp(seconds: float) -> str:
    ms = max(0, round(seconds * 1000))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def to_srt(entries: list) -> str:
    blocks = []
    for i, (start, end, text) in enumerate(entries, 1):
        blocks.append(f"{i}\n{format_srt_timestamp(start)} --> {format_srt_timestamp(end)}\n{text}\n")
    return "\n".join(blocks)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-size", required=True, choices=["medium", "large-v3"])
    args = parser.parse_args()

    if not VOCALS.exists():
        print(f"FAIL - vocal stem not found: {VOCALS}")
        print("Run the Phase 1.1 Demucs separation first (see CLAUDE.md).")
        sys.exit(1)

    print(f"Transcribing {VOCALS.name} with {args.model_size} (word_timestamps=True) ...")
    started = time.monotonic()
    result = transcribe(str(VOCALS), model_size=args.model_size)
    elapsed = time.monotonic() - started

    lines = to_lines(result)
    word_count = sum(len(line["words"]) for line in lines)

    out_json = REPO_ROOT / "output" / f"transcript_{args.model_size}.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(lines, f, indent=2, ensure_ascii=False)

    line_entries = [(l["startTime"], l["endTime"], l["originalText"]) for l in lines]
    out_lines_srt = REPO_ROOT / "output" / f"transcript_{args.model_size}.lines.srt"
    out_lines_srt.write_text(to_srt(line_entries), encoding="utf-8")

    word_entries = [
        (w["start"], w["end"], w["text"]) for l in lines for w in l["words"]
    ]
    out_words_srt = REPO_ROOT / "output" / f"transcript_{args.model_size}.words.srt"
    out_words_srt.write_text(to_srt(word_entries), encoding="utf-8")

    print(f"Done in {elapsed:.1f}s - {len(lines)} lines, {word_count} words")
    print(f"  {out_json}")
    print(f"  {out_lines_srt}")
    print(f"  {out_words_srt}")


if __name__ == "__main__":
    main()
