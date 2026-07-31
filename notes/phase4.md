# Phase 4 — Frontend

## 4.1 — Scaffold + auth

**Date:** 2026-07-31
**Stack:** React 19 + TypeScript + Vite 8 (create-vite react-ts template, pruned), aws-amplify 6.20 (modular `aws-amplify/auth` imports only), Vitest 4 + @testing-library/react + user-event + jsdom. No router — `App` conditionally renders `loading | AuthPage | Shell` by auth status, and that conditional IS the route guard until 4.2+ needs real routes. All `aws-amplify/auth` calls are confined to `src/auth/AuthContext.tsx`; components consume `useAuth()` — tests mock exactly one module, and 4.2 gets a single place to add an ID-token getter.

**Auth design decisions:**
- Session bootstrap via one `fetchAuthSession()` on mount — the ID-token payload carries `email`, no second call needed. No tokens → signedOut.
- SRP direct-SDK flow against the existing `lyralearn-web` client (`ALLOW_USER_SRP_AUTH`) — no Hosted UI, no callback URLs, zero Cognito Terraform changes.
- `AuthPage` is a `signIn | signUp | confirm` mode state machine with lifted email/password state: the confirm step auto-signs-in with the retained password after `confirmSignUp`; arriving at confirm from an unconfirmed *sign-in* (password also retained from that form) works the same way. An unconfirmed sign-in routes to confirm via both the `CONFIRM_SIGN_UP` nextStep and the thrown `UserNotConfirmedException`.
- Cognito exception names map to user-facing copy in `authErrors.ts`; the pool's user-existence-error prevention folds `UserNotFoundException` into `NotAuthorizedException`, so "Incorrect email or password." deliberately covers both.
- `Amplify.configure` lives in a side-effect module that MUST stay the first import in `main.tsx` (ES module evaluation order is the only guarantee; the failure mode is runtime-only "Auth UserPool not configured" — tests can't catch it because the module is mocked).
- `frontend/.env` (pool id, client id, API URL) is committed on purpose: a Cognito SPA client has no secret; authorization comes from the API's JWT authorizer.

**Tests:** 19 (8 error-mapping, 3 App auth-state, 8 AuthPage behavior — sign-in happy/error/unconfirmed, sign-up happy/duplicate, confirm happy/wrong-code, pending-disable). All green; TDD RED→GREEN per task.

**Terraform (`modules/frontend` + api CORS), single-apply CORS solution:** the api module gained `frontend_origin`, wired at root as `https://${module.frontend.domain_name}` — no cycle (frontend depends on nothing from api), so one apply creates the distribution then updates CORS. `wait_for_deployment = false` on the distribution is load-bearing twice: the domain name is known at creation (no ~15-min Deployed poll), and the whole apply stays inside the ~15-min STS token window. Applied by the user 2026-07-31: 5 added (bucket `lyralearn-frontend-503233513399`, public-access block, OAC, distribution, bucket policy), 2 changed (API CORS; plus a benign api-Lambda `source_code_hash` redeploy from CRLF checkout rewriting `handler.py` — logically identical code), 0 destroyed.

**Edge/browser caching split:** default behavior = Managed-CachingDisabled (index.html + SPA fallback never edge-cached → deploys visible immediately); `/assets/*` = Managed-CachingOptimized. Browser caching set as S3 metadata by `scripts/deploy_frontend.sh`: hashed assets `public,max-age=31536000,immutable` (uploaded first), `index.html` `no-cache` (uploaded last so a new index never references missing assets; no `--delete` so old hashed assets keep serving open tabs).

**OAC gotchas (encoded in comments):** bucket policy `AWS:SourceArn` must be the distribution ARN (not a cycle — resolvable order); grant `s3:GetObject` ONLY — no ListBucket, so missing keys 403 and the `custom_error_response 403→/index.html 200` mapping is the SPA deep-link fallback; a SourceArn-scoped service principal isn't "public" so `block_public_policy` allows it.

**Windows quirks hit live:**
- `MSYS_NO_PATHCONV=1` is required in `deploy_frontend.sh` (CloudFront `--paths "/index.html"` would be mangled to `C:/Program Files/Git/...`) but must NOT be set in `verify_4_1.sh` — it breaks Git Bash's `/dev/null`→`NUL` translation and curl exits 23. Scripts with only-URL "paths" don't need it.
- `npm ci` EPERM on `rolldown-binding...node`: a running Vite dev server holds the native binding open; kill the dev server (which survives its npm wrapper being killed) before `npm ci`.

**Deployed:** https://d38bvqcndpelgt.cloudfront.net (distribution `ENXKD14WMP6C9`, bucket `lyralearn-frontend-503233513399`).

**Gate (`scripts/verify_4_1.sh`, run 2026-07-31):**
```
root: text/html OK
spa-fallback: 200 index.html OK
asset cache-control: immutable OK
CORS https://d38bvqcndpelgt.cloudfront.net: OK
CORS http://localhost:5173: OK
PASS - Phase 4.1 done-when met (scripted half).
```

**Real-user done-when (binding):** exercised twice against live Cognito.
- localhost dev (pre-Terraform sanity): `tiffany.m.mares+cadenza-dev@gmail.com` — sign-up → email code → confirm → auto-sign-in → shell; refresh persisted; sign-out; wrong password → "Incorrect email or password."; sign-in → shell.
- Live CloudFront: `tiffany.m.mares+cadenza@gmail.com` — sign-up on https://d38bvqcndpelgt.cloudfront.net → email code → confirmed → shell showing the email; session persisted across a full Chrome restart; sign-out → sign-in → shell (screenshot captured 2026-07-31). Cognito's default email channel (no SES) delivered both codes to the Gmail inbox via plus-addressing.

**4.2 foreshadow (do not forget):** the HTTP API's JWT authorizer validates **ID tokens** — send `session.tokens.idToken`, never the access token, in `Authorization`.

**Verdict:** Phase 4.1 done — a real user signed up, logged in, and saw the authenticated shell on the deployed CloudFront app. Next: 4.2 upload + job status (POST /songs → process → React Query polling), which needs only the ID-token getter added to AuthContext plus the upload UI.

## 4.2 — Upload + job status

**Date:** 2026-07-31
**Stack additions:** `@tanstack/react-query` v5 (first install; provider in main.tsx with `retry: 1` and `refetchOnWindowFocus: false` globally — a focus refetch would fight the polling backoff). Everything else rides the 4.1 stack.

**Design decisions:**
- `src/api/client.ts` is the typed API layer and the single mock boundary for component tests (fetch-level tests mock `fetch`; everything above mocks the module). Token passed per call — hooks call `useAuth().getIdToken()` immediately before each request, so amplify's `fetchAuthSession` auto-refresh gives token freshness for free (a large-file PUT can outlive short token windows). AuthContext stays the only amplify importer.
- `POST /process` outcomes are a **discriminated union** (`started | linked | rejected | startFailed`), not exceptions — all four are legitimate UI states per the 3.5 contract. `toProcessOutcome(status, body)` narrows on (HTTP status, body shape) and throws `ApiError` for anything off-contract.
- **Polling** (`useJobPolling`): React Query `refetchInterval` callback keyed on `query.state.dataUpdateCount` — `backoffMs = min(2000 * 2^(n-1), 15000)`, §5.1's "2s → 15s cap" verbatim; returns `false` on COMPLETE/FAILED. `refetchIntervalInBackground: true` — added after live observation (below).
- **Upload flow** (`useUploadFlow`) is user-event driven only — no effect ever POSTs, so React 19 StrictMode's double-invoked effects can't double-create songs. PUT failure gets exactly one automatic re-presign; POST /songs mints a NEW songId, and the flow carries the fresh one forward. `retryProcess` re-POSTs process only (the 500 contract's documented recovery) — never re-uploads.
- Client-side precheck mirrors the server bounds (50KB–25MB) and fails fast with zero network calls.

**Two real gaps found by the live run (the reason live done-whens exist):**
1. **S3 CORS was missing on the audio bucket.** Browsers preflight the presigned PUT; every 3.x gate used curl, which never preflights, so the gap was invisible until the first real browser upload (OPTIONS → 403). Fixed: `aws_s3_bucket_cors_configuration` on the audio bucket allowing PUT from the CloudFront domain + localhost:5173 (storage module gained `frontend_origin`, wired at root; user-applied `1 to add, 0 to change, 0 to destroy`).
2. **React Query pauses interval refetching for hidden tabs** (`document.visibilityState === 'hidden'` → no polls). Observed live: job hit COMPLETE while the window was covered and the UI froze on PROCESSING. For a pipeline tracker whose run outlives the user's attention, background polling is the correct behavior → `refetchIntervalInBackground: true`.

**jsdom quirk (test-only):** jsdom marks a `required` file input invalid even with files attached, so clicking submit is silently blocked by constraint validation in tests (real browsers validate correctly — verified live). Tests submit the form directly via `fireEvent.submit`; the `required` attribute stays for real-browser UX.

**Tests:** 40 total (19 from 4.1 + 21 new: 2 getIdToken, 8 API client, 5 polling, 6 UploadPanel flow paths — started/linked/rejected/startFailed-retry/precheck/re-presign).

**Live done-when evidence (2026-07-31):**
- Dev server, real cache-miss run: `smoke_30s.mp3` (481KB, never fingerprinted) uploaded with title "Smoke Test 30s" → UI showed Creating → Uploading → Validating → **Queued… → Processing — ChunkAudio… → Complete — lyrics are ready.** Job `fb5b41e8c62d.5b4d803a4e17`, ~11 min wall (single 30s chunk at quota 1; started ~19:36Z, COMPLETE ~19:47Z). Screenshots captured.
- Deployed CloudFront bundle: re-upload of the same file → instant **"Ready (matched an existing song)"** (LINKED path, no pipeline, `getJob` never called). Screenshot captured.
- `scripts/verify_4_2.sh` PASS: 401 auth guards on all three endpoints, CORS preflight OK for both origins.

**Verdict:** Phase 4.2 done — a real song watched from upload through pipeline completion, reflected in the UI, on both dev and the deployed app. Next: 4.3 player shell (immediate playback via `GET /songs/{id}/audio-urls` — presigned raw/vocals/noVocals URLs are already flowing; note the audio bucket CORS rule currently allows PUT only, and Web-Audio-API use in later phases will need GET added).

## 4.3 — Player shell: immediate playback

**Date:** 2026-07-31
**Stack:** existing only — zero new deps, zero terraform, zero backend changes. Plain `<audio controls>` with NO `crossorigin` attribute: media elements fetch in no-CORS mode, so the audio bucket's PUT-only CORS rule needed no change. Web Audio API (4.4 word-sync sampling / 6.4 pitch) is the point where a GET rule must be added — the standing tripwire.

**Design decisions:**
- **Stem hydration via `pipelineDone` in the queryKey** (`['audioUrls', songId, pipelineDone]`): when the sibling job query (deduped — Player calls `useJobPolling(jobId)` with the same key JobStatusLine observes) transitions to COMPLETE, the key flips once and React Query fetches once; `placeholderData: keepPreviousData` bridges the change. Linked path passes `jobId=null` → `pipelineDone` true from the start → exactly one fetch (linked songs already carry whatever stems they'll ever have). At most 2 fetches per song, no polling, no effects. Deliberate tradeoff: WriteAudioKeys publishes stems ~30-60s before COMPLETE; refetching at COMPLETE sacrifices that sliver for the simplest correct trigger.
- **The sticky-src trap (the phase's real correctness catch):** every audio-urls fetch RE-SIGNS the URLs — the string changes each time. Binding `<audio src>` to query data directly would swap src on the COMPLETE refetch and restart playback mid-song, at the exact moment the pipeline finishes. The Player adopts a URL into local state once per stem selection and never rebinds on data refresh; refetches exist to discover stems, never to refresh the playing URL. Live-validated: playback survived the COMPLETE refetch un-restarted.
- Default stem `raw` — forced, not stylistic: the only stem guaranteed at validation time. Labels: Original / Vocals / Instrumental; buttons render only when >1 stem exists.
- Stem switch preserves `currentTime` and best-effort resumes (`onLoadedMetadata`; autoplay-policy failures swallowed). Live-verified only — jsdom fires no media events.
- `staleTime` 13 min against the 900s presign TTL. **Accepted limitation:** a seek past buffered data after URL expiry fails — 4.5's retry-UX territory.

**Environment findings (worth their own record):**
- **Chrome defers media loading in hidden tabs.** With the browser window covered, the `<audio>` element sat at `readyState 0 / networkState LOADING` indefinitely — `play()` pending, zero bytes fetched — while the same presigned URL curl'd 200/206. The moment the window became visible, loading and playback proceeded. Not an app bug; recorded because it cost real diagnosis time and will bite any future headless/background media testing.
- The guarded GSI3PK de-index was denied by the session's permission layer, so cache-miss test audio came from **cutting different 30s windows of the full test song** (ffmpeg `-ss 60`/`-ss 95`) — acoustically distinct content fingerprints as genuinely new, no shared-table surgery. Reusable trick.
- jsdom console noise: "Not implemented: HTMLMediaElement.prototype.load" — harmless, expected.

**Tests:** 51 total (42 from 4.1/4.2 + getAudioUrls client 2, useAudioUrls 3, Player 4 including the sticky-src regression, UploadPanel wiring 2).

**Live done-when evidence (2026-07-31):**
- Miss run `1f616a6c521b` ("Player Test Mid 30s"): player mounted alongside "Processing — ChunkAudio…" seconds after validation (screenshot); hidden-tab stall documented above; post-COMPLETE, stems hydrated WITHOUT reload and the pipeline-produced `no_vocals.wav` played through the stem picker (user-clicked Instrumental; src `songs/1f616a6c521b/stitched/7d50cc7e15f2/.../no_vocals.wav`).
- **The binding readout** — miss run 2 ("Immediate Playback Test", visible tab): ~12s after clicking Upload, `{currentTime: 3.91, paused: false, duration: 30}` while `jobStatus: "Processing — ChunkAudio…"`; six seconds later `currentTime: 25.3`, still PROCESSING (screenshot: player at 0:25/0:30, pause icon, processing line above). Playback started within seconds of validation, minutes before pipeline completion.
- `scripts/verify_4_3.sh` PASS: raw presigned URL answered a ranged GET with 206 seconds after validation (LINKED variant; the strict during-pipeline assertion is the browser readout above).
- Deployed CloudFront bundle: re-upload → instant "Ready (matched an existing song)" with all three stems and audio playing at 0:02 (screenshot).

**Verdict:** Phase 4.3 done — §5.1's core UX claim holds live: a user is listening seconds after upload while the pipeline runs for minutes, and stems arrive without a reload. Next: 4.4 lyrics hydration (GET /songs/{id}/lyrics client fn + word-timing sync; adding Web Audio requires the bucket CORS GET rule).

## 4.4 — Lyrics hydration

**Date:** 2026-07-31
**Stack:** existing only. New `frontend/src/lyrics/` module: `wordSync.ts` (pure `flattenWords` + `activeWordAt` — the whole logic burden, 13 unit tests incl. a 500-word binary-vs-linear equivalence sweep), `useLyrics`, `useWordSync`, `LyricsPanel`, `WordSyncedLyrics`.

**Design decisions:**
- **Element-clock deviation from §5.1 (deliberate, documented):** sync samples the plain `<audio>` element's `currentTime` on requestAnimationFrame, NOT `AudioContext.currentTime`. An AudioContext is only the playback clock if media routes through it, and routing the current no-CORS media through `MediaElementAudioSourceNode` outputs SILENCE; CORS-mode buys zero functional gain for highlighting. Web Audio + the audio-bucket GET CORS rule land in 6.4 (pitch) where they're needed.
- **Persist-until-next-start highlighting:** a word is active from its `start` until the NEXT word's `start` (Whisper leaves micro-gaps between nearly every word — strict `[start,end)` would strobe); the FINAL word clears at its own `end` (instrumental outro). Live-verified: end-state samples returned expected=-1, actual=-1.
- **`enabled`-gate, not the useAudioUrls key-flip:** lyrics 404 for the entire QUEUED/PROCESSING window and are immutable after — so `pipelineDone` gates `enabled`, key is `['lyrics', songId]`, `staleTime: Infinity`, exactly one fetch. React Query's mount-on-enable gives hydration-without-reload for free when polling flips to COMPLETE.
- **LyricsPanel prop seam:** the active word arrives as a prop; all rAF/clock machinery stays in `useWordSync` (setState only on index CHANGE — steady state is zero re-renders). `useMemo` on `flattenWords` is load-bearing (unstable array would re-run the sync effect every render). Word spans carry `data-start`/`data-end` — the live-gate assertion hook and a future click-to-seek seam.
- **LINKED gap fixed frontend-side:** lyrics are keyed to the ORIGINAL songId and `get_lyrics` never follows `linkedSongId` — the linked flow passes `lyricsSongId={state.linkedSongId}` to Player (audio stays on the new songId). Future hardening: backend link-following.

**Backend bug found and fixed by the gate:** a song with no lyrics doc returned **500, not the contractual 404** — S3 raises `AccessDenied` (not `NoSuchKey`) for missing keys when the role lacks `ListBucket`, and the handler only caught `NoSuchKey`. Latent since 3.2/3.5 (no prior gate probed a lyrics-less song). Fix: catch `ClientError` in the S3 fallback → 404; regression test `test_get_lyrics_s3_access_denied_is_404`; api Lambda redeployed (user-applied `0 add / 1 change / 0 destroy`).

**Environment finding:** rAF pauses in hidden tabs, so the highlight freezes while the window is covered — and snaps to the correct word on the next frame once visible (observed live: two hidden-tab samples showed no highlight, the post-visibility sample matched exactly). This is correct-enough UX: invisible highlights don't need updating.

**Tests:** frontend 82 (51 + 31: client 2, wordSync 13, useLyrics 4, useWordSync 2, LyricsPanel 4, WordSyncedLyrics 2, Player 3, UploadPanel 1); backend 82 (+1 regression). One plan fix during execution: the useWordSync render-count test needed a stable ref object (an inline literal re-ran the effect every render).

**Live done-when evidence (2026-07-31, deployed CloudFront app):**
- Fresh cache-miss upload "Lyrics Hydration Test" (job `b58db52b68ba.8501905c76f8`, ~11 min): during PROCESSING → `lyricsPanel: false`, zero `/lyrics` requests. At COMPLETE → panel appeared with 5 lines / 40 words, `performance.getEntriesByType('navigation').length === 1` (NO reload). Screenshots captured — the test song turns out to be Dragostea din tei, rendered with per-word spans and English translations per line.
- Accuracy assertion (persist-until-next semantics): mid-playback sample t=11.91s → expected 25, actual 25, MATCH; end-state samples (t=30, after final word) → expected -1, actual -1, MATCH ×3.
- Linked path: re-upload → instant "Ready (matched an existing song)" with the ORIGINAL's full lyrics + translations (fetched by linkedSongId), first word highlighted at t=0.
- `scripts/verify_4_4.sh` PASS: 200 + `X-Lyrics-Source: mongo`, 137 words / 2 lines on the 4.3 song with valid ordered timings, no-doc 404 (post-fix).

**Verdict:** Phase 4.4 done — highlighting is accurate and appears without reload the moment processing finishes, on the deployed app. Next: 4.5 loading/error states ("Lyrics loading..." placeholder, failed-job handling, retry affordance; done-when: a deliberately-forced pipeline failure surfaces a real error state).

## 4.5 — Loading/error states

**Date:** 2026-07-31
**Stack:** existing only — zero deps, zero terraform, zero backend.

**Design decisions:**
- **Tri-state `pipelineState: 'running' | 'failed' | 'done'`** replaces WordSyncedLyrics's boolean (a separate `pipelineFailed` flag would allow the impossible `done && failed`). Renders: running → "Lyrics loading…" (§5.1's promised copy, finally shipped); failed → null (JobStatusLine's `role="alert"` owns the failure — no double-alert); done+no-data → placeholder; done+error → "Couldn't load lyrics."; done+data → panel. `useLyrics` keeps its boolean via `=== 'done'`.
- **Try again on FAILED**: UploadPanel's polling branch reads the deduped `['job', jobId]` query (three observers, one fetch) and surfaces the button → the existing `retryProcess` → re-POST /process → fresh jobKey → polling restarts under the new key with fresh backoff. Player stays mounted (4.3: raw playback survives failure).
- **The `setSrc(undefined)` double-adopt trap (design catch):** the obvious reload-track implementation — clear src and let the adoption effect re-adopt — would fire the effect with the STALE cached urls and re-adopt the exact expired URL before the refetch lands. Instead `reloadTrack` awaits `refetch()` and direct-sets the fresh URL (selectStem's pattern); the `res.isSuccess` guard is load-bearing (RQ v5 retains prior data on refetch error — without it we'd re-adopt the stale URL). Covered by a regression test.
- Audio-urls fetch error replaces the previously-eternal "Preparing audio…" with an alert + Retry.

**Forcing recipe (the 2.3 test case, UI-reachable):** `b'ID3' + os.urandom(61*1024)` — passes Rust magic-byte validation as mp3, fails chromaprint (3.4 degrade → VALIDATED, pipeline starts), then ChunkAudio's `sf.read` raises LibsndfileError → Catch → MarkFailed → FAILED in seconds. No SageMaker, no cost.

**Fallout fix:** UploadPanel's new top-level `useJobPolling` requires a QueryClient — `AuthPage.test.tsx` (unchanged since 4.1) still rendered with a bare AuthProvider and its two Shell-reaching tests crashed to an empty body; migrated to `renderWithProviders` + api-client mock.

**Tests:** 92 (82 + 10: WordSyncedLyrics 3 new + 2 edited, Player 5, UploadPanel 2).

**Live done-when evidence (2026-07-31, deployed CloudFront app):**
- `scripts/verify_4_5.sh` PASS: garbage passed validation and started pipeline `b63e270117f5.ae9c69aea527`, FAILED with non-empty error inside the 3-min window, retry minted fresh jobId `…70c04990df6c`.
- Browser: garbage upload → FAILED state screenshot shows the `role="alert"` "Processing failed: LibsndfileError…" (truncated errorInfo incl. stack — verbose; 2.3's "trim to FailureReason later" note still stands), the mounted player with "Audio failed to load — the link may have expired." + **Reload track** (the media-error affordance firing on genuinely undecodable audio — expected side-show), and **Try again**. No silent hang anywhere.
- Retry cycle sampled at 500ms: `processing+lyricsloading` → `FAILED+tryagain` — the fresh run showed "Lyrics loading…" during processing and the affordance restored on re-failure. "Lyrics loading…" correctly absent in both FAILED samples.

**Verdict:** Phase 4.5 done — and with it **PHASE 4 IS COMPLETE**: auth shell (4.1), upload + job status (4.2), immediate playback (4.3), word-synced lyrics (4.4), loading/error states (4.5), all live at https://d38bvqcndpelgt.cloudfront.net with 92 frontend tests. Next: Phase 5 (learning service) or Phase 2.6 (timing validation, still gated on the g4dn quota-6 case).
