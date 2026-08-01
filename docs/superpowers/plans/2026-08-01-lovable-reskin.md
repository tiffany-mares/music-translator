# Cadenza Lovable Design Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Lovable-designed "Cadenza" frontend (brass/sage editorial design, all screens incl. marketing pages) into the production app, make the song library global/public (browse, play, and upload with no account), and add language filtering — while keeping every logic module and the 185-test contract intact.

**Architecture:** Design-port, not an app swap. The Lovable export (`C:\Users\tiffm\Desktop\music-translator\Lyric Harmonizer` — outside the repo, source material only) is a TanStack Start scaffold whose SSR machinery is not load-bearing (zero loaders/server functions); we take its Tailwind 4 theme, screens, and components into `frontend/` and rewire them onto the existing hooks. Backend gains one route (public `GET /songs` listing), loses the JWT authorizer on the listen/upload path (kept on `/vocab/*`), and threads `sourceLanguage` into DynamoDB METADATA.

**Tech Stack:** Existing: React 19 + Vite 8 + Vitest/jsdom (185 tests), npm, oxlint, Python api Lambda, Terraform. Added: `tailwindcss@4` + `@tailwindcss/vite` + `tw-animate-css`, `lucide-react` (icons), Google Fonts (Fraunces, Schibsted Grotesk, Space Grotesk, Spline Sans Mono, Bitter, IBM Plex Mono). NOT adopted: bun, TanStack Start/Router, shadcn `ui/` wholesale, Lovable error-reporting, the RichText 200-term regex.

## Context

The user built a full visual design in Lovable ("Lyric Harmonizer" folder) and wants it integrated. Explorers inventoried both codebases:
- The Lovable app is a design/demo shell — all data is an in-memory mock store; its value is the design system (oklch brass/sage tokens, dark-default + `.light` toggle, editorial typography rules, vinyl player, blueprint textures) and screen layouts (landing w/ essay+FAQ, how-it-works, stack, library grid w/ language filter, upload flow, player, review flashcards, auth).
- Our frontend's 27 test files select by role/label/testid (plus exactly 4 class names), so a re-skin is safe if the semantic contract is preserved.

**User decisions:** (1) port design into our app; (2) scope = EVERYTHING incl. marketing pages; (3) library is GLOBAL — every upload is visible to everyone; (4) songs playable AND uploadable with NO account; (5) library filterable by language.

**Recorded tradeoff (user-accepted):** anonymous upload exposes paid GPU processing to the open internet. Mitigations shipped in-plan: existing 50KB–25MB validation bounds, fingerprint dedup (duplicates auto-link, never re-process — this is also what keeps the global library duplicate-free), Map MaxConcurrency=1, plus new API Gateway throttling on the upload/process routes. CAPTCHA / per-IP quotas recorded as deferred options.

Branch: `lovable-reskin` (from main). Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
Plan-doc step (fold into Task 0): copy this plan to `docs/superpowers/plans/2026-08-01-lovable-reskin.md`.

## Global Constraints

- **Logic files untouched:** `api/client.ts` core fetch shape (extended, not rewritten), `api/types.ts` (extended), `amplifyConfig.ts`, `auth/AuthContext.tsx` + `authErrors.ts`, `ws/*`, `upload/useUploadFlow.ts` + `useJobPolling.ts` + `jobPolling.ts`, `player/useAudioUrls.ts`, `lyrics/wordSync.ts` + `useLyrics.ts` + `useWordSync.ts`, `vocab/encounter.ts` + `useDueVocab.ts` + `useReviewVocab.ts` + `useQuizSession.ts`, `singalong/*`.
- **Test contract preserved** (185 tests keep passing except the deliberate edits enumerated in Task 6): data-testids `player-audio`/`lyrics-panel`/`singalong-note`; form names /upload a song/, /sign in/, /sign up/, /confirm/; groups /audio track/, /how well/; role=status singalong source line; role=alert on every error; button accessible names (Original/Vocals/Instrumental, /sing along/, /start singing/, /start review/, /show answer/, Again/Hard/Good/Easy, Next, Finish, Sign in/out, Try again, Retry processing, Retry, Reload track); labels /title/, /audio file/, /email/, /password/, /code/; `aria-pressed` on nav/stem/sing-along toggles; class names `lyrics-translation`/`word-active`/`word-saved`/`line-active` on the same elements; word tokens `<button>` when saveable else `<span>` with `data-start`/`data-end`; Shell views ALWAYS MOUNTED, toggled via the `hidden` attribute; all test-asserted copy strings verbatim ("Complete — lyrics are ready.", "matched an existing song", "Model ready in … downloaded|loaded from cache (IndexedDB)", "Lyrics loading", quiz/review strings, etc.).
- **No router.** Views switch by state + `hidden`. Deep-linkable URLs = recorded deferred work.
- **Terraform:** plan-check `0 to destroy`; USER runs every apply via `!`. Policy JSONs use `__REGION__`/`__ACCOUNT_ID__`/`__BUCKET__` placeholders.
- Vite config keeps `worker: { format: 'es' }` and the vitest block; Tailwind added as a plugin.
- npm only (no bun). Per-task: `npx vitest run <file>`; gates: `npm test`, `npm run lint`, `npm run build`. Python: `python -m pytest tests/ -q` (mirror existing api-test mocking style).

