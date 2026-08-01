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
