# Phase 1 notes

## 1.1 — Demucs separation

**Date:** 2026-07-02
**Test song:** (untitled MP3 — no ID3 tags) (`test_data/input_song.mp3`, 215.4s / 3:35)
**Song language:** Romanian (confirmed by uploader)
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

## 1.2 — Transcription (faster-whisper)

**Date:** 2026-07-02
**Input:** `output/stems/htdemucs/input_song/vocals.wav` (Phase 1.1 stem, 215.4s)
**Runs:** medium (716.0s original / 1317.9s post-fix re-run) and large-v3 (1433.7s), CPU int8, language=ro, word_timestamps=True

**Transcription accuracy vs known lyrics:**
- medium: missed the song's entire opening "Maia-hi" chant — its transcript starts at "Alo? Salut...", skipping the opening lyrics entirely.
- large-v3: caught the opening chant that medium missed.
- Difference that matters: on the re-run, large-v3 produced 36 lines / 269 words vs medium's 25 lines / 252 words on "Dragostea din tei" (Romanian) — the gap is largely the missing opening chant in medium's output.

**Line-level timing:** Validated via a local preview page (`output/timing_preview.html`, untracked) built by the controller in place of the planned VLC/SRT flow (VLC was not installed) — it plays the vocal stem and highlights the active line and word from the transcript timestamps, with a model dropdown to compare medium vs large-v3. No line-level timing issues noted by the listener.

**Word-level timing (done-when check, 3-4+ lines of different character):**
- Checked via the same preview page (currentTime + timestamp highlighting, the same mechanism the future player will use) rather than the planned VLC `.words.srt` swap-in; per-line itemized timing notes were not taken.
- Listener's verbatim verdict: "large-v3 is better, forced alignment is not needed it works well"
- Failure patterns: none noted.

**Decision — model size:** large-v3, because it caught the song's entire opening chant that medium missed entirely, and the listener judged large-v3 better overall on the real song via the preview-page comparison — overturning architecture.md's `medium` default.
**Decision — forced alignment:** not needed, because the listener reported word-level timing "works well" via the preview-page check.

**Verdict:** proceed to Phase 1.3.
