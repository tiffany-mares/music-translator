# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LyraLearn (repo: music-translator) is in Phase 1 of the build plan (see `architecture.md` section 10). Phases 1.1 (local Demucs separation), 1.2 (faster-whisper transcription), and 1.3 (MarianMT translation) are done — see `notes/phase1.md` for the recorded quality baselines and decisions (model size, forced alignment, translation granularity). Setup: `py -3.11 -m venv lyralearn-env && source lyralearn-env/Scripts/activate && pip install -r requirements.txt` (PowerShell: `lyralearn-env\Scripts\Activate.ps1`). Separation: `python scripts/check_gpu.py` then `python -m demucs.separate -n htdemucs --two-stems vocals -o output/stems test_data/input_song.mp3`, validated by `python scripts/validate_stems.py`. Transcription: `python scripts/run_transcription.py --model-size large-v3` (dumps JSON + line/word SRT to `output/`). Translation: `python scripts/run_translation.py` (fills translatedText, dumps JSON + RO/EN review file to `output/`). Tests: `python -m pytest tests/ -v`. Remaining phases are not implemented yet; add their commands here as they land.

## What this is

A music-based language learning platform: upload a song, split it into stems, transcribe and translate the lyrics, extract melody/pitch data, and play it back in a word-synced interactive player with spaced-repetition vocab review.

## Architecture (v4 — fully serverless, chunked pipeline)

Everything runs on Lambda + API Gateway + DynamoDB + MongoDB Atlas. There is no EKS, RDS, VPC, or NAT Gateway in this design — that's a deliberate cost/simplicity choice (see `architecture.md` section 8), not an oversight. Don't reintroduce them without updating the architecture doc first.

### Pipeline (the core async flow)

```
Browser (React+TS) --upload--> S3 (pre-signed PUT)
  --> POST /songs/{id}/process --> Rust Lambda (validation + audio fingerprint)
        --> fingerprint matches an existing song? --> link songId directly, no pipeline run (near-instant)
        --> new song? --> Step Functions (STANDARD):
              ChunkAudio (Lambda) --> Map state, ~40s overlapping chunks in parallel:
                SageMaker Processing Jobs (GPU, ml.g4dn.xlarge), per chunk:
                  Demucs (two-stems) -> faster-whisper (large-v3) -> Basic Pitch [+ C++ DSP core via pybind11]
              --> StitchResults (Lambda): crossfade audio at overlaps, offset+merge/dedupe transcript & pitch data
              --> RunTranslation (Lambda) --> MarkComplete
  --> audio playback starts immediately once upload validation passes (doesn't wait on the pipeline)
  --> lyrics/translation/pitch data hydrate into the player progressively as they arrive
  --> job status pushed via API Gateway WebSocket API + Go Lambda ($connect/$disconnect/push,
      triggered by DynamoDB Streams) or polled via GET /jobs/{id} (React Query, backoff 2s->15s cap)
  --> playback events POST to Java Lambda learning service (SM-2 scheduling, writes to DynamoDB)
```

Latency: a fingerprint cache-hit is a DynamoDB lookup — near-instant, no pipeline run. A genuinely new song's full pipeline (transcription/translation/pitch, not playback which starts immediately) now runs in **~70-110s**, down from an original 8-13 min worst case, via chunked parallel SageMaker jobs. Chunking doesn't reduce billed compute (SageMaker bills per instance-second regardless) — it only collapses wall-clock time by running chunks concurrently. See `architecture.md` sections 2 and 4 for the full reasoning, and section 5.3's stated tradeoff: chunk boundaries falling mid-word/mid-note can degrade quality slightly versus a single unchunked job — validate this in Phase 2 rather than assuming the crossfade/offset logic fully hides it.

Everything sits behind API Gateway directly (HTTP API for REST routes, WebSocket API for `/ws`) — no ALB, no VPC Link, no ingress path to maintain.

### Services and their responsibilities

