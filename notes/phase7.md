# Phase 7 — Lovable "Cadenza" design integration (lovable-reskin)

**Date:** 2026-08-01 · Branch `lovable-reskin` · Plan: docs/superpowers/plans/2026-08-01-lovable-reskin.md

## What this was

The user designed a full frontend in Lovable ("Lyric Harmonizer" export, kept OUTSIDE the repo at Desktop/music-translator/ as source material only). Decisions: (1) port the DESIGN into the production app — not adopt the Lovable scaffold (its TanStack Start SSR machinery carries zero product code: no loaders/server functions, all data was an in-memory mock store); (2) scope = everything incl. marketing pages; (3) the library is GLOBAL and shared; (4) **songs are playable and uploadable with NO account** (user decision, cost tradeoff recorded below); (5) library filterable by language.

## Frontend

- **Theme:** Tailwind 4 (`@tailwindcss/vite`) with the Lovable design system ported into `src/styles.css` — oklch brass/sage/ink tokens, DARK default with `.light` opt-in (ThemeToggle, localStorage `cadenza-theme`), Fraunces/Space Grotesk/Spline Sans Mono type system, blueprint textures (paper/field-grid/grain), corner-ticks/sweep-rule structure, reveal/marquee/vinyl-spin motion (all `prefers-reduced-motion`-guarded). Legacy `index.css` retired; the four test-contract lyric classes (`word-active`/`word-saved`/`line-active`/`lyrics-translation`) plus review/singalong classes are styled in styles.css so the contract DOM stayed byte-identical.
- **Structure:** NO router still — `NavShell` (desktop fixed sidebar / mobile top-bar+drawer, ported from the Lovable nav) switches ALWAYS-MOUNTED hidden-toggled views: Home (full landing: essay/pipeline/flow-table/FAQ), How it works, Library, Upload, Review, Stack, Sign in. **Auth is a view, not a gate** — `App` renders the shell for everyone. Deferred: real router/deep links when URLs matter.
- **Truthful-copy pass on the marketing port:** dropped the Lovable pages' invented C++/pybind11 stack card, "$10/month" claim, "up to 30 minutes", private-songs claim; stats band uses real numbers (5 languages, <1s cache-hit link, 70–110s pipeline target, 200+ tests). Stack page rewritten to the real architecture.
- **Signed-out behavior:** lyric words render as plain spans (the pre-existing tested fallback — `onWordClick` is simply not passed without a session); Review view shows a sign-in prompt; `useDueVocab` gated `enabled: signedIn`; JobSocket never opens (token required at $connect) so anonymous job status rides the tested polling fallback.
- Deliberate test edits (enumerated in commits): App.test (signed-out → shell + Sign in nav item), Shell.test (Listen→Upload, Home default, signed-out cases), AuthPage.test (open the signin view; form queries scoped with `within()` since "Sign in" now names nav item + submit), query-scoping/timeouts in 3 tests (the mounted marketing DOM made unscoped role scans slow in jsdom). **210 tests / 31 files**, lint clean, build: main 447.9 KB, CSS 58.6 KB, tfjs worker chunk untouched (still lazy-isolated).
- lucide-react 1.x dropped brand icons → GitHub/LinkedIn inlined as SVGs. The 3 Lovable CDN assets (logo/hero/cover) downloaded into src/assets (Lovable asset.json pointers resolve against `id-preview--<project>.lovable.app`).

## Backend

