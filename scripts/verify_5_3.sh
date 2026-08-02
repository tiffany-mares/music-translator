#!/usr/bin/env bash
# Phase 5.3 done-when: a review event updates nextReviewAt in DynamoDB and
# GET /vocab/due reflects it. Also gates: create-on-first-review, 404 unknown
# item without term, 400 bad quality, 401 no token.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_5_3.sh
set -euo pipefail
: "${TEST_PASSWORD:?set TEST_PASSWORD - the shared verify-user password (never hardcoded; see notes/phase7.md)}"
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=$TEST_PASSWORD \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

# Items must live under the REAL test user's sub - the Lambda derives the PK
# from the JWT, not from anything we can pass in.
SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username test@lyralearn.dev \
  --region "$AWS_REGION" --query "UserAttributes[?Name=='sub'].Value" --output text)
USER_PK="USER#$SUB"

cleanup() {
  for id in verify53-item verify53-new; do
    aws dynamodb delete-item --table-name LyraLearnTable --region "$AWS_REGION" \
      --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#$id\"}}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT
cleanup  # start clean in case a previous run died mid-way

req() { # method path [json-body] -> sets CODE, BODY
  if [ $# -ge 3 ]; then
    OUT=$(curl -s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$3" "$API$2")
  else
    OUT=$(curl -s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $TOKEN" "$API$2")
  fi
  CODE=$(echo "$OUT" | tail -1); BODY=$(echo "$OUT" | head -1)
}

g() { # vocabId jmespath -> text
  aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#$1\"}}" \
    --query "$2" --output text
}

# --- 1. seed one past-due item (full 6.1 shape) under the test user's sub ---
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"$USER_PK\"}, \"SK\": {\"S\": \"VOCAB#verify53-item\"},
  \"term\": {\"S\": \"inima\"}, \"definition\": {\"S\": \"heart\"},
  \"easeFactor\": {\"N\": \"2.5\"}, \"intervalDays\": {\"N\": \"1\"},
  \"repetitions\": {\"N\": \"0\"},
  \"nextReviewAt\": {\"S\": \"2026-07-01T00:00:00Z\"},
  \"lastReviewedAt\": {\"S\": \"2026-06-30T00:00:00Z\"},
  \"GSI2PK\": {\"S\": \"$USER_PK\"}, \"GSI2SK\": {\"S\": \"2026-07-01T00:00:00Z\"}
}"
echo "seed: past-due verify53-item written"

# --- 2. due list shows the seeded item ---
req GET /vocab/due
[ "$CODE" = "200" ] && echo "$BODY" | grep -q '"vocabId":"verify53-item"' \
  && echo "due before review: 200, contains verify53-item" \
  || { echo "due before review: FAIL -> $CODE $BODY"; FAIL=1; }

# --- 3. review it q=5: 200, nextReviewAt in the future (+1d), reps 0->1 ---
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
req POST /vocab/review '{"vocabId":"verify53-item","quality":5}'
NEXT=$(echo "$BODY" | sed -n 's/.*"nextReviewAt":"\([^"]*\)".*/\1/p')
if [ "$CODE" = "200" ] && [ -n "$NEXT" ] && [[ "$NEXT" > "$NOW" ]] \
   && echo "$BODY" | grep -q '"repetitions":1,' \
   && echo "$BODY" | grep -q '"intervalDays":1,'; then
  echo "review: 200, nextReviewAt=$NEXT (future), reps 0->1, interval 1"
else echo "review: FAIL -> $CODE $BODY"; FAIL=1; fi

# --- 4. THE done-when: /vocab/due reflects the update (item gone) ---
req GET /vocab/due
if [ "$CODE" = "200" ] && ! echo "$BODY" | grep -q '"vocabId":"verify53-item"'; then
  echo "due after review: verify53-item no longer due"
else echo "due after review: FAIL -> $CODE $BODY"; FAIL=1; fi

# --- 5. persisted attrs: reps=1, lastReviewedAt set, GSI2SK == nextReviewAt ---
[ "$(g verify53-item 'Item.repetitions.N')" = "1" ] \
  && echo "item attrs: repetitions=1" || { echo "item attrs: repetitions FAIL"; FAIL=1; }
LAST=$(g verify53-item 'Item.lastReviewedAt.S')
[ -n "$LAST" ] && [ "$LAST" != "None" ] && [[ "$LAST" > "2026-06-30T00:00:00Z" ]] \
  && echo "item attrs: lastReviewedAt=$LAST" || { echo "item attrs: lastReviewedAt FAIL -> $LAST"; FAIL=1; }
[ "$(g verify53-item 'Item.GSI2SK.S')" = "$NEXT" ] \
  && echo "item attrs: GSI2SK == nextReviewAt" || { echo "item attrs: GSI2SK FAIL"; FAIL=1; }

# --- 6. unknown vocabId without term -> 404 ---
req POST /vocab/review '{"vocabId":"verify53-ghost","quality":4}'
[ "$CODE" = "404" ] && echo "unknown item, no term: 404 OK" \
  || { echo "unknown item, no term: FAIL -> $CODE $BODY"; FAIL=1; }

# --- 7. unknown vocabId WITH term/definition -> created (due tomorrow, so absent from today's list) ---
req POST /vocab/review '{"vocabId":"verify53-new","quality":5,"term":"dor","definition":"longing"}'
[ "$CODE" = "200" ] && echo "$BODY" | grep -q '"created":true' \
  && echo "create-on-review: 200 created" || { echo "create-on-review: FAIL -> $CODE $BODY"; FAIL=1; }
[ "$(g verify53-new 'Item.term.S')" = "dor" ] && [ "$(g verify53-new 'Item.repetitions.N')" = "1" ] \
  && echo "create-on-review: item persisted (term=dor, reps=1)" \
  || { echo "create-on-review: persistence FAIL"; FAIL=1; }
req GET /vocab/due
! echo "$BODY" | grep -q '"vocabId":"verify53-new"' \
  && echo "create-on-review: not in today's due list (due tomorrow)" \
  || { echo "create-on-review: unexpectedly due today: FAIL"; FAIL=1; }

# --- 8. bad quality -> 400 ---
req POST /vocab/review '{"vocabId":"verify53-item","quality":7}'
[ "$CODE" = "400" ] && echo "quality 7: 400 OK" || { echo "quality 7: FAIL -> $CODE $BODY"; FAIL=1; }

# --- 9. no token -> 401 ---
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/vocab/due")
[ "$NOAUTH" = "401" ] && echo "no token: 401 OK" || { echo "no token: FAIL -> $NOAUTH"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 5.3 done-when met." || echo "FAIL - see lines above."
exit $FAIL
