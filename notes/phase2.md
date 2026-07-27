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

## 2.2 — Bake model weights into the image

**Date:** 2026-07-27
**Image:** lyralearn-ml:2.2 (6.71 GB compressed vs 2.1's 3.99 GB), Demucs htdemucs + Whisper large-v3 baked; Basic Pitch ships inside its wheel (confirmed — no baking needed, answering §5.3's open question)
**Job:** lyralearn-2-2-20260727-010436 — ml.g4dn.xlarge, Completed; zero "Downloading" lines in the logs (baking verified)

**Measurements vs the 2.1 cold baseline:**
| metric | 2.1 (cold) | 2.2 (baked) | delta |
|---|---|---|---|
| start-to-first-inference | 142.3 s | 156.4 s | **+14.1 s (worse)** |
| demucs | 16.2 s | 15.0 s | −1.2 s |
| whisper + pitch (concurrent) | 56.2 s | 45.3 s | −10.9 s (the in-stage download, gone) |
| in-container total | 72.4 s | 60.3 s | −12.1 s |
| job wall clock (Created→Ended) | 268.1 s | 274.2 s | +6.1 s (wash) |

**Done-when verdict: NOT met as written** ("start-to-first-inference visibly
drops") — and the measurement explains why the premise was wrong, which is the
more valuable result. §5.3 assumed model downloads dominate job start; on AWS-
internal bandwidth the whisper large-v3 download ran at ~260 MB/s (~11 s inside
stage 2), while baking moved those same bytes into a +2.7 GB compressed image
pull that costs slightly MORE before first inference. Net wall clock is a wash.

**Decision — keeping the baked :2.2 image anyway**, because its real value is
dependency isolation, not latency: an unbaked job start depends on the HF Hub
being up and un-throttled at every job (the 2.1 logs even warned about
unauthenticated rate limits); the baked image pulls only from ECR. Update
§5.3's rationale when the architecture doc is next revised.

**Sanity gate:** `compare_s3_output.py output output/sagemaker-2.2` → PASS
(30 vs 35 lines, 684 vs 697 notes; Whisper segmentation varies run-to-run —
38 lines in the 2.1 run, 30 here, same model/precision).

**Verdict:** proceed to Phase 2.3 (already built in parallel — see §2.3).

## 2.3 — Linear Step Functions pipeline

**Date:** 2026-07-27
**State machine:** arn:aws:states:us-east-1:503233513399:stateMachine:lyralearn-pipeline (STANDARD)
`MarkProcessing → RunMLPipeline (createProcessingJob.sync, lyralearn-ml:2.2) → RunTranslation (Lambda) → MarkComplete / MarkFailed` — the §4 sketch reduced to its pre-chunking linear form. Mark* states are direct DynamoDB integrations (no Lambda). Deploy: `scripts/aws/deploy_state_machine.sh`; trigger: `scripts/aws/start_pipeline_execution.sh <songId> <jobId>`.

**RunTranslation Lambda** (`lyralearn-translate`, container image, 4096 MB / 300 s): reuses `stages/translate.py`, MarianMT ROMANCE-en baked at `/opt/model`, writes the §6.2 doc to `songs/{songId}/lyrics/song_lyrics.json` (S3 only — MongoDB write is Phase 3's, user decision 2026-07-27). Cold start ≈ 60 s invoke wall (model load); warm invokes seconds. Three Lambda-specific deploy findings: numpy must be pinned 1.26.4 (transformers' loose bound pulls a 2.x sdist the base image can't build), the model must be saved as .bin (safetensors mmap hits a spurious FileNotFoundError on Lambda's lazily-loaded image filesystem), and the image must be pushed as a single v2 manifest (`buildx --provenance=false`) — Lambda rejects OCI attestation indexes.

**The three executions (all in console history):**
| execution | result | job item |
|---|---|---|
| job-quota-probe (pre-approval) | SUCCEEDED via MarkFailed | FAILED, errorInfo=ResourceLimitExceeded — proved the catch wiring before quota existed |
| job-2-3-green | SUCCEEDED, all four states green | COMPLETE, stageOutputs.{mlOutputPrefix, lyricsKey}; lyrics doc has 38 translated lines |
| job-2-3-badaudio2 | SUCCEEDED via MarkFailed | FAILED, errorInfo contains SageMaker FailureReason "AlgorithmError: exit code 1" (Demucs cannot decode the garbage file) |

**Done-when met:** green full execution + deliberately-forced bad-audio failure hitting MarkFailed correctly.

**Design finding — §4's Retry on the SageMaker task is unusable as sketched:** the processing-job name derives from `$$.Execution.Name`, which is constant across retry attempts, so every retry collides with the first attempt's job (`ResourceInUseException`, observed live on the first bad-audio run). Removed the Retry (a deterministic input failure shouldn't be retried at GPU prices anyway); revisit if per-attempt-unique naming is ever needed. §4's chunked sketch has the same flaw (name from chunkId) — fix it when building 2.4.

**Semantics note:** a failure-path execution shows green (SUCCEEDED) in the console — MarkFailed is a normal End state; "failed" lives in the job item's `status`, which is what the Phase 6 DynamoDB-Streams push reads. `errorInfo` currently stores the whole DescribeProcessingJob JSON on task failure — verbose; trim to FailureReason in a later phase if it bothers anyone.

**Decisions recorded:** lyrics to S3 only (Phase 3 adds MongoDB); no GSIs on LyraLearnTable yet (API-layer concern); infra stays CLI + JSON templates for Phase 2.

**Terraform commitment (user decision, 2026-07-27):** Phase 3 MUST begin with adopting §7's Terraform layout (orchestration/storage/ml-processing modules), importing the ~14 resources created by CLI in Phases 2.1–2.3 (S3 bucket, ECR repos lyralearn-ml + lyralearn-translate, IAM roles lyralearn-sagemaker-processing + lyralearn-lambda-translate + lyralearn-sfn-pipeline, LyraLearnTable, the translate Lambda, the state machine), and choosing a state backend — do not start Phase 3 API work before this.

**Verdict:** Phase 2.3 done. Next: 2.4 (chunking) — carry the §4 Retry naming fix into the Map-state design.

## 2.4 — Chunked pipeline (ChunkAudio + Map fan-out)

**Date:** 2026-07-27
**State machine:** arn:aws:states:us-east-1:503233513399:stateMachine:lyralearn-pipeline-chunked
`MarkProcessing → ChunkAudio (Lambda) → Map[per-chunk createProcessingJob.sync, lyralearn-ml:2.4] → MarkComplete/Failed` — §4's fan-out without StitchResults/RunTranslation (those are 2.5); the linear `lyralearn-pipeline` stays the end-to-end path meanwhile. Deploy: `scripts/aws/deploy_chunked_state_machine.sh` (knobs: `IMAGE_TAG=2.4`, `MAX_CONCURRENCY=1`); trigger: `SM_NAME=lyralearn-pipeline-chunked scripts/aws/start_pipeline_execution.sh <songId> <jobId>`.

**ChunkAudio Lambda** (`lyralearn-chunk-audio`, container image, 2048 MB / 300 s): soundfile decodes the mp3 (bundled libsndfile ≥ 1.1 — no ffmpeg) and slices sample-accurately; 40 s chunks, 2.5 s overlap (§11's open knob), stride 37.5 s — the math guarantees the tail chunk always exceeds the overlap. Writes WAV chunks + `manifest.json` (job names, prefixes, offsets — 2.5's stitcher reads this) and precomputes per-chunk job names `lyralearn-sfn-{exec}-{chunkId}` to fit the IAM prefix. Direct-invoke verified before wiring: 6 chunks, 215.4 s, offsets `[0, 37.5, 75, 112.5, 150, 187.5]`.

**Done-when execution:** `job-2-4-20260727-023532` — SUCCEEDED (~32 min wall, MaxConcurrency 1 ⇒ 6 sequential jobs); job item `status=COMPLETE`, `chunkCount=6` (§6.1's attribute), `stageOutputs.{chunksPrefix, mlOutputPrefix}`.

**Gate (`python scripts/verify_chunk_outputs.py lyralearn-audio-503233513399 test-song-001 job-2-4-20260727-023532`):**
```
  chunk-000: offset    0.0s, 2 lines, 94 notes
  chunk-001: offset   37.5s, 14 lines, 118 notes
  chunk-002: offset   75.0s, 9 lines, 112 notes
  chunk-003: offset  112.5s, 5 lines, 153 notes
  chunk-004: offset  150.0s, 5 lines, 139 notes
  chunk-005: offset  187.5s, 7 lines, 104 notes
PASS - all 6 chunks complete with correct chunk_start_offset metadata.
```
(42 chunk-lines / 720 chunk-notes vs ~35 lines / ~690 notes whole-song — the surplus is the 2.5 s overlap duplication the 2.5 stitcher dedupes.)

**Timing observation:** ~32 min / 6 jobs ≈ 5.3 min wall per chunk job for only ~10–60 s of actual ML each — instance boot + image pull dominates per-chunk cost, exactly §4's stated tradeoff: chunking only buys wall-clock time once the Map actually runs concurrently. Sequential chunked (32 min) is far WORSE than the whole-song job (4.5 min); `MaxConcurrency=6` is the entire point (2.6 validates the ~70–110 s target).

**Quota:** the increase to 6 (§4's MaxConcurrency) could not be filed — AWS allows one open request per quota and the original 0→1 case (`341e4965`) is still formally open despite the quota being granted. File `desired-value 6` for `L-2F1EB012` as soon as it closes; until then the chunked machine deploys with `MAX_CONCURRENCY=1`.

**Ops note:** the venv's pinned boto3 (1.34.131) cannot resolve the root `aws login` session credentials (provider is newer than the pin) — run boto3 scripts with `eval "$(aws configure export-credentials --profile new-profile-name --format env)"`.

**Verdict:** Phase 2.4 done. Next: 2.5 (StitchResults — crossfade stems at overlaps, offset+merge/dedupe transcript lines and pitch notes by chunkStartOffset, then hook RunTranslation + the §5.4 per-artifact prefixes into the chunked machine).

## 2.5 — StitchResults

**Date:** 2026-07-27
**Lambda:** `lyralearn-stitch-results` (container image `lyralearn-stitch-results:2.5`, 4096 MB / 300 s): normalized linear overlap-add for stems; midpoint-window dedupe for lines/notes (§5.3a's "simple de-duplication pass" — chunk *i* owns `[offset_i + 1.25, offset_{i+1} + 1.25)`, items survive iff their midpoint is inside). Writes gate-compatible whole-song artifacts to `songs/{songId}/stitched/{execName}/`. Deploy: `scripts/aws/deploy_stitch_lambda.sh`.
**Pipeline:** `lyralearn-pipeline-chunked` is now the full §4 shape minus fingerprint short-circuit: `MarkProcessing → ChunkAudio → Map → StitchResults → RunTranslation → MarkComplete/Failed` (ASL renamed to `infra/aws/pipeline-chunked.asl.json`). End-to-end run `job-2-5-20260727-034341` SUCCEEDED: job item COMPLETE, chunkCount 6, stageOutputs `{chunksPrefix, mlOutputPrefix, stitchedPrefix, lyricsKey}`; translated lyrics (33 lines, en) produced from the STITCHED transcript.

**Done-when, honestly:**
- *Clean-boundary condition* — covered by exact-pass-through unit tests on synthetic chunks (user decision 2026-07-27), because measured reality made the spec's easy case impossible: ALL five cut points (38.75/76.25/113.75/151.25/188.75 s) land mid-word (`Și`, `Vrei`, `dat`, `-intresc` ×2).
- *"Indistinguishable" gate* (`compare_s3_output.py output output/stitched-2.5`): **FAIL — and the failure IS the finding.** Two checks out of tolerance, both traced to chunking quality, not stitch bugs:
  1. **vocals RMS 0.14196 vs local 0.11295 (+25.7%)** — the stitched RMS exactly equals the average of the raw per-chunk stems (0.129–0.160), and the elevation is uniform across interior regions, not seam-localized. Demucs separates 40 s windows measurably worse than the whole song (more instrumental bleed into vocals). The crossfade is faithful; the cost is upstream.
  2. **text similarity 0.56** (whole-song GPU run scored 0.71) — chunked Whisper both drifts (less context per 40 s window) and produces seam artifacts. Passing checks: duration (exact), line count 40 vs 35, word count, note count 690 vs 697, median pitch.
- *Mid-word documentation* (boundary report, all five cuts):
  - **38.75 s:** real damage — chunk 0 garbled the truncated line ("M-a iachat, m-a iachata" for "Alo, salut, sunt eu un haiduc"'s tail), chunk 1 lost "primește fericirea".
  - **76.25 s:** clean handoff — both lines intact.
  - **113.75 s:** duplication — "Picasso, ți-am dat vin" (garbled tail) AND "Toți am dat bip și sunt voinic..." both kept: differently-segmented long lines straddling the cut defeat the midpoint rule (the predicted long-line seam weakness, observed live).
  - **151.25 s:** chunked is BETTER here — the whole-song run had a degenerate 30 s "line"; chunks produced real chorus segmentation.
  - **188.75 s:** duplication again ("Chipul tău și dragostea din..." ×2, one truncated).

**Conclusion — §5.3's tradeoff verified, not assumed:** on a song with continuous vocals, chunked+stitched output is measurably distinguishable from whole-song output: ~+25% vocal-stem bleed (uniform demucs cost), transcription similarity 0.71→0.56, seam duplicates at 2 of 5 boundaries, 1 boundary improved. The stitcher itself is correct (unit-exact on clean seams, faithful on real data). These numbers feed §11's open overlap-duration knob and 2.6's judgment on whether the wall-clock win justifies the quality cost; options if quality must improve: longer overlap, seam-aware text merging (align words in the overlap rather than midpoint ownership), or chunking only demucs and running whisper on the stitched vocals.

**Verdict:** Phase 2.5 done (engineering verified; quality tradeoff quantified and documented). Next: 2.6 (end-to-end timing validation — needs the quota-6 request, still blocked behind the open 0→1 case).