- **Python Lambda** — `/songs`, `/jobs/{id}`, `/songs/{id}/lyrics`, `/songs/{id}/audio-urls` — thin read/proxy layer over DynamoDB, MongoDB, and S3 pre-signing.
- **Rust Lambda** — upload validation *and* audio fingerprinting (chromaprint-based, not a raw file hash — catches re-encoded duplicates), added to the same hot-path Lambda rather than a separate function. On a fingerprint match it links the new `songId` to the existing song's data and returns without ever invoking Step Functions.
- **Step Functions (ASL)** — only runs for genuinely new songs (post-dedup). `ChunkAudio` fans the song into overlapping ~40s chunks via a `Map` state (`MaxConcurrency: 6`), each chunk processed as its own SageMaker job; `StitchResults` crossfades audio at the overlaps and offsets/merges/dedupes each chunk's transcript lines and pitch notes by `chunk_start_offset` before translation and completion.
- **Go Lambda functions** — three small functions (`$connect`, `$disconnect`, DynamoDB Streams-triggered push handler) backing the WebSocket API. Connection identity lives in the `WebSocketConnections` DynamoDB table, not in memory — Lambda is stateless/short-lived, so there's no persistent hub process. Deliberate tradeoff: Go's concurrency strengths aren't really in play here anymore.
- **Java Lambda** — learning service, implements SM-2 spaced repetition (same algorithm as Anki) in `SpacedRepetitionService.schedule()`. Persists via `DynamoDbClient.updateItem` on `USER#{userId}/VOCAB#{vocabItemId}` items; `GET /vocab/due` queries `GSI2` (`userId` + `nextReviewAt`). Plain Java Lambda, not Spring Boot — leaner cold start at this traffic volume.
- **C++ DSP core** — beat/tempo detection, exposed to the Basic Pitch Python container via pybind11 (`dsp_core` module). Only build this if Basic Pitch's stock output proves insufficient (Phase 6.5) — not speculative.
- **React/TS frontend** — progressive hydration player: playback starts as soon as the pre-signed audio URL exists, independent of pipeline completion; lyrics/translation/pitch UI elements activate individually as their data lands (via WebSocket push or polling), with a "lyrics loading..." placeholder in the interim. Web Audio API `AudioContext.currentTime` sampled on `requestAnimationFrame`, binary-searched against sorted word-timing data. TensorFlow.js CREPE model is lazy-loaded only when sing-along mode opens (not on initial load), cached in IndexedDB, and runs in a Web Worker against mic input so it doesn't block the main thread.

### Data layer — which store owns what

- **DynamoDB** (`LyraLearnTable`, on-demand) — job state, song metadata (including `audioFingerprint`), and vocab/spaced-repetition state. Single-item `Get/UpdateItem` by `PK`/`SK`. `GSI1(PK=userId, SK=createdAt)` — "my songs, newest first". `GSI2(PK=userId, SK=nextReviewAt)` — "vocab due today". `GSI3(PK=audioFingerprint)` — dedup lookup used by the Rust Lambda before running the pipeline.
- **`WebSocketConnections`** (separate DynamoDB table, on-demand) — `connectionId` as PK, `userId` attribute with a GSI for the reverse lookup used by the push handler.
- **MongoDB Atlas (M0 free tier)** — lyrics/translation/word-timing, one document per song, shape mirrors Whisper's nested output. Unique index on `songId`; add a text index on `lines.words.text` only if "find songs containing word X" is actually needed. Watch storage/connection metrics — M0 → M10 is the one line item that can meaningfully move the monthly bill.
- **S3** — `songs/{songId}/{raw|stems|pitch}/...`, SSE-S3, `raw/` transitions to IA after 30 days (stems/pitch stay Standard, read on every playback). SageMaker's execution role is scoped to `songs/*` only, never bucket-wide.

There is no RDS/PostgreSQL in this design (v3 had it; v4 moved vocab/spaced-repetition state to DynamoDB `GSI2` to drop the VPC/NAT Gateway requirement — see `architecture.md` sections 1 and 8 for the reasoning).

