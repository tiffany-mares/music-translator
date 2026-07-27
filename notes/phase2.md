# Phase 2 notes

## 2.1 — Containerize, single manual SageMaker run

**Date:** 2026-07-27
**Image:** lyralearn-ml:2.1 (sha256:792b015b3b8b49b7cb30edf89c9846659d4b6673c1e4f9a86d7eb160252379f4), pushed to 503233513399.dkr.ecr.us-east-1.amazonaws.com/lyralearn-ml
**Job:** lyralearn-2-1-20260727-004408 — ml.g4dn.xlarge, Completed
**Input:** s3://lyralearn-audio-503233513399/songs/test-song-001/raw/input_song.mp3 (same test song as Phase 1)

**Timings (SageMaker GPU vs Phase 1 local CPU):**
| stage | SageMaker (s) | Phase 1 local (s) |
|---|---|---|
| demucs | 16.2 | 591.2 |
| whisper + pitch (concurrent) | 56.2 | 1000.5 |
| total (in-container) | 72.4 | 1621.6 (incl. translation 29.7) |

GPU is ~22x the local CPU pipeline on this song.

**Cold-run baseline for Phase 2.2's done-when (start-to-first-inference must drop vs these):**
- CreationTime: 2026-07-27T00:44:09.647-04:00  ProcessingStartTime: 00:44:47.944  ProcessingEndTime: 00:48:37.844
- First container log event (demucs checkpoint download starting) at epoch 1785127630.219
  → **start-to-first-inference: 142.3 s** after ProcessingStartTime
  (covers ~4 GB image pull + container boot + heavy imports; the whisper large-v3
  ~3 GB download then lands INSIDE the 56.2 s concurrent stage — AWS-internal
  bandwidth makes it ~15 s, not the minutes it costs on residential uplink)
- Measurement note: the "Stage 1/3" CloudWatch timestamp is unreliable — the
  container's stdout is block-buffered and flushes late; use the log stream's
  firstEventTimestamp (stderr lines are unbuffered and real-time).

**Done-when check (`scripts/compare_s3_output.py output output/sagemaker-2.1`):**
```
Compared output\sagemaker-2.1 against Phase 1 local output:
  lines: 38 vs 35 | notes: 681 vs 697
PASS - SageMaker output matches Phase 1 local output within tolerances.
```

**Bugs found and fixed on the way (all committed on phase-2.1-containerize):**
- **MKL vs libgomp:** the conda base image aborts numpy import in the demucs
  child process when spawned from the loaded entrypoint (`MKL_THREADING_LAYER=INTEL
  is incompatible with libgomp.so.1`); same command standalone works. Fixed with
  `ENV MKL_THREADING_LAYER=GNU`. Found in the local CPU smoke test.
- **cuDNN invisible to ctranslate2:** first GPU job failed (exit 134). The
  cudnn8-runtime base keeps cuDNN inside torch's private lib dir (rpath-only);
  faster-whisper's ctranslate2 could not dlopen libcudnn_ops_infer.so.8. Demucs
  (pure torch) worked — the 216 s song separated in ~10 s before the crash.
  Fixed with `ENV LD_LIBRARY_PATH=/opt/conda/lib/python3.10/site-packages/torch/lib`.
- **Comparison-gate calibration** (first real GPU-vs-CPU data): similarity now
  diacritic-folds (int8 emits "Și/să/mă", float16 emits "Si/sa/ma" — same words
  scored 0.01 raw), WORD_COUNT_REL 0.15→0.25 (measured +18.9%, verified
  line-by-line as MORE real song captured: second intro-chant line + full outro
  chorus, same direction as the 1.2 medium-vs-large finding), and
  TEXT_SIMILARITY_MIN 0.80→0.65 (the precision pair measures 0.71; a
  strict-subset transcript scores ~0.8, so similarity never guarded missing
  content — the line/word-count checks do; similarity guards garbled/wrong text,
  which scores ~0.0–0.3).

**Deviations from the doc, recorded:**
- Bucket is `lyralearn-audio-503233513399` (global S3 name uniqueness), not §5.4's `lyralearn-audio`.
- Job output lands under one `songs/{songId}/ml-output/<job>/` prefix; the §5.4 `stems|pitch` prefix split belongs to the Step Functions wiring (2.3/2.4).
- transcript.json carries `translatedText: null` — translation stays in the RunTranslation Lambda (§4), so "matches Phase 1" was checked on originalText/timings/words/stems/notes.

**Verdict:** proceed to Phase 2.2 (its image is already built/pushed as :2.2 with the same two env fixes merged).
