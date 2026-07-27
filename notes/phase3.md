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

## 3.3 — Rust validation Lambda

**Date:** 2026-07-27
**Function:** `lyralearn-validate` — Rust on `provided.al2023` (zip 5.2 MB, 128 MB memory), route `POST /songs/{id}/process` behind the existing JWT authorizer. **No Rust toolchain on the host**: built inside `ghcr.io/cargo-lambda/cargo-lambda` (`scripts/build_validate_lambda.sh`); the image's rustc (1.93) lags the newest AWS SDK crates' MSRV, solved with `rust-version = "1.93"` + the `incompatible-rust-versions = "fallback"` resolver setting.

**Validation rules:** size 50 KB–25 MB; magic-byte format detection (ranged S3 GET, bytes 0–11) for the ML container's five formats — mp3 (ID3 or MPEG frame sync), wav (RIFF/WAVE), flac, ogg, m4a (ftyp). Verdicts land on the METADATA item: `status=VALIDATED` + `audioFormat`, or `status=REJECTED` + `rejectionReason` (attributes additive to §6.1, recorded). **Deliberately does NOT start Step Functions** — 3.4 adds fingerprinting into this same function (§5.2a), 3.5 wires the pass-path to the pipeline.

**Done-when (`scripts/verify_3_3.sh`):**
```
valid mp3: accepted (format=mp3)
valid mp3: status VALIDATED
garbage upload: rejected 400 (header check)
garbage upload: status REJECTED
missing upload: rejected
Step Functions: zero new executions (before/after 5/5 linear, 2/2 chunked)
PASS - Phase 3.3 done-when met.
```
The last line is the §10 clause measured, not assumed: execution counts on both state machines captured before/after all three cases. When 3.5 wires the pass-path to SFN, the malformed cases must STILL show zero new executions.

**Verdict:** 3.3 done. Next: 3.4 (chromaprint fingerprinting + GSI3 dedup in this same Lambda).

## 3.4 — Fingerprint dedup

**Date:** 2026-07-27
**Function:** same `lyralearn-validate` Lambda (Rust) as 3.3 — fingerprinting is an added step in the existing hot path, not a new function. Stack: `rusty-chromaprint` 0.3.0 (`Configuration::preset_test2()`, chromaprint's own `ALGORITHM_DEFAULT`/fpcalc default, with internal resample+downmix) decoding via `symphonia` 0.5.x (`mp3`, `aac`, `isomp4`, `alac` features); fingerprints only the first 120 s of audio (`MAX_FINGERPRINT_SECONDS`, AcoustID convention, bounds CPU). A zero-channel guard was added post-review (a malformed-but-probeable file reporting zero decoded channels would otherwise panic on the sample-count divide) — returns a graceful `Err` instead of a Lambda 500. Zip grew to 5.8 MB (was 5.2 MB in 3.3, +~0.6 MB for symphonia/rubato/rusty-chromaprint's transitive deps).

**Two-stage dedup design:** `GSI3PK = FP1#<simhash32 hex>` is an exact-match candidate filter on GSI3 (the `FP1#` prefix is versioned so a future fingerprint-algorithm change can't collide with old entries); candidates are then verified acoustically via `match_fingerprints` (score ≤ 10, coverage ≥ 0.8 — both left at the brief's original defaults; the load-bearing `reencode_same_simhash_key` test passed on the first GREEN run with no threshold tuning and no need for the banded-LSH fallback). A simhash collision without acoustic agreement is harmless: the candidate is rejected by verification and the upload proceeds as a new song — a duplicate (cost) pipeline run, not a corruption. The banded-LSH fallback (4 time-banded keys `FP2B{n}#<hex>`, union candidates, same verification) stays documented in the plan for if `FP1` keys ever prove unstable in production; not needed for this phase.

