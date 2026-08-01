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
