# Phase 6 — Real-time and polish

## 6.1 — WebSocket connection lifecycle

**Date:** 2026-08-01
**First Go code in the project** — `lambda/ws/` (module `lyralearn/ws`, go 1.24: the plan said 1.23 but the current AWS SDK v2 releases carry a `go >= 1.24` floor, so both the module and the build image moved up one minor). Docker-only per the no-host-toolchains convention: `scripts/build_ws_lambda.sh` runs `go mod tidy && go vet && go test` then cross-compiles both binaries inside `golang:1.24` (caches in gitignored `lambda/ws/.gocache/`).

**Stack/decisions:**
- **JWT: `golang-jwt/jwt/v5` + a ~40-line hand-rolled JWKS fetch** (not lestrrat jwx): zero transitive deps, and the JWKS code is exactly what the tests target (httptest JWKS server, kid selection, cache-hit counting) — with jwx we'd be testing a black box. Matches the Gson-without-reflection ethos. Validation enforces: RS256 vs JWKS kid, iss, exp (required), aud == client id, `token_use == "id"` (an access token carries `client_id` not `aud`, but the explicit check is pinned independently), non-empty sub. **Recorded tradeoff:** JWKS is cached for the container lifetime — a Cognito signing-key rotation would break warm containers until recycle; Cognito keys effectively never rotate short of pool recreation, and container turnover provides refresh. Accepted.
- **Auth placement:** WebSocket APIs cannot use the HTTP API's JWT authorizer, so per §9 ("same JWT, no separate auth mechanism") the connect handler validates the same Cognito ID token passed as the `token` query param (base64url + '.' — URL-safe, no escaping).
- **$connect semantics (pinned by tests):** missing/invalid token → `{StatusCode: 401}, nil` (a Go error would surface as 500; non-200 fails the handshake). **PutItem failure → 500** — a connected-but-untracked client would never receive 6.2's pushes; failing the handshake loudly lets the frontend keep its tested polling fallback (6.3's contract).
- **$disconnect semantics (pinned):** Dynamo delete failure → log + 200. The socket is already gone, API GW invokes $disconnect fire-and-forget (no retry on 5xx); the leaked row is the same stale-row class 6.2's PostToConnection GoneException cleanup handles. **No TTL on WebSocketConnections** (spec has none) — stale rows accepted until 6.2.
- **`$default` route DEFERRED** (YAGNI — no client→server messages until 6.2/6.3). **Stage name `prod`**: WebSocket APIs reject the special `$default` stage name (HTTP-API-only; terraform-aws-modules/terraform-aws-apigateway-v2#7). Endpoint: `terraform output ws_endpoint` → `wss://wf10x3gbnl.execute-api.us-east-1.amazonaws.com/prod`.
- **Two IAM roles** (`lyralearn-lambda-ws-connect` / `-ws-disconnect`) per the no-shared-execution-role convention — connect gets PutItem only, disconnect DeleteItem only, each own logs. No pre-grant of 6.2 (the push handler is a separate function/role — pre-granting buys nothing, unlike 5.1's same-function case).
- **Reproducible zips — the Windows gotcha worth keeping:** `provided.al2023` requires the `bootstrap` entry to be *executable inside the zip*, and Windows-host zips carry no unix mode bits — so zipping happens in-container via the in-repo `tools/buildzip` (archive/zip, entry mode 0755, `Modified` pinned to 2026-01-01). Combined with `-trimpath -ldflags "-s -w"`, zip bytes are byte-reproducible (verified: identical sha256 across two builds), so `filebase64sha256` only churns on real code changes — the Go analog of the learning jar's `outputTimestamp`. Zips ~5.0MB each; 128MB/10s functions.

**Terraform (applied 2026-08-01, exactly `14 to add, 0 to change, 0 to destroy`):** WS API `lyralearn-ws-api` (WEBSOCKET, route_selection_expression `$request.body.action`), 2 roles + 2 policies (`infra/aws/lambda-ws-{connect,disconnect}-policy.json`), 2 functions, 2 integrations (payload 1.0 — WS integrations are 1.0-only), `$connect`/`$disconnect` routes (authorization NONE — auth is in-handler), stage `prod` auto_deploy, 2 permissions. The stable learning-jar hash in the same plan doubled as a reproducible-build regression check.

**Suite:** 19 in-container Go tests (10 auth incl. the httptest JWKS harness with local RSA keypair + token minting; 3 store; 6 handler), `go vet` clean.

**Done-when gate (`scripts/verify_6_1.sh`, run 2026-08-01, first-try PASS):**
```
CONNECTED
connect: row present via GSI1 (connectionId=gV2hpE89GQAYKEhaKA==)
connect: base-table item userId == test user's sub
CLOSED
disconnect: row deleted (the done-when)
REFUSED type=InvalidStatus status=401   (bad token)  -> no row written
REFUSED type=InvalidStatus status=401   (no token)   -> no row written
PASS - Phase 6.1 done-when met.
```
Client = python `websockets` (test-only pip dep in lyralearn-env, auto-installed by the script; NOT in requirements.txt). All table assertions via GSI1 (userId=sub) — the client never learns its connectionId; disconnect is async best-effort, so deletion is polled (observed within ~1-2s).

**Verdict:** Phase 6.1 done — connecting and disconnecting a real WebSocket client correctly updates the table, and unauthenticated handshakes are refused. Next: 6.2 — DynamoDB Streams trigger → push handler (§5.6), tested against a real pipeline run (needs Streams enabled on LyraLearnTable + the third Go function with PostToConnection + GoneException cleanup).

## 6.2 — Push on job completion

**Date:** 2026-08-01
**Third Go Lambda** `lyralearn-ws-push` (`internal/push` + `cmd/push`), driven by DynamoDB Streams on LyraLearnTable (NEW_IMAGE — old image never needed) via an event source mapping (`starting_position=LATEST`, `maximum_batching_window_in_seconds=0` for latency) with server-side **FilterCriteria** `{"eventName":["MODIFY"],"dynamodb":{"Keys":{"SK":{"S":[{"prefix":"JOB#"}]}}}}` — vocab/metadata writes on the same stream never invoke the function (the same predicate is unit-tested in-code as belt and braces).

**Three documented deviations from the §5.6 reference:**
1. **Owner lookup via METADATA, not the stream image** — the reference calls `extractUserIdFromKey(NewImage)`, but the real schema puts NO userId on JOB# items; the owner lives only on `SONG#{songId}/METADATA.uploadedBy`, so the handler parses songId from the record PK and GetItems that (missing → log+skip).
2. **Fan-out to ALL of the user's connections** via WebSocketConnections GSI1 (the reference's single `lookupConnectionId` breaks multi-tab).
3. **`Handle` always returns nil** — a returned error makes Streams re-drive the whole batch, duplicating pushes to healthy connections; at-most-once is correct for status pushes since 4.2's polling remains the tested fallback. Every failure mode (metadata error, lister error, post error, delete error) logs and continues.

**Message = the `GET /jobs/{id}` polling contract byte-for-byte** (`{jobId, songId, status, stage?, chunkCount?, error?}`; errorInfo capped at 500 RUNES for parity with Python's character slice; `stageOutputs` deliberately never leaks) — 6.3 reuses the frontend `Job` type unchanged. GoneException (410) → `push.ErrGone` sentinel (mapped in `APIPoster` so handler tests never touch the SDK) → best-effort DeleteItem of the stale row, reusing `store.DynamoStore.Delete`.

**IAM/terraform:** role `lyralearn-lambda-ws-push` with stream-read on `table/LyraLearnTable/stream/*` (wildcard — the stream label is a timestamp that changes on re-enable), GetItem on the table, Query on WebSocketConnections/GSI1, DeleteItem on WebSocketConnections, `execute-api:ManageConnections` on `{ws-api-id}/prod/POST/@connections/*` (`__WS_API_ID__` = third placeholder, triple-replace precedent). Applied `4 to add, 3 to change, 0 to destroy` — the 3 changes: stream enable + ws_connect/ws_disconnect hashes (`store.go` gained `Query`/`ConnectionsByUser` and compiles into both binaries; expected, not a reproducibility regression). Management endpoint via env `WS_MANAGEMENT_ENDPOINT` (https form of the stage URL) → SDK `Options.BaseEndpoint`.

**The 10-minute idle-timeout finding (6.3 design input):** API Gateway idles WebSocket connections out at 10 min; the PROCESSING→COMPLETE gap (~10 min at quota 1) exceeds it. The verify listener sends an app-level `{"action":"keepalive"}` frame every 240s — with no `$default` route API GW answers each with an error frame but does NOT close the socket (observed live); frames without `jobId` are ignored. **Browsers cannot send WS protocol pings from JS at all**, so 6.3's frontend needs the same app-level keepalive (or reconnect-on-close + the polling fallback); consider a no-op `$default` route to silence the error frames.

**ESM cold-start gotcha (observed, worth keeping):** an event source mapping created moments before its first records can MISS them — with LATEST, the checkpoint is set when polling actually starts (~1-2 min after creation), not at resource creation. Run 1 (job `cba8fd2e8c9c.b499b451936d`, started ~2 min after the apply) lost its PROCESSING push to exactly this race — the stream demonstrably contained the MODIFY (read back via `aws dynamodbstreams get-records`), the Lambda log group didn't exist yet, and a synthetic JOB# MODIFY minutes later invoked the function correctly ("no METADATA/uploadedBy - skipping"). Run 1 still received its COMPLETE push at **+0.5s** vs SFN stopDate. One-time condition; steady-state unaffected.

**Suite:** 19 → **39 in-container Go tests** (+3 store ConnectionsByUser incl. pagination, +14 push handler/filter/shape/fan-out, +3 metadata, +3 poster incl. GoneException mapping), vet clean.

**Done-when gate (`scripts/verify_6_2.sh`, run 2 with CUT_SS=190, full PASS):**
```
LISTENER CONNECTED
PUSH PROCESSING 9988fc2c1110.69725d6aa301          <- arrived before bash even echoed the jobId
push: PROCESSING received within 3 min (stream->push wiring live)
KEEPALIVE SENT
PUSH COMPLETE 9988fc2c1110.69725d6aa301
push latency: received +0.7s relative to SFN stopDate
push: payload matches the GET /jobs contract
no-polling: structural - the listener is a WebSocket client with no HTTP code path
confirmation: single post-hoc GET /jobs agrees (COMPLETE)
PASS - Phase 6.2 done-when met.
```
Two real cache-miss pipeline runs total (windows -ss 160 and 190 of input_song.mp3, ~7-11 min each at quota 1); both COMPLETE pushes sub-second vs stopDate. The script takes `CUT_SS` (each run permanently fingerprints its window).

**Verdict:** Phase 6.2 done — a connected client receives the push the moment MarkComplete writes (+0.7s), without polling. Next: 6.3 — frontend WebSocket integration (primary status path → WS, polling stays the documented fallback; done-when: polling still works when the WS connection is deliberately killed mid-session). Carry-ins for 6.3: app-level keepalive (browsers can't protocol-ping), maybe a no-op $default route.
