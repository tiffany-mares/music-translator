#!/usr/bin/env bash
# Phase 4.4 API-level restatement of the done-when: a COMPLETE song's lyrics doc
# serves 200 from Mongo with per-word timings fit for binary-searched
# highlighting (start/end numeric, start<=end, non-decreasing across the
# flattened array), and an unknown song 404s (the whole QUEUED/PROCESSING
# window is a 404 by contract). The UI half (hydration without reload +
# accurate highlight tracking) is the live browser gate - notes/phase4.md 4.4.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... [SONG=...] scripts/verify_4_4.sh
# NOTE: no MSYS_NO_PATHCONV here - it breaks Git Bash's /dev/null translation for curl.
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
SONG="${SONG:-1f616a6c521b}" # COMPLETE cache-miss run from 4.3, lyrics live in Atlas
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

BODY=$(mktemp)
HDRS=$(curl -s -D - -o "$BODY" -H "Authorization: Bearer $TOKEN" "$API/songs/$SONG/lyrics")
CODE=$(printf '%s' "$HDRS" | head -1 | awk '{print $2}')
SRC=$(printf '%s' "$HDRS" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-lyrics-source"{print $2}')

if [ "$CODE" = "200" ]; then echo "lyrics fetch: 200 OK"; else echo "lyrics fetch: FAIL ($CODE)"; FAIL=1; fi
case "$SRC" in
  mongo) echo "X-Lyrics-Source: mongo OK" ;;
  s3-fallback) echo "X-Lyrics-Source: s3-fallback - doc missing from Atlas, investigate"; FAIL=1 ;;
  *) echo "X-Lyrics-Source: FAIL (absent)"; FAIL=1 ;;
esac

python - "$BODY" <<'PY' || FAIL=1
import json, sys
doc = json.load(open(sys.argv[1]))
lines = doc["lines"]
assert lines, "no lines"
flat = [(w["start"], w["end"]) for ln in lines for w in ln["words"]]
assert flat, "zero words - highlighting would be inert"
assert all(isinstance(s, (int, float)) and isinstance(e, (int, float)) and s <= e for s, e in flat), \
    "a word has missing/invalid start/end"
assert all(flat[i][0] <= flat[i + 1][0] for i in range(len(flat) - 1)), \
    "flattened starts not non-decreasing (frontend sorts, but the contract regressed)"
translated = sum(1 for ln in lines if ln.get("translatedText"))
print(f"word-timing: {len(flat)} words / {len(lines)} lines, start<=end OK, "
      f"flattened starts non-decreasing OK, {translated}/{len(lines)} lines translated")
PY
rm -f "$BODY"

# The pre-COMPLETE contract restated: no doc -> 404 "lyrics not available".
MISS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$API/songs/000000000000/lyrics")
if [ "$MISS" = "404" ]; then echo "no-doc 404: OK"; else echo "no-doc 404: FAIL ($MISS)"; FAIL=1; fi

[ "$FAIL" = "0" ] && echo "PASS - Phase 4.4 done-when met (API restatement)." || echo "FAIL - see above."
exit $FAIL
