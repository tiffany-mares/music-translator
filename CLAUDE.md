# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LyraLearn (repo: music-translator) has no implementation yet — only `README.md` and the architecture decisions below. There are no build/lint/test commands because no code exists. The project follows a phased build plan (see "Build phases"); start with Phase 1 and add real commands to this file as each phase's code lands.

## What this is

A music-based language learning platform: upload a song, split it into stems, transcribe and translate the lyrics, extract melody/pitch data, and play it back in a word-synced interactive player with spaced-repetition vocab review.

## Architecture

### Pipeline (the core async flow)

```
Browser (React+TS) --upload--> S3 (pre-signed PUT)
  --> POST /songs/{id}/process --> Rust validation Lambda --> Step Functions (STANDARD)
        --> SageMaker Processing Jobs, one container per stage, GPU (ml.g4dn.xlarge):
              Demucs -> Whisper -> Helsinki-NLP (translation) -> Basic Pitch
              (Basic Pitch stage links a C++ DSP core via pybind11 for beat detection)
  --> job status pushed via Go WebSocket hub (subscribes to DynamoDB Streams)
      or polled via GET /jobs/{id} (React Query, exponential backoff 2s->15s cap)
  --> on COMPLETE: GET /songs/{id}/lyrics (MongoDB) + /audio-urls (S3 pre-signed GET)
  --> playback events POST to Java/Spring Boot learning service (SM-2 scheduling)
```

Latency budget: steps through the SageMaker pipeline take 3-6 min (GPU-bound) and are fully async/decoupled; everything else is sub-second. This asymmetry is why job status is push/poll rather than a synchronous response.

Two ALBs (or one ALB with path routing): API Gateway/Lambda handles `/songs`, `/jobs`, auth; a separate ALB → EKS Ingress handles `/vocab/*` (Java) and `/ws` (Go), since API Gateway can't proxy to EKS pods without a VPC Link.

### Services and their responsibilities

- **Python Lambda** — `/songs`, `/jobs/{id}`, `/songs/{id}/lyrics`, `/songs/{id}/audio-urls` — thin read/proxy layer over DynamoDB, MongoDB, and S3 pre-signing.
- **Rust Lambda** — upload validation only (format/size/header checks); chosen for low cold-start on the hot upload path.
- **Step Functions (ASL)** — orchestrates the 4 SageMaker stages with per-stage `Retry`/`Catch` → `MarkFailed`. Uses `.sync` SageMaker integration (blocks until job finishes, no manual polling) and STANDARD (not EXPRESS) workflow type for full execution history on a pipeline that fails intermittently (OOM, malformed audio).
- **Go service (EKS)** — WebSocket hub, one goroutine per connection + central broadcast loop (only the hub loop touches the `clients` map, avoiding lock contention). Fed by a DynamoDB Streams consumer filtering `MODIFY` events on `Job` items. Needs `replicas >= 2` since it holds long-lived connections.
- **Java/Spring Boot service (EKS)** — learning service: `VocabController`/`ReviewController` → `SpacedRepetitionService`/`QuizGenerationService` → JPA repositories → RDS PostgreSQL. Implements SM-2 spaced repetition (same algorithm as Anki) in `SpacedRepetitionService.schedule()`.
- **C++ DSP core** — beat/tempo detection, exposed to the Basic Pitch Python container via pybind11 (`dsp_core` module). Only build this if Basic Pitch's stock output proves insufficient — not speculative.
- **React/TS frontend** — Web Audio API `AudioContext.currentTime` sampled on `requestAnimationFrame`, binary-searched against sorted word-timing data (cheaper and more accurate than a `setInterval` re-render loop). TensorFlow.js CREPE model runs in a Web Worker against mic input for pitch matching, so it doesn't block the main thread.

### Data layer — which store owns what

- **DynamoDB** (`LyraLearnTable`, on-demand) — job state + song metadata. Single-item `Get/UpdateItem` by `PK`/`SK`. `GSI1(PK=userId, SK=createdAt)` supports "list a user's songs by upload date" without a scan.
- **MongoDB** — lyrics/translation/word-timing, one document per song, shape mirrors Whisper's nested output. Unique index on `songId`; add a text index on `lines.words.text` only if "find songs containing word X" is actually needed.
- **RDS PostgreSQL** — vocab, spaced-repetition state, review history. Index on `user_vocab_progress(user_id, next_review_at)` — this is the hottest query in the learning service.
- **S3** — `songs/{songId}/{raw|stems|pitch}/...`, SSE-S3, `raw/` transitions to IA after 30 days (stems/pitch stay Standard, read on every playback). SageMaker's execution role is scoped to `songs/*` only, never bucket-wide.

Full schemas (DynamoDB item shapes, MongoDB doc shape, PostgreSQL DDL) and the complete API endpoint table live in `architecture.md` — read it before touching the data layer or adding an endpoint, since field names and index choices there are deliberate.

## Build phases

Work proceeds in this order; don't jump ahead (e.g. don't build the Go/EKS notification path before Phase 3's polling proves insufficient):

1. Local Python-only pipeline (Demucs → Whisper → Helsinki-NLP → Basic Pitch) on one file, no AWS. Validate the ML chain before building infra around it.
2. Containerize each stage, push to ECR, wire the Step Functions ASL. Trigger manually, no API yet.
3. API Gateway + Python/Rust Lambda + Cognito + DynamoDB. Exercise via Postman.
4. React frontend: upload, polling UI, MongoDB-backed player with Web Audio sync.
5. Java/Spring Boot learning service on EKS + RDS PostgreSQL, SM-2 scheduling.
6. Go notification service (WebSocket) on EKS, TensorFlow.js pitch matching, C++ DSP core if warranted.

## Open decisions (don't treat these as settled)

- Translation granularity: line-by-line vs phrase-level.
- Whisper `large-v3` vs `medium` — benchmark on real songs before committing.
- WebSocket vs polling — polling ships first (Phase 3); Go service is added only once polling UX genuinely suffers.
- MongoDB Atlas vs DocumentDB — Atlas first for speed.

## Security / IAM conventions to follow

- Cognito User Pool is the single identity source; API Gateway's JWT authorizer and the Go/Java services all validate against the same pool's JWKS endpoint — don't introduce a separate auth mechanism.
- IAM roles are scoped per-function/per-service (e.g. SageMaker role limited to `songs/*`; Go/Java EKS pods use IRSA scoped to only the AWS resources each needs). No wildcard `s3:*`/`dynamodb:*`, no shared execution role across pipeline stages.
- Secrets (RDS credentials, MongoDB connection string) go in AWS Secrets Manager via the Secrets Store CSI Driver, not plain Kubernetes Secrets.
