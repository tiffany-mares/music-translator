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

## 5.3 — Wire the endpoints

**Date:** 2026-07-31
**Deploy:** zero terraform file edits — 5.1's IAM over-grant and route wiring paid off exactly as planned; the apply was `0 to add, 1 to change, 0 to destroy` (jar hash only, absorbing the 5.2 deferral too). Lambda updated in 13s.

**API contract (defined this phase — spec only had the §5.2 table notes):**
- `POST /vocab/review` body `{"vocabId","quality":0-5,"term"?,"definition"?}` → 200 `{"vocabId","nextReviewAt","intervalDays","repetitions","easeFactor","created"}`; 400 bad body/quality (non-number, non-integer, out-of-range, bad base64), 404 unknown item without `term`, 401 no sub claim.
- `GET /vocab/due` → 200 `{"items":[{vocabId,term,definition,nextReviewAt}],"count"}` — GSI2 query `GSI2PK = :u AND GSI2SK <= :now`, range-ascending so most-overdue first for free; GSI2 projects ALL so no follow-up reads.

**Create-on-first-review:** the spec has NO create-vocab endpoint anywhere — §5.5's frontend will create-on-encounter. So review does `GetItem` first: absent + `term` in body → first review of a new item (SM-2 defaults EF 2.5/reps 0/interval 0), absent without `term` → 404, present → load + `schedule()` + upsert. One `UpdateItem` (upsert semantics) serves both paths; response carries `"created"` so 5.5 can distinguish.

**Mixed-precision ISO finding (correctness-critical, unit-pinned):** `Instant.toString()` is *variable-precision* (`…:00Z` vs `…:00.123Z`), and mixed precision breaks GSI2's lexicographic==chronological invariant *within a second* (`"…00.5Z" < "…00Z"` lexically). All persisted instants and the due-query `:now` are `truncatedTo(SECONDS)` → fixed-width, matching the 5.1 seeds and shell `date -u`. Related invariant: the UpdateExpression reuses the same `:next` value for `nextReviewAt` AND `GSI2SK` — the index key cannot drift from the attribute.

