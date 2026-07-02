"""Translate the Phase 1.2 transcript and dump review artifacts.

Writes:
  output/translation_check.json   - section 6.2 lines with translatedText filled
  output/translation_review.txt   - numbered RO -> EN pairs for the line-by-line
                                    human review, plus a repeated-line consistency
                                    report (validation step 4 of the phase outline)

The review file is the artifact the human reads - every line, in order,
against the original - to produce the translation-granularity decision.
"""
import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from stages.translate import load_translator, translate_lines  # noqa: E402

DEFAULT_INPUT = REPO_ROOT / "output" / "transcript_large-v3.json"


def format_review(lines: list) -> str:
    out = []
    for line in lines:
        out.append(f"{line['lineNumber']:>3}  RO: {line['originalText']}")
        out.append(f"     EN: {line['translatedText']}")
        out.append("")
    out.append("== Repeated-line consistency ==")
    by_text = {}
    for line in lines:
        by_text.setdefault(line["originalText"], []).append(line)
    repeats = {t: g for t, g in by_text.items() if len(g) > 1}
    if not repeats:
        out.append("(no repeated lines in this song)")
    for text, group in repeats.items():
        translations = sorted({g["translatedText"] for g in group})
        status = "CONSISTENT" if len(translations) == 1 else "INCONSISTENT"
        nums = ", ".join(str(g["lineNumber"]) for g in group)
        out.append(f"{status}: lines {nums}: {text!r} -> {translations!r}")
    out.append("")
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help="transcript JSON to translate (default: the large-v3 artifact)")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"FAIL - transcript not found: {args.input}")
        print("Run the Phase 1.2 transcription first (see CLAUDE.md).")
        sys.exit(1)

    lines = json.loads(args.input.read_text(encoding="utf-8"))
    print("Loading Helsinki-NLP/opus-mt-ROMANCE-en ...")  # model name matches load_translator()'s defaults
    started = time.monotonic()
    tokenizer, model = load_translator()
    load_elapsed = time.monotonic() - started

    print(f"Translating {len(lines)} lines (one batched generate call) ...")
    started = time.monotonic()
    lines = translate_lines(lines, tokenizer, model)
    translate_elapsed = time.monotonic() - started

    out_json = REPO_ROOT / "output" / "translation_check.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(lines, f, indent=2, ensure_ascii=False)

    out_review = REPO_ROOT / "output" / "translation_review.txt"
    out_review.write_text(format_review(lines), encoding="utf-8")

    print(f"Done - model load {load_elapsed:.1f}s, translation {translate_elapsed:.1f}s")
    print(f"  {out_json}")
    print(f"  {out_review}")


if __name__ == "__main__":
    main()
