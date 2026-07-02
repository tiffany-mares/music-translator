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

**Line-level timing:** Validated via a local preview page (`output/timing_preview.html`, untracked) built by the controller in place of the planned VLC/SRT flow (VLC was not installed) — it plays the vocal stem and highlights the active line and word from the transcript timestamps, with a model dropdown to compare medium vs large-v3. Covered by the same overall verdict via the preview page; no line-specific issue was separately reported.

**Word-level timing (done-when check, 3-4+ lines of different character):**
- Checked via the same preview page (currentTime + timestamp highlighting, the same mechanism the future player will use) rather than the planned VLC `.words.srt` swap-in; per-line itemized timing notes were not taken.
- Listener's verbatim verdict: "large-v3 is better, forced alignment is not needed it works well"
- Failure patterns: none noted.

**Decision — model size:** large-v3, because it caught the song's entire opening chant that medium missed entirely, and the listener judged large-v3 better overall on the real song via the preview-page comparison — overturning architecture.md's `medium` default.
**Decision — forced alignment:** not needed, because the listener reported word-level timing "works well" via the preview-page check.

**Verdict:** proceed to Phase 1.3.

## 1.3 — Translation (Helsinki-NLP/MarianMT)

**Date:** 2026-07-02
**Input:** `output/transcript_large-v3.json` (36 lines) → `output/translation_check.json`
**Model:** Helsinki-NLP/opus-mt-ROMANCE-en — the planned `opus-mt-ro-en` does not exist on the Hub (404; anonymous requests to a nonexistent repo return 401, which initially looked like an auth failure). The Romance-group source-multilingual model covers Romanian with no input prefix needed. One batched `generate()` call, CPU (model load 37.0s including ~300 MB download, translate 5.4s for 36 lines).

**Line-by-line review (every line read against the original by the uploader, via uploader-supplied complete reference translations for all 36 lines diffed against the model output line by line):**
- Basic correctness: lines 8/12/30/34 dropped the verb "take" (elliptical repetition came out as "No, you don't..."); lines 9/13/22/26/31/35 dropped "din tei" ("under the linden tree" — the song's title phrase) entirely; lines 10/14 have a pronoun flip ("your" → "her"); line 23 opens with "We" and renders the pronoun as "her" (both wrong); line 3 has a subtle mood shift (an imperative read as indicative).
- Idioms translated literally: line 2 "haiduc" left untranslated (should be "outlaw"); the recurring "din tei" drop (lines 9/13/22/26/31/35, also counted above) is a cultural-phrase loss, not a literal-but-lost-meaning idiom.
- Cross-line context loss (pronouns/continuations): none identified — every genuine error is a single-line weakness; a sliding context window would not have fixed the dropped title phrase or the pronoun flips.
- Transcription-error propagation (largest error source by line count; an upstream Phase 1.2 issue, not a translation defect): lines 5, 18, 20, 21, 24, 25, 27, 28, 32, 36 — the translator faithfully translated already-garbled input (e.g. a misheard phrase came out "only them").
- Repeated-line consistency (machine-checked): CONSISTENT for all 8 repeated groups.

**Decision — translation granularity (uploader-confirmed):** line-by-line stands, because the genuine errors (lines 2/3/8/9/10/12/13/14/22/23/26/30/31/34/35) are single-line model weaknesses a sliding window wouldn't fix, and the largest error source by line count (lines 5/18/20/21/24/25/27/28/32/36) is upstream transcription noise from Phase 1.2 — a transcription-quality concern, not a granularity one.

**Verdict:** coherent and faithful enough — proceed to Phase 1.4. Translation-quality improvement (a stronger model or post-editing) and transcription-noise reduction are noted as potential future quality work, distinct from granularity.

## 1.4 — Pitch extraction (Basic Pitch)

**Date:** 2026-07-02
**Input:** `output/stems/htdemucs/input_song/vocals.wav` (Phase 1.1 stem, 215.4s) — the stem, not the full mix
**Model:** Basic Pitch ICASSP 2022 (bundled weights, TensorFlow backend, CPU, 25.4s) → 691 note events, pitch range MIDI 29-97
**Validation method:** `output/pitch_preview.html` — WebAudio synth doubling the extracted notes over the real vocal, with scrolling piano-roll (no DAW on this machine). The roll clips displayed pitches to 40-90, so the extraction's extremes (29-97) were audible but not visible on the roll.

**Contour check (listened alongside the vocal, not in isolation):**
- Octave errors: none noted — the listener gave a single overall verdict ("it sounds right"), not a per-category breakdown.
- Missed notes: none noted — same single overall verdict; no chant/melisma-specific issue was separately reported.
- Spurious notes: none noted — same single overall verdict. (The extraction's pitch extremes, MIDI 29 and 97, fall outside a typical vocal range; the listener raised no concern about them.)
- Note-boundary drift: none noted — same single overall verdict.

**Beat/tempo observation (evidence for the Phase 6.5 C++ DSP core decision — decision stays open):** informal — no timing looseness was noted in the listener's overall verdict; no dedicated rhythm comparison was performed.

**Cross-reference vs earlier phases:** no weak passages were reported by the listener, so there is no overlap to assess against Phase 1.2/1.3's hard passages (chant lines 1/28, garbled lines 5/18/20/21/24/25/27/32/36).

**Environment note:** TensorFlow's oneDNN kernels hard-crashed silently on full-length audio until disabled in the stage (`TF_ENABLE_ONEDNN_OPTS=0` via `setdefault`, the same baked-in-workaround pattern used in Phase 1.2).

**Verdict:** contour tracks the sung melody — proceed to Phase 1.5.