## File Map

**Backend:** `lambda/api/handler.py` (+`get_songs`, claims-tolerance), `tests/test_api_*.py` (+listing/anon tests), `lambda/translate/handler.py` (+METADATA sourceLanguage UpdateItem), `infra/aws/lambda-api-policy.json` (+Scan), `infra/aws/lambda-translate-policy.json` (+UpdateItem if missing), `terraform/modules/api/main.tf` (route authorizer detach + throttling), `scripts/backfill_source_language.py` (new).

**Frontend new:** `src/styles.css` (Tailwind entry + ported theme; replaces `index.css`), `src/theme/ThemeToggle.tsx` (+test), `src/nav/NavShell.tsx` (sidebar/drawer nav +test), `src/marketing/{Landing,HowItWorks,Stack}.tsx` (+tests), `src/library/{useSongs.ts,LibraryView.tsx,songFilters.ts}` (+tests), `src/assets/` (3 downloaded images), re-skins of the 10 presentational components in place.

## Tasks

### Task 0 — branch, deps, config, assets
- [ ] `git checkout -b lovable-reskin`; copy this plan to `docs/superpowers/plans/2026-08-01-lovable-reskin.md`.
- [ ] `cd frontend && npm install tailwindcss @tailwindcss/vite tw-animate-css lucide-react` (record exact versions).
- [ ] vite.config.ts: add `tailwindcss()` plugin (import from `@tailwindcss/vite`), preserving react plugin, `worker: { format: 'es' }`, and the test block.
- [ ] index.html: Google Fonts preconnect + stylesheet links; title/meta per Lovable `__root.tsx`.
- [ ] Download the 3 Lovable CDN assets (URLs inside `Lyric Harmonizer/src/assets/*.png.asset.json`) into `frontend/src/assets/` (logo, hero watercolor, cover placeholder) + wire favicon. Fallback if CDN unreachable: omit hero image gracefully, keep going.
- [ ] Commit.

### Task 1 — theme foundation + ThemeToggle (TDD)
- [ ] Create `src/styles.css`: `@import "tailwindcss"` + `@import "tw-animate-css"`; port the `:root` oklch variables verbatim from Lovable `src/styles.css` (dark default) + `.light` overrides + `@theme inline` font/color mappings; port ONLY used utilities/keyframes: `paper`, `grain-light/dark`, `field-grid`, `plate`, `corner-ticks`, `sweep-rule`, `hairline`, `band-*`, `label-mono` convention, `reveal`/`will-reveal`, `shimmer`, `vinyl-spin`, `gold-pulse`, `marquee`, `wave-scroll`, `eq-bar`, the global brass hover/focus-visible interaction layer, `prefers-reduced-motion` guards. Import alongside `index.css` during the transition (old classes keep working until each re-skin lands).
- [ ] `src/theme/ThemeToggle.tsx` + test: toggles `.light` on `<html>`, persists `localStorage["cadenza-theme"]`, reads on mount. (Adapted from Lovable `theme-toggle.tsx`; ours defaults dark.)
- [ ] Full suite still green. Commit.

### Task 2 — backend: public global listing `GET /songs` (TDD)
- [ ] Python tests first (mirror existing handler-test style): listing returns METADATA items newest-first with `{songId,title,artist,status,createdAt,sourceLanguage|null}`; excludes `AWAITING_UPLOAD`, `REJECTED`, and `LINKED`; paginates the Scan fully; works with NO auth claims present.
- [ ] Implement `get_songs` in `lambda/api/handler.py`: DynamoDB `Scan` with `FilterExpression SK = :m`, exclude statuses in code, sort by `createdAt` desc. (Recorded revisit trigger: replace Scan with a static-PK GSI when the catalog outgrows it.) Route table entry `GET /songs`.
- [ ] Claims tolerance across public paths: extraction helper returns `{}` when the authorizer context is absent; `post_songs` falls back `uploadedBy="anonymous"`. Verify no other public path dereferences claims.
- [ ] `infra/aws/lambda-api-policy.json`: add `dynamodb:Scan` on the table (Sid `ListSongsScan`).
- [ ] `python -m pytest tests/ -q` green. Commit. (Apply staged in Task 4.)

