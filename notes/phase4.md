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
