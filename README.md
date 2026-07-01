# LyraLearn

A music-based language learning platform. Upload a song, and LyraLearn separates it into stems, transcribes and translates the lyrics, and extracts melody/pitch data to power an interactive, word-synced learning player with spaced-repetition vocab review.

## Status

Pre-implementation. The design is complete (see below); no application code has been written yet. Development follows the phased plan in `architecture.md`, starting with a local, AWS-free proof of concept of the ML pipeline.

## How it works

1. Upload audio, which is split into stems (Demucs), transcribed (Whisper), translated (Helsinki-NLP), and analyzed for pitch/beat (Basic Pitch + a C++ DSP core) via an async GPU pipeline.
2. Once processing completes, the player synchronizes translated lyrics to playback word-by-word using the Web Audio API.
3. Vocabulary encountered during playback is scheduled for review using the SM-2 spaced-repetition algorithm (the same one Anki uses).

## Documentation

- [`architecture.md`](./architecture.md) — full design doc: API contracts, data schemas, state machine, IAM scoping, cost considerations, and the phased build plan.
- [`CLAUDE.md`](./CLAUDE.md) — condensed architecture summary and conventions for AI-assisted development in this repo.

## Tech stack

Fully serverless: AWS (Lambda, API Gateway HTTP + WebSocket, SageMaker, S3, DynamoDB, Cognito), Python/PyTorch (ML pipeline), React/TypeScript (frontend), Rust (upload validation), Go (WebSocket Lambda functions), Java (learning service Lambda), C++ (DSP core), DynamoDB, and MongoDB Atlas. No EKS, RDS, or VPC — see `architecture.md` for the cost/design rationale.
