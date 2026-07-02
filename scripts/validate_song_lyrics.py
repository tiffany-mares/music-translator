"""Field-by-field validation of song_lyrics.json against architecture.md
section 6.2 - the check that distinguishes "the pipeline ran" from "the
output is a direct MongoDB insert for Phase 4, no reshaping needed."

Usage: python scripts/validate_song_lyrics.py [path-to-song_lyrics.json]
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

LINE_KEYS = {"lineNumber", "originalText", "translatedText", "startTime", "endTime", "words"}
WORD_KEYS = {"text", "start", "end"}


def validate(doc: dict) -> list[str]:
    problems = []
    for field in ("songId", "sourceLanguage", "targetLanguage"):
        if not isinstance(doc.get(field), str) or not doc.get(field):
            problems.append(f"top-level field {field!r} missing or not a non-empty string")
    if not isinstance(doc.get("lines"), list):
        problems.append("top-level field 'lines' missing or not a list")
        return problems
    for line in doc["lines"]:
        n = line.get("lineNumber", "?")
        missing = LINE_KEYS - line.keys()
        if missing:
            problems.append(f"line {n}: missing keys {sorted(missing)}")
        if "translatedText" in line and not isinstance(line["translatedText"], str):
            problems.append(f"line {n}: translatedText is not a string (still null?)")
        for word in line.get("words", []):
            w_missing = WORD_KEYS - word.keys()
            if w_missing:
                problems.append(f"line {n}: word {word.get('text', '?')!r} missing keys {sorted(w_missing)}")
    return problems


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "output" / "song_lyrics.json"
    if not path.exists():
        print(f"FAIL - not found: {path}")
        sys.exit(1)
    doc = json.loads(path.read_text(encoding="utf-8"))
    problems = validate(doc)
    if problems:
        print(f"FAIL - {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    words = sum(len(l["words"]) for l in doc["lines"])
    print(f"PASS - {doc['songId']}: {len(doc['lines'])} lines, {words} words, "
          f"{doc['sourceLanguage']}->{doc['targetLanguage']} - section 6.2 shape confirmed")


if __name__ == "__main__":
    main()
