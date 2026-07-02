# Phase 1 notes

## 1.1 — Demucs separation

**Date:** 2026-07-02
**Test song:** (untitled MP3 — no ID3 tags) (`test_data/input_song.mp3`, 215.4s / 3:35)
**Song language:** not yet confirmed (plan criteria requested a Romanian track; verify during Phase 1.2 transcription)
**GPU used:** CPU only (CUDA available: False)
**Listener's verbatim report:** "both the vocals and the no vocals came through clear"

**vocals.wav:**
- Start: Clear.
- Middle: Clear.
- End: Clear.
- Bleed level: None noted.
- Artifacts: None noted.

**no_vocals.wav:**
- Any audible leaked vocals? No — listener reported the stem came through clear.

**htdemucs_ft comparison run:** Not needed — quality was good on the default htdemucs run.

**Verdict:** Clean enough to proceed to Phase 1.2.

---

Supporting data from validation:
- Demucs separation validation: PASS — all durations 215.40s
- vocals.wav RMS: 0.11470
- no_vocals.wav RMS: 0.16650
