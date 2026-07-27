# Phase 3 notes

## 3.0 — Terraform adoption (the committed Phase 3 prerequisite)

**Date:** 2026-07-27
**Commitment fulfilled:** "Phase 3 MUST begin with adopting §7's Terraform layout" (decided 2026-07-27, recorded in notes/phase2.md §2.3). Terraform v1.15.8 via winget; root at `terraform/` with §7's modules (`storage`, `ml-processing`, `orchestration`, `api`); the `frontend` module and the `environments/dev|prod` split are deferred until they have content (YAGNI, recorded deviation).

**State backend:** S3 `lyralearn-tfstate-503233513399` (versioned) with native lockfile (`use_lockfile = true`, no lock table). The tfstate bucket itself is the one CLI-bootstrapped resource, by design.

**Imported estate (24 resources):** audio bucket; LyraLearnTable; WebSocketConnections; 4 ECR repos; 5 IAM roles + 5 inline policies (SageMaker, SFN, 3 Lambda); 3 container Lambdas; 2 state machines; Cognito pool + client. `terraform plan` → **"No changes. Your infrastructure matches the configuration."**

**Division of labor:** Terraform owns existence, configuration, IAM, and state-machine definitions (rendered from the same `infra/aws/*.json` templates via `replace()` — the JSON files remain the single source of truth). Image code deploys stay with `scripts/aws/deploy_*_lambda.sh` (`update-function-code`; TF has `ignore_changes = [image_uri]`). `deploy_state_machine.sh` / `deploy_chunked_state_machine.sh` are superseded by `terraform apply` (kept for reference; prefer TF). Map concurrency is now the `chunked_max_concurrency` TF variable.

**Workflow findings (hard-won, three failed applies):**
- The AWS provider **cannot** use the root `aws login` session (same class of limitation as the pinned boto3): every terraform command needs `eval "$(aws configure export-credentials --profile new-profile-name --format env)"` first.
- Those exported tokens live **~15 minutes** — long applies (GSI backfills) die mid-flight with "Failed to save state". Keep applies short, export immediately before, and expect to re-import orphans if an apply dies after creating resources but before persisting state (happened twice: WebSocketConnections, Cognito pool+client — fixed with import blocks).
- Imported Cognito clients report `generate_secret` as null; an explicit `= false` forces pointless replacement — leave it implicit.
- Plan-guard discipline: script-check the plan line for `0 to destroy` before ANY apply.

**Regression proof:** linear pipeline execution `job-tf-probe` on the imported state machine/roles → SUCCEEDED, job item COMPLETE with lyricsKey.

## 3.1 — Cognito + DynamoDB foundation

**Date:** 2026-07-27
**Resources (all Terraform-native or TF-managed):** User Pool `lyralearn-users` (`us-east-1_m1EBuRGMm`, email sign-in, 12-char password policy), public client `lyralearn-web` (`3a0g52nr1supgrak3u1lbambp6`, ADMIN_USER_PASSWORD_AUTH for server-side test tokens + SRP for the browser, 1 h tokens / 30 d refresh); `LyraLearnTable` GSI1 (`GSI1PK`/`GSI1SK`), GSI2 (`GSI2PK`/`GSI2SK`), GSI3 (`GSI3PK`), all projection ALL; `WebSocketConnections` (PK `connectionId`, `GSI1` on `userId`) — live but unused until Phase 6, per §10.

**Clarification recorded:** 3.1's "JWT authorizer" = the token-issuing side (pool + client), built now; the API Gateway JWT authorizer that VALIDATES tokens arrives with the HTTP API in 3.2 and is configured from the `jwt_issuer` / `user_pool_client_id` Terraform outputs.

**Done-when (`POOL_ID=... CLIENT_ID=... AWS_REGION=us-east-1 bash scripts/verify_3_1.sh`):**
```
JWT: issued, issuer OK
JWT: audience OK
GSI1: read OK
GSI2: read OK
GSI3: read OK
WebSocketConnections GSI1: read OK
PASS - Phase 3.1 done-when met.
```
Test user `test@lyralearn.dev` kept for 3.2's Postman work. GSI backfill on the near-empty table took ~5 min per index.

**Verdict:** 3.0 + 3.1 done. Next: 3.2 (core Python Lambda routes — needs the HTTP API + JWT authorizer wired from the outputs above, plus MongoDB Atlas for the lyrics read path per the Phase 2.3 S3-only decision). Phase 2.6 remains open in parallel, gated on the g4dn quota-6 request.

## 3.2 — Core Python Lambda routes

**Date:** 2026-07-27
**Endpoint:** `https://v7iyrsczl5.execute-api.us-east-1.amazonaws.com` (HTTP API `lyralearn-http-api`, `$default` stage, Cognito JWT authorizer validating ID tokens by `aud`=client id). Lambda `lyralearn-api` (python3.12 zip via Terraform `archive_file`, 256 MB/10 s, role `lyralearn-lambda-api` scoped to the table + `songs/*`). All Terraform-native — 12 resources, plan-guard clean.

**Decisions recorded (user, 2026-07-27):**
- **Lyrics S3-backed in 3.2**; **MongoDB is a BINDING part of Phase 3.5**: "Phase 3.5 MUST include: Atlas M0 + Secrets Manager connection string + RunTranslation dual-write + lyrics-route swap to Mongo + S3 backfill." Same force as the (fulfilled) Terraform commitment.
- **Composite jobId** `{songId}.{jobKey}` (split on last dot) — §6.1 keys jobs under the song, so a bare jobKey isn't addressable; `POST /songs/{id}/process` (3.5) mints these.
- **`audioKeys` map** (`raw`/`vocals`/`noVocals` S3 keys) added to the §6.1 METADATA attributes; drives `GET /audio-urls`. The pipeline populates it starting 3.5.

**Done-when (`scripts/verify_3_2.sh`):**
```
auth: unauthenticated 401 OK
POST /songs: shape OK
GET /jobs: shape OK (real job, COMPLETE)
GET /lyrics: section 6.2 doc OK
GET /audio-urls: shape OK
presigned raw URL: fetches 200 OK
PASS - Phase 3.2 done-when met.
```
Seed data was almost entirely REAL pipeline output (job item `job-2-5`, translated lyrics doc, 2.5 stitched stems); only the METADATA item was synthetic (`scripts/seed_3_2.sh`). Postman: base URL above + a fresh IdToken from `admin-initiate-auth` (the verify script prints one).

**Finding:** boto3's default S3 client emitted legacy SigV2 presigned URLs (functional, non-standard) — the handler forces `signature_version="s3v4"`. Also note the HTTP API JWT authorizer validates ID tokens (`aud` claim); Cognito ACCESS tokens carry `client_id` instead and get 401 — use IdToken in clients.

**Verdict:** 3.2 done. Next: 3.3 (Rust validation Lambda). Phase 2.6 still parked at the quota gate.
