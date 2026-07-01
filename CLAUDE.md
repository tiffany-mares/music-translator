# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LyraLearn (repo: music-translator) has no implementation yet — only `README.md` and the architecture decisions below. There are no build/lint/test commands because no code exists. The project follows a phased build plan (see "Build phases"); start with Phase 1 and add real commands to this file as each phase's code lands.

## What this is

A music-based language learning platform: upload a song, split it into stems, transcribe and translate the lyrics, extract melody/pitch data, and play it back in a word-synced interactive player with spaced-repetition vocab review.

## Architecture (v4 — fully serverless)

Everything runs on Lambda + API Gateway + DynamoDB + MongoDB Atlas. There is no EKS, RDS, VPC, or NAT Gateway in this design — that's a deliberate cost/simplicity choice (see `architecture.md` section 8), not an oversight. Don't reintroduce them without updating the architecture doc first.

### Pipeline (the core async flow)

```
Browser (React+TS) --upload--> S3 (pre-signed PUT)
  --> POST /songs/{id}/process --> Rust validation Lambda --> Step Functions (STANDARD)
        --> SageMaker Processing Jobs, one container per stage, GPU (ml.g4dn.xlarge):
              Demucs -> Whisper -> Helsinki-NLP (translation) -> Basic Pitch
              (Basic Pitch stage links a C++ DSP core via pybind11 for beat detection)
  --> job status pushed via API Gateway WebSocket API + Go Lambda ($connect/$disconnect/push,
      triggered by DynamoDB Streams) or polled via GET /jobs/{id} (React Query, backoff 2s->15s cap)
  --> on COMPLETE: GET /songs/{id}/lyrics (MongoDB) + /audio-urls (S3 pre-signed GET)
  --> playback events POST to Java Lambda learning service (SM-2 scheduling, writes to DynamoDB)
```

Latency budget: steps through the SageMaker pipeline take 3-6 min (GPU-bound) and are fully async/decoupled; everything else is sub-second. This asymmetry is why job status is push/poll rather than a synchronous response.

Everything sits behind API Gateway directly (HTTP API for REST routes, WebSocket API for `/ws`) — no ALB, no VPC Link, no ingress path to maintain.

### Services and their responsibilities

- **Python Lambda** — `/songs`, `/jobs/{id}`, `/songs/{id}/lyrics`, `/songs/{id}/audio-urls` — thin read/proxy layer over DynamoDB, MongoDB, and S3 pre-signing.
- **Rust Lambda** — upload validation only (format/size/header checks); chosen for low cold-start on the hot upload path.
- **Step Functions (ASL)** — orchestrates the 4 SageMaker stages with per-stage `Retry`/`Catch` → `MarkFailed`. Uses `.sync` SageMaker integration (blocks until job finishes, no manual polling) and STANDARD (not EXPRESS) workflow type for full execution history on a pipeline that fails intermittently (OOM, malformed audio).
- **Go Lambda functions** — three small functions (`$connect`, `$disconnect`, DynamoDB Streams-triggered push handler) backing the WebSocket API. Connection identity lives in the `WebSocketConnections` DynamoDB table, not in memory — Lambda is stateless/short-lived, so there's no persistent hub process. This is a deliberate tradeoff: Go's concurrency strengths aren't really in play here anymore.
- **Java Lambda** — learning service, implements SM-2 spaced repetition (same algorithm as Anki) in `SpacedRepetitionService.schedule()`. Persists via `DynamoDbClient.updateItem` on `USER#{userId}/VOCAB#{vocabItemId}` items; `GET /vocab/due` queries `GSI2` (`userId` + `nextReviewAt`). Plain Java Lambda, not Spring Boot — leaner cold start at this traffic volume (Spring Cloud Function remains an open option if Spring idioms are wanted later).
- **C++ DSP core** — beat/tempo detection, exposed to the Basic Pitch Python container via pybind11 (`dsp_core` module). Only build this if Basic Pitch's stock output proves insufficient — not speculative.
- **React/TS frontend** — Web Audio API `AudioContext.currentTime` sampled on `requestAnimationFrame`, binary-searched against sorted word-timing data (cheaper and more accurate than a `setInterval` re-render loop). TensorFlow.js CREPE model runs in a Web Worker against mic input for pitch matching, so it doesn't block the main thread.

