# LyraLearn

A music-based language learning platform. Upload a song, and LyraLearn separates it into stems, transcribes and translates the lyrics, and extracts melody/pitch data to power an interactive, word-synced learning player with spaced-repetition vocab review.

## Status

Pre-implementation. The design is complete (see below); no application code has been written yet. Development follows the phased plan in `architecture.md`, starting with a local, AWS-free proof of concept of the ML pipeline.

## How it works

1. Upload audio. If it's a song LyraLearn has already processed (matched by acoustic fingerprint, even at a different bitrate), the player is ready almost instantly. Otherwise, the song is split into overlapping chunks and processed in parallel: separated into stems (Demucs), transcribed (faster-whisper), and analyzed for pitch/beat (Basic Pitch + a C++ DSP core), then translated — a new song takes roughly 70-110 seconds end to end.
2. Playback starts immediately once the upload is validated — it doesn't wait on the pipeline. Lyrics, translation, and pitch data hydrate into the player progressively as they become available, and once they land the player synchronizes translated lyrics to playback word-by-word using the Web Audio API.
3. Vocabulary encountered during playback is scheduled for review using the SM-2 spaced-repetition algorithm (the same one Anki uses).

## Documentation

- [`architecture.md`](./architecture.md) — full design doc: API contracts, data schemas, state machine, IAM scoping, cost considerations, and the phased build plan.
- [`CLAUDE.md`](./CLAUDE.md) — condensed architecture summary and conventions for AI-assisted development in this repo.

## Tech stack

Fully serverless: AWS (Lambda, API Gateway HTTP + WebSocket, SageMaker, S3, DynamoDB, Cognito), Python/PyTorch (ML pipeline), React/TypeScript (frontend), Rust (upload validation), Go (WebSocket Lambda functions), Java (learning service Lambda), C++ (DSP core), DynamoDB, and MongoDB Atlas. No EKS, RDS, or VPC — see `architecture.md` for the cost/design rationale.
