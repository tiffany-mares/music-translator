# LyraLearn

A music-based language learning platform. Upload a song, and LyraLearn separates it into stems, transcribes and translates the lyrics, and extracts melody/pitch data to power an interactive, word-synced learning player with spaced-repetition vocab review.

**Landing page:** [cadenza.tiffmares.workers.dev](https://cadenza.tiffmares.workers.dev/) — the public face of the project (branded **Cadenza**), currently collecting beta signups.

## Status

**Backend pipeline and API are built and deployed** (as of July 2026). Development follows the phased plan in `architecture.md` §10; detailed per-phase evidence lives in `notes/`.

Done:

- **Phase 1 — local ML pipeline**: Demucs stem separation, faster-whisper (large-v3) transcription, MarianMT translation, and Basic Pitch melody extraction, runnable end-to-end with `python pipeline.py`.
- **Phase 2 (through 2.5) — pipeline on AWS**: containerized GPU pipeline on SageMaker (ml.g4dn.xlarge), orchestrated by the chunked Step Functions state machine (`lyralearn-pipeline-chunked`: ChunkAudio → parallel Map over ~40s chunks → StitchResults → RunTranslation). In-container ML time for the test song: ~60s.
- **Phase 3 (through 3.4) — API layer, auth, dedup**: Cognito-authenticated HTTP API backed by Python and Rust Lambdas — song creation, job status, lyrics, pre-signed audio URLs, upload validation (size/format), and chromaprint audio fingerprinting that links re-uploaded songs to existing results without re-running the pipeline. All infrastructure is Terraform-managed.
- **Phase 3.5 — end-to-end wiring + MongoDB migration** (code complete, deployed): a validated new upload now starts the chunked pipeline automatically; lyrics are served Mongo-primary with S3 fallback; the translate Lambda dual-writes to Atlas.

In progress / blocked:

- Phase 3.5 final verification awaits the MongoDB Atlas connection string being placed in Secrets Manager, then the backfill and the end-to-end gate (`scripts/verify_3_5.sh`).
- Chunk processing currently runs at `MaxConcurrency: 1` pending an AWS quota increase to 6 GPU instances (case open) — so a new song takes ~35-50 min wall-clock instead of the ~70-110s design target. Phase 2.6 (timing validation) is blocked on the same quota.

Not started: frontend (Phase 4), learning service (Phase 5), WebSocket push and sing-along mode (Phase 6).

## How it works

1. Upload audio. If it's a song LyraLearn has already processed (matched by acoustic fingerprint, even at a different bitrate), the player is ready almost instantly. Otherwise, the song is split into overlapping chunks and processed in parallel: separated into stems (Demucs), transcribed (faster-whisper), and analyzed for pitch/beat (Basic Pitch + a C++ DSP core), then translated — designed to take roughly 70-110 seconds end to end for a new song once chunks run in parallel (see Status for the current quota-limited state).
2. Playback starts immediately once the upload is validated — it doesn't wait on the pipeline. Lyrics, translation, and pitch data hydrate into the player progressively as they become available, and once they land the player synchronizes translated lyrics to playback word-by-word using the Web Audio API.
3. Vocabulary encountered during playback is scheduled for review using the SM-2 spaced-repetition algorithm (the same one Anki uses).

## Documentation

- [`architecture.md`](./architecture.md) — full design doc: API contracts, data schemas, state machine, IAM scoping, cost considerations, and the phased build plan.
- [`CLAUDE.md`](./CLAUDE.md) — condensed architecture summary and conventions for AI-assisted development in this repo.

## Tech stack

Fully serverless: AWS (Lambda, API Gateway HTTP + WebSocket, SageMaker, S3, DynamoDB, Cognito), Python/PyTorch (ML pipeline), React/TypeScript (frontend), Rust (upload validation), Go (WebSocket Lambda functions), Java (learning service Lambda), C++ (DSP core), DynamoDB, and MongoDB Atlas. No EKS, RDS, or VPC — see `architecture.md` for the cost/design rationale.