**Architecture:** thin `VocabRepository` interface (loadProgress/saveReview/queryDue) as the test seam. `DynamoDbVocabRepository` is marshalling-only (paginated GSI2 query, `BigDecimal.toPlainString()` for the N value, `#t/#d` name indirection for term/definition) and is proven live by the verify script — no dynamodb-local in this toolchain. All routing/JSON/error/SM-2-integration logic tested through `Handler`+`VocabService` against `InMemoryVocabRepository` (mirrors GSI2's ISO-string-compare semantics) with a fixed `Clock`. Missing sub claim → 401 (authorizer guarantees it in prod; 401 signals misconfiguration where 500 would mislabel). Table name via `TABLE_NAME` env default `LyraLearnTable` — python precedent (`lambda/api/handler.py`), no terraform `environment` block needed.

**Deps:** AWS SDK v2 2.25.70 `dynamodb` + `url-connection-client` (netty/apache excluded — jar 7.6MB, cold start comfortably inside the 10s timeout on first live invoke); Gson 2.11.0 used WITHOUT reflection (`JsonObject`/`JsonParser` only — shade-safe, explicit type validation of quality incl. the 4.5-is-not-an-integer case). Shade filters added for `module-info.class` + signature files. Known accepted risk: hand-seeded items missing §6.1 attributes would NPE→500 in `loadProgress`; only writers are this Lambda + verify scripts.

**Suite:** 31 in-container (15 SM-2 + 16 handler; the plan's estimate said 30 — miscounted the handler list), `Tests run: 31, Failures: 0`.

**Done-when gate (`scripts/verify_5_3.sh`, run 2026-07-31 against the live API, first-try PASS):**
```
seed: past-due verify53-item written
due before review: 200, contains verify53-item
review: 200, nextReviewAt=2026-08-02T00:35:38Z (future), reps 0->1, interval 1
due after review: verify53-item no longer due
item attrs: repetitions=1
item attrs: lastReviewedAt=2026-08-01T00:35:38Z
item attrs: GSI2SK == nextReviewAt
unknown item, no term: 404 OK
create-on-review: 200 created
create-on-review: item persisted (term=dor, reps=1)
create-on-review: not in today's due list (due tomorrow)
quality 7: 400 OK
no token: 401 OK
PASS - Phase 5.3 done-when met.
```
(All items trap-cleaned. The script's `[[ "$NEXT" > "$NOW" ]]` string comparison is sound ONLY because of the fixed-width truncation above.)

**Verdict:** Phase 5.3 done — both /vocab endpoints live against DynamoDB; a review event updates `nextReviewAt` and `/vocab/due` reflects it immediately. Next: 5.4 — quiz generation from processed lyrics.

## 5.4 — Quiz generation

**Date:** 2026-07-31
**Spec situation:** the §10 one-liner was the entire spec — no endpoint, no quiz format, no vocab→song link existed anywhere. This phase defined the contract. The spec's §5.4 storage note anticipated exactly the fallback used here ("find songs containing vocab word X" — no index added yet at M0 scale; future work: `lines.words.text` index + exact-match pushdown, noting whisper word text carries punctuation/casing so `Filters.eq` would be unreliable anyway).

**Contract (new `GET /vocab/quiz`, JWT):** cloze questions from the user's DUE items (reuses `queryDue`, most-overdue first, cap `MAX_QUESTIONS=20`). Question: `{vocabId, term, definition, hasContext, songId, lineNumber, prompt, translation}` — the four context fields are **explicit JSON nulls** when `hasContext:false` (Gson `addProperty` with null stores `JsonNull`; stable shape for 5.5, which can still quiz on term/definition). Blank token `____`; **every** occurrence in the line is blanked (a single blank would leak the answer elsewhere in the line — pinned by the "Inima, inima" test).

**Vocab→song link:** `POST /vocab/review` body gained optional `songId`, persisted write-when-non-null / preserved-on-update like term/definition; GSI2 projects ALL so it propagates into `/vocab/due` (which now emits `songId`, null-explicit) and the quiz with zero index changes.

**Matching rules (Cloze.java, unit-pinned):** case-insensitive whole-word via `CASE_INSENSITIVE|UNICODE_CASE` with letter/digit lookarounds `(?<![\p{L}\p{N}]) … (?![\p{L}\p{N}])` — NOT `\b`, which treats ă/ș/ț as non-word. **No diacritic folding** ("inima" ≠ "inimă"): terms come from lyrics verbatim via 5.5. Accepted caveat: legacy cedilla Ş (U+015E) doesn't case-fold to comma-below Ș (U+0218). Term is `Pattern.quote`d (regex metacharacters literal).

**Prefilter/matcher split (load-bearing):** the Mongo query is only a case-insensitive SUBSTRING regex prefilter on `lines.originalText` (escaped to a PCRE literal, limit 5 docs) — word-boundary semantics live exclusively in Java because server-side PCRE `\b` is not Unicode-aware. The prefilter can false-positive ("in" ⊂ "inima" — pinned test proves the word-matcher rejects it) but cannot false-negative. Resolution order: linked songId doc → cross-song fallback → `hasContext:false`.

**Architecture/deps:** `LyricsRepository` seam (`findBySongId`, `findByTermSubstring` → raw `SongLyrics/LyricLine` records) + `QuizService` separate from `VocabService` so the SM-2 path never grows a Mongo dependency. `MongoLyricsRepository`: Document API only (no POJO codecs = no reflection, shade-safe), **lazy** client (first quiz call — review/due cold starts unchanged), secret via `MONGODB_SECRET_ARN` → Secrets Manager (SDK v2 `secretsmanager` artifact, url-connection), same knobs as the python api Lambda (5s selection/connect, pool 5). Driver `mongodb-driver-sync:5.1.4`; shade gained `ServicesResourceTransformer` (driver SPI descriptors; deterministic, reproducible-hash preserved). Logging: no slf4j shipped → driver falls back to JUL (contingency if `NoClassDefFoundError: org/slf4j/...` ever appears: add slf4j-api + slf4j-nop). Jar 7.6→11.2MB.

**Terraform (applied 2026-07-31, exactly `1 to add, 2 to change, 0 to destroy`):** route `GET /vocab/quiz`; learning policy + `ReadMongoSecretOnly` (copy of the api pattern, `lyralearn/mongodb-*`); learning function: jar hash, `timeout 10→15` (cold quiz = JVM start + secret fetch + Atlas SRV/TLS + query stacked — 10s was sized for DynamoDB-only), `environment { MONGODB_SECRET_ARN }`.

**Suite:** 51 in-container (15 SM-2 + 30 handler + 6 Cloze; the plan estimated 50 — it listed 11 quiz tests as "10"), `Tests run: 51, Failures: 0`.

**Done-when gate (`scripts/verify_5_4.sh`, run 2026-07-31, first-try PASS):** extracts a real word + line from `test-song-001` via an independent pymongo read, seeds a linked past-due item, and byte-compares the quiz output:
```
context source: term='iatit' from test-song-001
quiz: 200
OK   hasContext true / songId matches / lineNumber matches Atlas line
OK   prompt contains ____ / prompt == real line with term blanked / not the unblanked original
OK   translation == real line translation
OK   nonsense term (zzzqqx): hasContext false, prompt null
review songId: persisted on create
no token: 401 OK
PASS - Phase 5.4 done-when met.
```
(Term `iatit` is a whisper transcription artifact in the test song — but that's the point: it's REAL processed-lyrics context, not placeholder text. Warm quiz calls returned well inside the old 10s budget; the 15s timeout is cold-start insurance.)

**Verdict:** Phase 5.4 done — quiz questions reference real lyric context from an actual processed song. Next: 5.5 — frontend integration (vocab review UI + due-today list wired into the Phase 4 player; done-when: full loop — play a song, encounter vocab, review it later, see it scheduled correctly).

## 5.5 — Frontend integration

**Date:** 2026-07-31 · **Zero terraform, no USER apply** — pure frontend + one CloudFront deploy. **PHASE 5 COMPLETE.**

**What shipped (`frontend/src/vocab/` + wiring):** clickable lyric words (encounter), Shell Listen/Review nav with due-count badge, ReviewPanel (due-today list + cloze quiz session), all against the 5.3/5.4 endpoints.

**Decisions:**
- **Encounter = click a word**, `quality: 0` — SM-2 failure branch (interval 1, reps 0, EF untouched) = clean "new word, due tomorrow" semantics. `vocabId = term.toLowerCase()` (stable identity — re-encounters re-schedule, never duplicate; observed live: clicking "iubirea" also marked the capitalized "Iubirea" elsewhere in the lyrics as saved). `definition = line.translatedText ?? ''` (best available — no per-word translations). `songId = doc.songId` — on the linked path that IS the original song, so quiz context resolves (proven live: item carried `songId=a4f5e4ace189`).
- Words render as native `<button type="button">` ONLY when `onWordClick` is passed (span fallback keeps all pre-5.5 LyricsPanel tests passing unchanged); punctuation-only tokens stay spans; CSS resets UA chrome so buttons read as words. Repeat click on a saved word is swallowed (double-tap must not reset the schedule with a second quality-0).
- **`useReviewVocab` = the codebase's first `useMutation`** (a review is a single POST — exactly useMutation's shape, unlike useUploadFlow's orchestration), shared by encounters and quiz answers, invalidating `['vocab','due']` on every success (badge/list refresh even on abandoned sessions — observed live: badge cleared without reload).
- **Quiz fetched imperatively** into `useQuizSession` (idle→loading→active→done + empty/error), NOT useQuery: a session is a one-shot snapshot indexed locally; caching would invite mid-session refetches (every answer invalidates vocab queries) for zero reuse.
- **Shell views stay MOUNTED, toggled with `hidden`** — switching to Review must not tear down the upload session or audio (verified: upload form stayed mounted while Review active). Grades Again/Hard/Good/Easy → SM-2 0/3/4/5; after grading, "**Next review: {date}**" from the mutation response + explicit Next/Finish (no auto-advance — test-flaky and steals the evidence).

**Suite:** 92 → **132 frontend tests / 21 files** (`npm test` green, lint clean, build 371KB). Existing test files needed zero changes except App.test.tsx gaining a `getDueVocab` default mock (Shell now mounts useDueVocab).

**API-loop gate (`scripts/verify_5_5.sh`, PASS):** an item created EXACTLY as `buildEncounter` builds it (quality 0, real word `iatit` + line translation + songId from test-song-001 via independent pymongo read) → correctly NOT due today → backdated (both `nextReviewAt` AND `GSI2SK`) → in `/vocab/due` → `/vocab/quiz` cloze prompt byte-equal to the real line → Good(4) → rescheduled out of due → item shows reps=1, GSI2SK == nextReviewAt. (Script bug caught on first run: piping a body into python while ALSO using a heredoc — the heredoc claims stdin; pass JSON as argv like verify_5_4.)

**Browser gate (the done-when, run live 2026-07-31 on https://d38bvqcndpelgt.cloudfront.net as the real user):**
1. Uploaded byte-identical `input_song.mp3` → instant "Ready (matched an existing song)." → played through with full word-synced lyrics (user-confirmed).
2. Clicked "iubirea" (and "Primește") → `POST /vocab/review` 200, green word-saved underline; case-insensitive identity marked "Iubirea" too.
3. Badge correctly dark (due tomorrow) → CLI backdate → reload → **"Review (1)"**, due list "iubirea — And please, my love — Dec 31, 2025".
4. Start review → cloze "**Și te rog, ____ mea**" (the real Atlas line of the linked ORIGINAL) + translation → Show answer → term+definition → **Good** → "**Next review: Aug 1, 2026**" (tomorrow = SM-2 rep 1) → Finish → "Session complete — 1 word reviewed." → "Nothing due. Nice work." + badge cleared, all without reload.
5. DynamoDB: reps=1, interval=1, nextReviewAt==GSI2SK==now+1d, songId=a4f5e4ace189. Test items deleted.
(Note: the mid-play view-switch cross-check was partially covered — the reload for the badge reset the player, but hidden-not-unmounted was verified directly and playback+sync ran the full song before the encounter.)

**Gotcha for the record:** the Chrome extension's file_upload no longer accepts host paths, and page-JS fetch to localhost hangs (PNA/mixed-content) — the user picked the file manually; everything after was automated.

**Verdict: Phase 5.5 done — PHASE 5 COMPLETE.** The full loop works live: play → encounter → review → correctly scheduled. Remaining project-wide: Phase 2.6 (chunked-timing validation) still blocked on the g4dn quota-6 case; §10's remaining phases beyond that.