### Task 3 — backend: anonymous access + throttling (terraform)
- [ ] `terraform/modules/api/main.tf`: remove `authorizer_id`/`authorization_type` from routes `POST /songs`, `GET /songs`, `GET /jobs/{id}`, `GET /songs/{id}/lyrics`, `GET /songs/{id}/audio-urls`, `POST /songs/{id}/process`. KEEP the JWT authorizer on all `/vocab/*` routes. (Rust validate lambda reads no claims; the 6.2 push handler no-ops gracefully for `uploadedBy="anonymous"` — no GSI1 connections exist; anonymous users get job status via the tested polling fallback since WS `$connect` requires a token.)
- [ ] Add stage throttling: modest `default_route_settings { throttling_burst_limit, throttling_rate_limit }` on the HTTP API stage (verify what the existing `aws_apigatewayv2_stage` uses today).
- [ ] `terraform validate` + `terraform plan` — expect adds/changes only, **0 destroy**. Commit.

### Task 4 — backend: sourceLanguage threading + backfill + USER APPLY
- [ ] Verify in `lambda/translate/handler.py` where `sourceLanguage` originates (the transcript's Whisper-detected language) and add a best-effort `UpdateItem` setting `sourceLanguage` (+`targetLanguage`) on `SONG#{songId}/METADATA` after the Mongo write. Add `dynamodb:UpdateItem` to `infra/aws/lambda-translate-policy.json` if absent. Unit-test per existing translate-test style.
- [ ] Rebuild/push translate image via the established deploy script (buildx flags `--provenance=false --sbom=false`).
- [ ] `scripts/backfill_source_language.py` (mirror the 3.5 backfill style): iterate Mongo `lyralearn.lyrics` docs, UpdateItem each `SONG#{songId}/METADATA` with `sourceLanguage`; print matched/updated counts. Run it; verify with a scan count.
- [ ] Stage the combined terraform plan (Tasks 2+3+4 IAM/routes/lambda hashes): **USER runs the apply**. Then live-verify: `curl GET /songs` with NO auth token returns the catalog with languages; `GET /vocab/due` without token still 401s. Commit.

### Task 5 — frontend: api client extension + useSongs (TDD)
- [ ] Extend `api/types.ts` with `SongListing = { songId: string; title: string; artist: string; status: string; createdAt: string; sourceLanguage: string | null }`.
- [ ] Extend `api/client.ts`: `getSongs(): Promise<SongListing[]>`; make the auth header optional for public endpoints when no session exists (signed-in keeps sending it; `/vocab/*` calls always require it). Tests for signed-in and signed-out request shapes.
- [ ] `src/library/useSongs.ts` (React Query) + `src/library/songFilters.ts`: pure `distinctLanguages(list)` + `filterByLanguage(list, lang|null)`. Tests. Commit.

### Task 6 — app restructure: NavShell + optional auth (deliberate test edits enumerated)
- [ ] `App.tsx`: no longer gates on auth — always renders the shell; `AuthPage` becomes the "Sign in" view inside it. `Shell.tsx` rebuilt on `src/nav/NavShell.tsx` (ported from Lovable `nav-bar.tsx`/`app-shell.tsx`): desktop fixed left sidebar, mobile top bar + drawer; nav views: **Home** (landing), **Library**, **Upload**, **Review** (due badge, sign-in-gated), **How it works**, **Stack**; footer: Sign in / user-email + Sign out, ThemeToggle. ALL views stay mounted, `hidden`-toggled.
- [ ] Signed-out behavior: Upload/Library/Player fully work; Review view shows a sign-in prompt; `WordSyncedLyrics` passes `onWordClick` only when signed in (span fallback already tested).
- [ ] **Deliberate test edits (complete list):** `App.test.tsx` — "signed out renders AuthPage" → "signed out renders shell with Sign in nav item"; `Shell.test.tsx` — button name `Listen` → `Upload`, add Library/Home cases, keep hidden-toggle + `aria-pressed` + `Review (2)` badge assertions. No other test files change in this task.
- [ ] Full suite green with those edits. Commit.

### Task 7 — marketing pages: Landing, How it works, Stack
- [ ] Port `src/marketing/Landing.tsx` from Lovable `routes/index.tsx`: hero (watercolor + telemetry lines + brass CTA pills wired to nav view switches), tech marquee, INSPIRATION essay, THE PIPELINE, design-language section, FLOW table (rows switch views), stats band, FAQ, closing CTA. Replace `RichText` regex with explicit brass/sage `<span>`s. Port `use-scroll-reveal` hook + `WaveDivider`/`MusicOrnaments` as needed. Drop Lovable-external links.
- [ ] `HowItWorks.tsx` + `Stack.tsx` from their routes (static content; update stack copy to OUR real stack: Lambda/SageMaker/Step Functions/DynamoDB/Mongo/Go/Rust/Java/CREPE…).
- [ ] Smoke tests: each view renders headline content; FLOW table buttons switch views. Commit.

### Task 8 — Library view (TDD)
- [ ] `src/library/LibraryView.tsx` ported from `library-section.tsx`: responsive card grid (cover placeholder art + vinyl aesthetic, hover sheen, language text on card, status badge for non-ready), plain styled `<select>` language filter ("All languages" + `distinctLanguages`), count line, empty state ("Add your first song" → Upload view). Click a READY song → open embedded `Player` for that `songId` (`jobId={null}`, mirroring UploadPanel's linked-branch invocation; LINKED items are excluded from the listing so no lyrics indirection is needed).
- [ ] Tests: renders fetched songs, filter narrows, empty state, click mounts player (mock `getSongs`/`getAudioUrls`). Commit.

### Task 9 — re-skin auth + upload flow
- [ ] `AuthPage.tsx` re-skin per Lovable `auth.tsx` (card, mono labels, brass accents) — keep the three form aria-labels, field labels, button names, alert roles, copy verbatim. No "Continue with Google" (no such backend).
- [ ] `UploadPanel.tsx` re-skin per Lovable `upload.tsx`: dropzone-style pick + details visuals wired to the REAL `useUploadFlow` (no simulated pipeline); processing state uses the real `JobStatusLine` + vinyl spinner. All asserted names/copy preserved.
- [ ] Suite green (no test edits expected). Commit.

### Task 10 — re-skin player + lyrics
- [ ] `Player.tsx`: vinyl disc (Lovable `vinyl.tsx`, spins while playing — driven by the real `<audio>` element which KEEPS `data-testid="player-audio"` and `controls`), stem picker/sing-along toggle restyled (names + `aria-pressed` unchanged).
- [ ] `LyricsPanel.tsx`/`WordSyncedLyrics.tsx`: Fraunces serif lyrics, brass active-word underline, sage italic translations — same DOM contract (classes, span-vs-button rule, `data-start`/`data-end`, testid `lyrics-panel`).
- [ ] Suite green (no test edits). Commit.

### Task 11 — re-skin review + sing-along
- [ ] `ReviewPanel.tsx` as Lovable flashcards keeping list/quiz semantics, group /how well/, grade names, all asserted copy. Signed-out prompt styled.
- [ ] `SingAlongPanel.tsx` restyled (brass note display, sage cents-good); status line/copy/testid unchanged.
- [ ] Suite green. Commit.

### Task 12 — retire old CSS + full gates
- [ ] Delete `index.css`; grep for stragglers; `npm test` (record exact count), `npm run lint`, `npm run build` (record bundle sizes; crepe worker chunks unchanged).
- [ ] Commit.

### Task 13 — deploy + live gate + records
- [ ] `scripts/deploy_frontend.sh`; browser gate, tab VISIBLE: (a) incognito/signed-out — landing renders, nav works, library lists real songs with language filter, open a song → playback + lyrics + sing-along, upload a fresh ffmpeg-cut clip anonymously → job status via polling → appears in library; (b) signed-in — vocab word-save + review flow + WS push still work; (c) theme toggle both modes; (d) `GET /vocab/due` unauthenticated still 401 (curl).
- [ ] Records: `notes/phase7.md` (new — design integration, public-access decision + abuse mitigations, Scan revisit trigger, no-router deferred, backfill result); CLAUDE.md status paragraph; deferred list (router/deep links, CAPTCHA/IP quotas, static-PK GSI, public WS).
- [ ] Commit; finishing-a-development-branch.

## Verification

- Per task: named vitest/pytest runs; full `npm test` + `npm run lint` at every task end.
- Backend: staged terraform applies run by the USER (`0 to destroy` checked); live curl checks (anon `GET /songs` 200 w/ languages; anon vocab 401).
- Final: the Task 13 browser gate is the done-when — an anonymous visitor can browse the shared library, filter by language, play a song with synced lyrics, and upload a new song that then appears in the library for everyone.
