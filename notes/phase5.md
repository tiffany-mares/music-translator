# Phase 5 — Learning service

## 5.1 — Data + skeleton

**Date:** 2026-07-31
**Function:** `lyralearn-learning` — the project's first Java Lambda. Runtime **java21** (docs were silent on version/packaging; newest Lambda-supported chosen), plain Java per architecture.md §5.5 ("plain Java Lambda is the leaner choice at this traffic volume" — no Spring), packaged as a maven-shade fat jar. Handler `com.lyralearn.learning.Handler::handleRequest` (`RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse>`, aws-lambda-java-core 1.2.3 + events 3.14.0). 512MB/10s — JVM cold start observed comfortably inside the timeout on first invoke. NO DynamoDB SDK dependency yet: the 5.1 stub answers 501 `{"error":"not implemented yet","service":"lyralearn-learning","path":...}` on everything; real handlers land in 5.3.

**Build (no-host-toolchain rule extended to Java):** the host JDK is 26/OpenJ9 (Semeru) — wrong version AND vendor for Lambda — and there is no host Maven/Gradle. `scripts/build_learning_lambda.sh` runs `mvn package` (tests included) inside `maven:3.9-eclipse-temurin-21`, caching deps in gitignored `lambda/learning/.m2/`. **Reproducible-build trick worth keeping:** `project.build.outputTimestamp` in the pom makes the shaded jar byte-identical for identical sources, so terraform's `filebase64sha256` only churns when code actually changes (the Rust zip lacks this property).

**Terraform (applied 2026-07-31, `7 to add, 0 to change, 0 to destroy`):** mirrors the Rust validate pattern — prebuilt artifact by `filename`+`filebase64sha256` (a jar IS a zip; terraform accepts it directly), own role from the shared `lambda-trust.json`, scoped policy from new `infra/aws/lambda-learning-policy.json` (double-`replace()` — no `__BUCKET__` token needed). Both Phase-5 routes (`POST /vocab/review`, `GET /vocab/due`) wired to the stub behind the shared Cognito JWT authorizer; CORS untouched (GET/POST already allowed). **Deliberate IAM over-grant recorded:** the policy already carries Get/Put/UpdateItem on the table + Query on GSI2 (the full Phase-5 charter) so 5.3 ships with zero additional IAM applies.

**Vocab schema as written (§6.1-authoritative — note the §5.5/CLAUDE.md drift `vocabId` vs `vocabItemId`; §6.1 wins):** `PK=USER#{userId}`, `SK=VOCAB#{vocabId}`, attributes `term`, `definition`, `easeFactor` (N), `intervalDays` (N), `repetitions` (N), `nextReviewAt` (S, ISO-8601 UTC), `lastReviewedAt` (S), plus `GSI2PK=USER#{userId}` / `GSI2SK=nextReviewAt`.

**GSI2 due-today shape now proven** (3.1 only ever queried by hash key): `GSI2PK = :u AND GSI2SK <= :now` with ISO-8601 strings — lexicographic string comparison IS chronological comparison for this format, which is the entire reason `nextReviewAt` must stay ISO-8601 UTC (a locale-formatted or epoch-mixed value would silently break due-today).

**Done-when gate (`scripts/verify_5_1.sh`, run 2026-07-31, first-try PASS):**
```
insert: two vocab items written
GSI2 hash-only: both items indexed
GSI2 due-today: Count 1
GSI2 due-today: past-due item returned, future-due excluded
GET /vocab/due: 501 stub OK
POST /vocab/review: 501 stub OK
no token: 401 OK
PASS - Phase 5.1 done-when met.
```
(Two items — past-due "inima/heart", future-due "dor/longing" — inserted, queried, and trap-cleaned; the exclusion check is the part 3.1 never exercised.)

**Verdict:** Phase 5.1 done — the vocab data model is live and queryable in its due-today shape, and the Java service skeleton is deployed and reachable. Next: 5.2 — `SpacedRepetitionService.schedule()` in isolation (reference implementation in architecture.md §5.5; the JUnit harness this phase seeded is the landing pad), unit-tested against known SM-2 reference outputs before any AWS wiring.

## 5.2 — SM-2 logic in isolation

**Date:** 2026-07-31
**Files:** `SpacedRepetitionService.java` + `UserVocabProgress.java` in `lambda/learning` — pure Java, zero AWS, zero new deps. NOT deployed: 5.3 wires and deploys the first real handlers, so the next terraform plan will show 1 pending change (jar hash) — expected.

**Two documented deviations from the §5.5 verbatim reference:**
1. **Clock injection** — the reference calls `Instant.now()` directly (untestable); the service takes `java.time.Clock` (default `Clock.systemUTC()`) and uses `Instant.now(clock)`. Semantics identical.
2. **Quality range validation** — the reference comments `/* 0-5 */` without enforcing it; q>5 would INFLATE the ease factor via the negative `(5-q)` terms (q=6 → +0.28 per review), silently corrupting schedules. Out-of-range throws `IllegalArgumentException`.

**Spec properties the tests pin (some SM-2 variants differ — ours is the spec's):**
- `easeFactor` is NOT updated on failure (quality < 3) — the earned EF survives a lapse; only interval/repetitions reset.
- The interval multiplies by the UPDATED, floored EF (`p.getEaseFactor()` re-read after `setEaseFactor`), not the pre-update value.
- Floor 1.3, no cap; `Math.round` half-up; `p` is mutated AND returned.

**Reference tables (hand-computed, cross-checked against canonical SM-2; all verified by the suite):**
- all q=5: intervals 1, 6, 17, 49, 147; EF 2.6→3.0 (the canonical all-perfect sequence).
- all q=4: intervals 1, 6, 15, 38, 95; EF constant 2.5. **The 37.5 half-up boundary held**: the q=4 delta `0.1-(0.08+0.02)` is exactly 0.0 in doubles and `Math.round(37.5)=38` — no ulp drift observed.
- all q=3: intervals 1, 6, 12, 23, 41; EF decays 2.36→1.80.
- 5,5,5 → fail(1) → 5,5: interval ladder restarts at 1 but EF 2.8 is preserved through the lapse, then 2.9/3.0.

**Suite:** 17 tests total in-container (2 Handler + 15 SM-2 incl. parameterized quality 0/1/2 and out-of-range −1/6/42), `Tests run: 17, Failures: 0` — BUILD SUCCESS via `scripts/build_learning_lambda.sh`.

**Verdict:** Phase 5.2 done — SM-2 verified against known reference outputs in full isolation. Next: 5.3 — wire `POST /vocab/review` + `GET /vocab/due` to DynamoDB (IAM already granted in 5.1; done-when: a review event updates `nextReviewAt` and `/vocab/due` reflects it).