**§6.1 attributes added (additive):** `GSI3PK`, `fpFull` (Binary, little-endian u32 fingerprint blob), `fpSeconds` (N, from `config().item_duration_in_seconds()`), `linkedSongId`, status value `LINKED`. LINKED items never carry `GSI3PK` — the index stays canonical on the original only, so link chains can't form (confirmed independently in Task 6's DynamoDB scan: a repeat upload of the same original file plus two separate re-encodes all resolved `linkedSongId` back to the one true canonical original, not to each other). `audioKeys` is copied to the linked item only when the original actually has it: the update expression is built in two variants because binding an unused `:keys` placeholder is a DynamoDB error, and pre-3.5 originals mostly have no `audioKeys` yet.

**Degradation decision:** if a format-validated file fails to fingerprint/decode, the song is written `VALIDATED` with no dedup rather than rejected. This is a documented codec limitation of symphonia 0.5's enabled feature set — HE-AAC `.m4a` and Ogg Opus files can't decode (not live-tested; a known gap the degradation path deliberately covers). Deliberate — §11's false-positive caution favors under-linking (worst case: a duplicate reprocesses through the pipeline) over blocking a validly-formatted upload on a decode gap.

**Auto-link decision:** §11 raised "manual review before auto-linking" as a caution on chromaprint's false-positive risk (e.g. two different live recordings of the same song). Resolved here in favor of auto-link guarded by acoustic verification (never raw fingerprint/simhash equality alone), because §10's done-when requires the second upload to link to the first without any human intervention. The score/coverage thresholds are the guard against the exact false-positive scenario §11 raised.

**Lambda config:** bumped 128 MB → 1024 MB / 30 s via Terraform (plan-guarded `0 to add / 2 to change / 0 to destroy`, applied by the user) to give the decode+fingerprint step headroom; note that API Gateway's 29 s integration-timeout ceiling means a client never experiences the final second of the 30 s Lambda timeout — API GW cuts the response at 29 s while the Lambda timeout protects the function itself. Measured CloudWatch REPORT lines at the deployed config: cold start (song A, first fingerprint of the session, includes the ~3.4 MB decode + chromaprint + init) 883.53 ms (Init 81.74 ms), warm invocations 52–599 ms, max memory used peaked at 49 MB against the 1024 MB provisioned. Both numbers are well under the ~8 s warm-duration concern threshold, so no follow-up bump to 1769 MB is warranted.

**3.5 race noted:** GSI3 is eventually consistent, so two near-simultaneous uploads of the same genuinely-new song can both miss the dedup check and both run the full pipeline — a cost duplication (both still write valid, independent results), not a data-correctness bug. Left for 3.5 to weigh, not addressed here.

**Gate-script decisions (`scripts/verify_3_4.sh`):**
- **Windows-curl ASCII-copy workaround:** the mingw `curl.exe` on this dev machine (8.21.0, Git Bash) can't open the accented fixture path (`Trenulețul - Zdob și Zdub (128k).mp3`) for `--upload-file` regardless of codepage/locale settings. The song-C (different-song control) step now `cp`s the fixture to an ASCII temp name before the PUT and removes it after, mirroring the script's existing `bad_upload.bin` pattern, instead of renaming the fixture repo-wide.
- **Idempotency pre-cleanup:** before capturing the BEFORE_LINEAR/BEFORE_CHUNKED Step Functions execution counts, the script now scans `LyraLearnTable` for items whose `GSI3PK` begins `FP1#` and issues `REMOVE GSI3PK` on each, de-indexing prior runs' fingerprints so a re-run's "song A" genuinely validates as new again rather than legitimately (and confusingly) linking to itself. Proved: two consecutive full runs of the committed script produced byte-identical `PASS` output.

**Done-when (`scripts/verify_3_4.sh`, post-fix committed script, unattended run):**
```
original: accepted, not linked
original: status VALIDATED
original: GSI3PK written
original: fpFull stored
re-encoded dup: linkedSongId == original
re-encoded dup: status LINKED
re-encoded dup: no GSI3PK (index stays canonical)
different song: VALIDATED, not linked
garbage upload: still rejected 400/REJECTED
Step Functions: zero new executions (before/after 5/5 linear, 2/2 chunked)
PASS - Phase 3.4 done-when met.
```

**Verdict:** 3.4 done. Next: 3.5 (Step Functions pass-path wiring + the BINDING MongoDB migration). Phase 2.6 remains parked at the quota-6 gate.