Full schemas (DynamoDB item shapes, MongoDB doc shape) and the complete API endpoint table live in `architecture.md` — read it before touching the data layer or adding an endpoint, since field names and index choices there are deliberate.

## Build phases

`architecture.md` section 10 has the authoritative, granular sub-phase breakdown with explicit "done when" conditions for every step — read it before starting work on any phase rather than relying on the summary below. Don't jump ahead (e.g. don't build chunking (2.4-2.6) before the linear pipeline (2.1-2.3) works; don't build the Go WebSocket stack (Phase 6) before Phase 4's polling ships).

1. **Local pipeline, no AWS** — Demucs (two-stems) → faster-whisper (large-v3) → Helsinki-NLP → Basic Pitch on one local file, producing `song_lyrics.json` in the exact MongoDB doc shape.
2. **ML pipeline in AWS** — containerize, wire the linear Step Functions ASL, *then* add chunking (`ChunkAudio`/`Map`/`StitchResults`), then validate timing against the ~70-110s target on real songs.
3. **API layer, auth, dedup** — Cognito + DynamoDB (GSI1/GSI2/GSI3) + `WebSocketConnections` schema, core Python Lambda routes, Rust Lambda validation, *then* fingerprinting/dedup.
4. **Frontend** — scaffold + auth, upload + job status polling, immediate-playback player shell, lyrics hydration, loading/error states.
5. **Learning service** — DynamoDB + Java Lambda skeleton, SM-2 logic (unit-tested in isolation against known reference outputs before wiring to AWS), endpoints, quiz generation, frontend integration.
6. **Real-time and polish** — WebSocket connect/disconnect lifecycle, push-on-completion, frontend WebSocket integration (polling stays as the tested fallback), TensorFlow.js sing-along mode, C++ DSP core only if benchmarking shows Basic Pitch's stock output is insufficient.

## Open decisions (don't treat these as settled)

- **Resolved (Phase 1.3):** translation granularity — line-by-line stands — the Phase 1.3 line-by-line review found only single-line model weaknesses (dropped words, a title-phrase drop, pronoun flips) plus upstream transcription noise, none of which a sliding context window would have fixed (see `notes/phase1.md`).
- Chunk overlap duration (currently ~2-3s) — a tuning knob between stitch quality and redundant compute at the seams; validate against real songs in Phase 2, don't assume the initial estimate is right.
- How aggressively to dedupe via audio fingerprinting — chromaprint matching can false-positive on similar-but-distinct tracks (e.g. two different live recordings); consider a manual review step before auto-linking early on rather than trusting it blindly.
- MongoDB Atlas vs DocumentDB — Atlas first for speed/free tier; DocumentDB only worth revisiting if this ever moves back inside a VPC for other reasons.
- Build the C++ DSP core only if Basic Pitch's output shows a measurable gap.
- Plain Java Lambda vs Spring Cloud Function for the learning service — plain Lambda is the leaner, cheaper default at this scale.
- **Resolved**: Whisper `large-v3` vs `medium` — settled on `large-v3` (via `faster-whisper`) per the Phase 1.2 benchmark, reversing the earlier `medium` default: `medium` missed the song's entire opening chant that `large-v3` caught, and the listener judged `large-v3` better on the real song (see `notes/phase1.md`).

## Security / IAM conventions to follow

- Cognito User Pool is the single identity source; API Gateway's JWT authorizer handles HTTP routes, and the Go `$connect` handler validates the same JWT at connect time — don't introduce a separate auth mechanism.
- IAM roles are scoped per-Lambda-function (e.g. SageMaker role limited to `songs/*`). No wildcard `s3:*`/`dynamodb:*`, no shared execution role across functions or pipeline stages.
- No VPC is used at the current (Tier A, 30-50 user) scale — every component talks over public AWS/internet endpoints with IAM/JWT-based auth instead of network isolation. This is a deliberate tradeoff, not an oversight; revisit only if scale or compliance requirements change.
- Secrets (MongoDB Atlas connection string) go in AWS Secrets Manager, read directly by Lambda at cold start and cached in the execution environment across warm invocations.