- **`GET /songs` (public):** site-wide catalog, paginated DynamoDB Scan filtered to SK=METADATA, excluding AWAITING_UPLOAD/REJECTED/**LINKED** (duplicates never list — 3.4's fingerprint auto-link is what keeps the shared library duplicate-free), newest first, fields songId/title/artist/status/createdAt/sourceLanguage. **Revisit trigger:** replace Scan with a static-PK GSI ("all songs by createdAt") when the catalog outgrows it.
- **Anonymous access:** JWT authorizer REMOVED from POST /songs, GET /songs, GET /jobs/{id}, GET /songs/{id}/lyrics, GET /songs/{id}/audio-urls, POST /songs/{id}/process; KEPT on /vocab/*. Handler tolerates absent claims (`uploadedBy="anonymous"`); validate lambda reads no claims; push handler no-ops for "anonymous" (no GSI1 connections). Frontend sends the bearer only when a session exists (`getOptionalIdToken`).
- **Cost-abuse surface (user-accepted):** anonymous upload can trigger paid GPU processing. Mitigations: 50KB–25MB validation bounds, fingerprint dedup, Map MaxConcurrency=1, NEW API GW stage throttling (rate 10 rps / burst 20). Deferred options: CAPTCHA, per-IP quotas.
- **Language threading:** translate lambda best-effort UpdateItems sourceLanguage/targetLanguage onto SONG#/METADATA after the Mongo write (failure never fails the pipeline); `scripts/backfill_source_language.py` copied language from Mongo docs for pre-existing songs (**live run: 10 backfilled, 1 skipped** — a fixture doc with no METADATA item; ConditionExpression attribute_exists prevents shell creation). Filtering is client-side (catalog is small; server filter param = YAGNI, recorded).

## Live gate (2026-08-01, all measured on CloudFront)

- Anonymous `GET /songs`: 200, 22→23 songs with languages; anonymous `/vocab/due`: **401**; anonymous audio-urls: 200.
- Anonymous browser pass (signed out): landing renders (essay/marquee/FAQ), drawer nav works, Library lists the real catalog ([ 22 SONGS ]), language filter narrows to **[ 11 SONGS ]** for `ro`, opening a song → **playback at t=10.7s with live word-sync ("București!" highlighted)** and 37 words as plain SPANS (no save affordance), sing-along loads **from IndexedDB cache** anonymously, theme toggle light↔dark.
- **Anonymous upload end-to-end:** fresh ffmpeg cut (Trenulețul -ss 60) uploaded with NO session → presigned PUT → validation → "Processing — ChunkAudio" via POLLING (no WS token) → appeared in the public catalog immediately as `d1a8813cbc78` (VALIDATED, newest-first, total 23). (Title field didn't carry in the automation click — cosmetic "Untitled" entry; title threading is unit-covered.) **Pipeline completed live: sourceLanguage=ro landed on the METADATA item via the new translate-lambda threading — the anonymous upload is now a fully-listed, language-filterable, playable catalog entry.**
- Signed-in pass: the same song's 37 words flip from spans to BUTTONS; clicking "parcă" saved it (word-saved styling = server 200 on the authorized vocab route); Review view renders ("Nothing due" — a fresh save schedules +1 day, correct SM-2).

## Catalog hygiene note

The public library currently lists historical verify-run uploads ("6.2 Push Gate" ×2, "Forced Failure Test", "Dedup Original" ×3, etc.). Manual cleanup candidate (delete METADATA items / raw objects for junk songs) — deliberately NOT bulk-deleted during this phase.

## Deferred (recorded)

Router + deep-linkable URLs; CAPTCHA / per-IP upload quotas; static-PK GSI for the catalog; server-side language filter; catalog junk cleanup; truly attributing anonymous uploads (e.g. per-browser pseudo-identity) if the library ever needs moderation.

## Phase 7 follow-ups (2026-08-01, branch phase7-followups)

Closed three of the four recorded deferrals; the fourth stays deferred with its trigger unmet:

1. **Deep links without a router** — `src/nav/urlView.ts` mirrors the Shell's view state to real paths (`/`, `/how-it-works`, `/library`, `/upload`, `/review`, `/stack`, `/signin`, and `/song/{id}` for a selected library song) via pushState/popstate; CloudFront's 4.1 SPA fallback makes every path refreshable (all verified 200 live). LibraryView's selection is now controlled by the Shell so song deep links work. Testing gotcha recorded: jsdom shares `location` across tests in a file — every Shell/App/AuthPage test now resets to `/` in beforeEach, and popstate assertions must wait on VISIBILITY (views are always-mounted, existence is always true). Adopt a real router only if nested routing outgrows this.
2. **Anonymous per-IP daily upload quota** — `POST /songs` (anonymous only; signed-in exempt) increments `RATE#{ip}/DAY#{yyyymmdd}` (TTL'd via new table TTL on `expiresAt`, self-cleans in 2 days) and 429s past ANON_DAILY_UPLOAD_LIMIT=10 with a human-facing message the upload UI surfaces (`friendlyError` maps ApiError body.error). Live-verified: anon POST → 201 + counter item present. CAPTCHA stays deferred (no abuse observed; quota caps the GPU-spend worst case at ~10 pipeline runs/day/IP).
3. **Catalog cleanup (soft-archive)** — new ARCHIVED status hidden by GET /songs; `scripts/archive_songs.py` (reversible: stores previousStatus, `--restore` puts it back; handles status-less malformed shells via if_not_exists). Live run archived 19 test entries ("6.2 Push Gate"×2, "Dedup Original"×4, "Different Song Control"×4, forced-failure/verify/smoke/hydration/playback tests, "3.5 Wire Full Pipeline", "Valid Upload Test", and the malformed songId "s" shell). **Catalog now: 4 songs** (the anon-gate upload, the 6.3/6.4 gate cuts, and the full "Dragostea din tei"). The catalog also now defensively excludes status-less items (code change rides the next api apply).
4. **Static-PK GSI** — still deferred: 4-song catalog, the Scan trigger has not fired.

## Post-Phase-7 feature run (PRs #22–#28, 2026-08-01/02)

Small user-driven features, each self-documented in its PR; recorded here so the notes trail stays complete:

- **#22 Password visibility toggle** — `PasswordField` with Eye/EyeOff show-hide; its aria-label ("Show password") also matches `getByLabelText(/password/i)`, so auth tests scope field queries with `selector: 'input'`.
- **#23 Review collection** — new JWT-protected `GET /vocab` on the Java learning lambda (GSI2 walk, no due bound); when nothing is due the Review view lists the whole collection with "Next:" dates instead of dead-ending.
- **#24 Cadenza motion + shadcn layer + glass auth + Google sign-in** — Recompile-inspired effects (hero typewriter w/ brass caret, NoteDrift canvas — ResizeObserver-sized after a 0×0-mount bug in backgrounded tabs, now-pulse/breathe/hold-bob, all reduced-motion-guarded); shadcn-compatible layer (`@/` alias, `cn()`, `src/components/ui/` with GlassCard/Button/Label/Input verbatim); auth as a FULL-BLEED view (fixed overlay above the nav shell — the watercolor is the page, glass card floats on it, ← Back affordance); **Google federation**: hosted-UI domain `cadenza-503233513399`, OAuth code flow on the app client, the Google IdP created OUT-OF-BAND via CLI so its secret stays out of TF state (`google_idp_enabled` flag flips supported providers), `signInWithRedirect` + Hub listener client-side. Live-verified end-to-end with a real Google account.
- **#25 Placeholders + 8-char minimum** — email `you@learner.music`, password `••••••••`; Cognito `minimum_length` 12→8 (in-place, existing passwords unaffected) with matching hint/error copy.
- **#26 No email verification** — Cognito can't skip confirmation without a trigger, so `lyralearn-autoconfirm` (python3.12 pre-sign-up trigger, pure event transform, logs-only IAM) auto-confirms and marks email verified; signup signs straight in; the confirm form survives only as the `UserNotConfirmedException` legacy fallback. Live-verified: CLI signup → `UserConfirmed: true` instantly, no code email.
- **#27 Learner headers** — sign-in `[ RETURNING LEARNER ] / Welcome back.`, sign-up `[ NEW LEARNER ] / Create your account`.
- **#28 Signup CTA + deep link** — hero "Create an account" pill; new `signup` view at `/signup` opening the glass card in sign-up mode (`AuthPage initialMode`, keyed remount per entry point).

**Testing gotchas recorded along the way:** vitest fork workers fail to start on a memory-starved machine (long sessions: Chrome+Docker) — `--no-file-parallelism` is the reliable fallback, and the suite's `testTimeout` is 20s because the always-mounted marketing DOM makes unscoped jsdom role scans slow; jsdom shares `location` across tests in a file, so every Shell/App/AuthPage test resets to `/` in beforeEach.

**Verify-script hygiene (audit item closed 2026-08-02):** the shared verify-user password is no longer hardcoded — all 14 `scripts/verify_*.sh` now require `TEST_PASSWORD` in the environment (`: "${TEST_PASSWORD:?...}"` fails fast with instructions). Run as: `TEST_PASSWORD=<the shared verify-user password> scripts/verify_X_Y.sh`. The Cognito user is `test@lyralearn.dev`; the password itself lives only in the pool (reset any time with `aws cognito-idp admin-set-user-password`).

**Standing security TODO:** rotate the Google OAuth client secret (it passed through the 2026-08-01 session transcript) — Google console reset + `update-identity-provider`, ideally from the user's own terminal.