### Data layer — which store owns what

- **DynamoDB** (`LyraLearnTable`, on-demand) — job state, song metadata, and now vocab/spaced-repetition state too (moved off Postgres in v4). Single-item `Get/UpdateItem` by `PK`/`SK`. `GSI1(PK=userId, SK=createdAt)` supports "list a user's songs by upload date"; `GSI2(PK=userId, SK=nextReviewAt)` supports "vocab due today" (replaces the old Postgres index).
- **`WebSocketConnections`** (separate DynamoDB table, on-demand) — `connectionId` as PK, `userId` attribute with a GSI for the reverse lookup used by the push handler.
- **MongoDB Atlas (M0 free tier)** — lyrics/translation/word-timing, one document per song, shape mirrors Whisper's nested output. Unique index on `songId`; add a text index on `lines.words.text` only if "find songs containing word X" is actually needed. Watch storage/connection metrics — M0 → M10 is the one line item that can meaningfully move the monthly bill.
- **S3** — `songs/{songId}/{raw|stems|pitch}/...`, SSE-S3, `raw/` transitions to IA after 30 days (stems/pitch stay Standard, read on every playback). SageMaker's execution role is scoped to `songs/*` only, never bucket-wide.

There is no RDS/PostgreSQL in this design (v3 had it; v4 moved vocab/spaced-repetition state to DynamoDB `GSI2` to drop the VPC/NAT Gateway requirement — see `architecture.md` sections 1 and 8 for the reasoning).

Full schemas (DynamoDB item shapes, MongoDB doc shape) and the complete API endpoint table live in `architecture.md` — read it before touching the data layer or adding an endpoint, since field names and index choices there are deliberate.

## Build phases

Work proceeds in this order; don't jump ahead (e.g. don't build the Go WebSocket stack before Phase 3's polling proves insufficient):

1. Local Python-only pipeline (Demucs → Whisper → Helsinki-NLP → Basic Pitch) on one file, no AWS. Validate the ML chain before building infra around it.
2. Containerize each stage, push to ECR, wire the Step Functions ASL. Trigger manually, no API yet.
3. API Gateway (HTTP) + Python/Rust Lambda + Cognito + DynamoDB table + GSIs. Exercise via Postman.
4. React frontend: upload, polling UI, MongoDB-backed player with Web Audio sync.
5. Java Lambda learning service: SM-2 scheduling against DynamoDB, `/vocab/review` and `/vocab/due` endpoints.
6. Go Lambda notification stack: API Gateway WebSocket API, `WebSocketConnections` table, DynamoDB Streams trigger. TensorFlow.js pitch matching in the client. C++ DSP core if Basic Pitch's stock tempo detection proves insufficient.

## Open decisions (don't treat these as settled)

- Translation granularity: line-by-line vs phrase-level.
- Whisper `large-v3` vs `medium` — benchmark on real songs before committing.
- MongoDB Atlas vs DocumentDB — Atlas first for speed/free tier; DocumentDB only worth revisiting if this ever moves back inside a VPC for other reasons.
- Build the C++ DSP core only if Basic Pitch's output shows a measurable gap.
- Plain Java Lambda vs Spring Cloud Function for the learning service — plain Lambda is the leaner, cheaper default at this scale.

## Security / IAM conventions to follow

- Cognito User Pool is the single identity source; API Gateway's JWT authorizer handles HTTP routes, and the Go `$connect` handler validates the same JWT at connect time — don't introduce a separate auth mechanism.
- IAM roles are scoped per-Lambda-function (e.g. SageMaker role limited to `songs/*`). No wildcard `s3:*`/`dynamodb:*`, no shared execution role across functions or pipeline stages.
- No VPC is used at the current (Tier A, 30-50 user) scale — every component talks over public AWS/internet endpoints with IAM/JWT-based auth instead of network isolation. This is a deliberate tradeoff, not an oversight; revisit only if scale or compliance requirements change.
- Secrets (MongoDB Atlas connection string) go in AWS Secrets Manager, read directly by Lambda at cold start and cached in the execution environment across warm invocations.
