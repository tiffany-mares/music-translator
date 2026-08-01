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

## 6.3 — Frontend WebSocket integration

**Date:** 2026-08-01 · **Zero terraform** — pure frontend + a CloudFront deploy.

**Architecture (cache-write):** `JobSocketProvider` (mounted in Shell — socket scoped to the signed-in session, App unmount = teardown) owns one `JobSocket` (`frontend/src/ws/jobSocket.ts`, framework-free). Every frame with a `jobId` → `queryClient.setQueryData(['job', jobId], frame)` — all three existing observers (UploadPanel/Player/JobStatusLine) update with ZERO component changes since 6.2 pinned the push payload to the `Job` shape. `useJobPolling` gates its interval on `useJobSocket().healthy`: healthy → **60s safety net** (6.2 pushes are at-most-once; a missed frame with no interval would stall forever — this keeps "polling is the documented fallback" literally true), unhealthy → the untouched 4.2 backoff. Context default `{healthy:false}` = every pre-6.3 test unchanged.

**JobSocket behavior (unit-pinned):** fresh ID token per connect attempt (1h expiry is handshake-time-only); 240s app-level keepalive (`{"action":"keepalive"}`; the route-less API answers each with an error frame — dropped, along with all frames lacking a string jobId); reconnect ladder 1s→30s cap, reset on successful open, onclose-only driven (onerror always precedes onclose — acting on both double-schedules); `stop()` = deliberate close with reconnect suppressed (kill ≡ stop, one method) — exposed as `window.__cadenzaKillSocket` (ships in prod; server-side delete-connection is useless for the gate — auto-reconnect undoes it in ~1s); StrictMode-safe (stop during the token fetch aborts the connect).

**Two testing-infrastructure findings:**
1. **jsdom DOES ship a WebSocket** (contrary to common belief) — Shell/App tests would have dialed the real prod wss endpoint from CI. Fixed globally in `src/test/setup.ts`: `delete globalThis.WebSocket` — the suite is WS-less by default (JobSocket's lazy `globalThis.WebSocket` guard turns absence into "permanently unhealthy" = the polling fallback), and WS tests opt in with `vi.stubGlobal('WebSocket', FakeWebSocket)`.
2. **Post-kill polling resumes at the 15s CAP, not 2s** — `setQueryData` increments React Query's `dataUpdateCount`, so the backoff is already capped mid-session. Correct per §5.1 (backoff protects the API early in a job's life); verified in RQ v5 source (`setOptions` → `#computeRefetchInterval` reschedules when the interval value changes).

**The gate (two runs — the first taught a lesson):**
- Run 1 (Dragostea window -ss 20, job `a0fa5d6b85c2.9b478525805b`): WS connect + primacy proven (exactly 1 `GET /jobs` in 95s — the 60s net — while the UI stayed current), kill deleted the connection row with no reconnect… then all polling appeared dead. Root cause was NOT the app: **Chrome's memory saver FROZE the backgrounded tab** (CDP unresponsive, all timers stopped), then discarded+reloaded it. The `pollingFallback.test.tsx` unit written mid-diagnosis proved the mechanism sound. Job completed server-side.
- Run 2 (Trenulețul -ss 30 — fresh source, all Dragostea windows are fingerprinted; job `6f7cfdfa6e21.45bf6ad416e6`, tab kept VISIBLE): measured via the in-page Performance API (the extension's network tracker goes blind after a clear — resource timing is the honest instrument): fetches at 18/81/142/203/263/323s = **60s cadence while WS-primary**, kill at ~340s (row deleted, never reconnected), next poll at **357s = exactly the 15s cap later**, which returned COMPLETE → **"Complete — lyrics are ready." rendered via polling alone on a dead socket.** THE done-when.

**Operational note for live gates (recorded for good):** Chrome freezes fully-hidden/covered tabs (memory saver) — visibilityState must be `visible`, occlusion counts as hidden on Windows. Keep the window side-by-side during any timed browser gate.

**Suite:** 132 → **155 frontend tests / 24 files** (3 interval gating + 12 JobSocket + 7 provider + 1 kill-then-poll pin). `$default` route stays deferred.

**Verdict:** Phase 6.3 done — WS is the primary status path (sub-second updates, 60s background poll), and the polling fallback demonstrably carries a job to completion after a deliberate mid-session kill. Remaining in Phase 6: 6.4 TensorFlow.js sing-along mode (CREPE, lazy-loaded, IndexedDB-cached, Web Worker), 6.5 C++ DSP core (conditional — benchmark first). Project-wide: 2.6 still quota-gated.
