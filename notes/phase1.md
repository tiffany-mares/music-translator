# Phase 1 notes

## 1.1 — Demucs separation

**Date:** 2026-07-02
**Test song:** (untitled MP3 — no ID3 tags; Romanian test song) (`test_data/input_song.mp3`, 3:35 / 215.4s)
**GPU used:** CPU only (CUDA available: False)

**vocals.wav:**
- Start: Clear and complete.
- Middle: Clear and complete.
- End: Clear and complete.
- Bleed level: None.
- Artifacts: None.

**no_vocals.wav:**
- Any audible leaked vocals? No.

**htdemucs_ft comparison run:** Not needed — quality was good on the default htdemucs run.

**Verdict:** Clean enough to proceed to Phase 1.2.

---

Supporting data from validation:
- Demucs separation validation: PASS — all durations 215.40s
- vocals.wav RMS: 0.11470
- no_vocals.wav RMS: 0.16650
