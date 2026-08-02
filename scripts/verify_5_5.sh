#!/usr/bin/env bash
# Phase 5.5 done-when (API half of the loop): an item created the way the
# browser's word-click encounter creates it (POST /vocab/review, quality 0,
# term/definition/songId from a REAL processed lyric line) gets SM-2 scheduled,
# backdates into /vocab/due, yields a real-context cloze in /vocab/quiz, and a
# quality-4 answer reschedules it out of the due list. The live browser
# walkthrough recorded in notes/phase5.md 5.5 is the real gate.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_5_5.sh
set -euo pipefail
: "${TEST_PASSWORD:?set TEST_PASSWORD - the shared verify-user password (never hardcoded; see notes/phase7.md)}"
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
export PYTHONIOENCODING=utf-8
VENV_PY=./lyralearn-env/Scripts/python.exe
SONG=test-song-001
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=$TEST_PASSWORD \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username test@lyralearn.dev \
  --region "$AWS_REGION" --query "UserAttributes[?Name=='sub'].Value" --output text)
USER_PK="USER#$SUB"

VID="" # set once the term is extracted; cleanup is a no-op before that
cleanup() {
  [ -n "$VID" ] && aws dynamodb delete-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#$VID\"}}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

req() { # method path [json-body] -> sets CODE, BODY
  if [ $# -ge 3 ]; then
    OUT=$(curl -s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$3" "$API$2")
  else
    OUT=$(curl -s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $TOKEN" "$API$2")
  fi
  CODE=$(echo "$OUT" | tail -1); BODY=$(echo "$OUT" | head -1)
}

g() { # jmespath -> text, for the created item
  aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#$VID\"}}" \
    --query "$1" --output text
}

# --- 1. build the EXACT encounter payload the frontend builds: real word,
#        vocabId = term.lower(), definition = line translation, songId ---
CTX_JSON=$("$VENV_PY" - "$SONG" <<'PY'
import json, re, sys
sys.path.insert(0, ".")
from scripts.backfill_lyrics_to_mongo import mongo_uri
from pymongo import MongoClient

doc = MongoClient(mongo_uri(), serverSelectionTimeoutMS=10000)["lyralearn"]["lyrics"].find_one(
    {"songId": sys.argv[1]}, {"_id": 0})
assert doc, f"{sys.argv[1]} not in Atlas"
# ASCII-only candidates keep the term CLI-safe on Windows consoles (5.4 precedent)
term = next(w for line in doc["lines"]
            for w in re.findall(r"(?<![^\W_])[A-Za-z]{4,}(?![^\W_])", line["originalText"]))
pat = re.compile(r"(?<![^\W_])" + re.escape(term) + r"(?![^\W_])", re.IGNORECASE)
line = next(l for l in doc["lines"] if pat.search(l["originalText"]))
print(json.dumps({
    "term": term,
    "vocabId": term.lower(),
    "prompt": pat.sub("____", line["originalText"]),
    "translation": line["translatedText"],
    "body": {  # what buildEncounter() produces for this word
        "vocabId": term.lower(), "quality": 0, "term": term,
        "definition": line["translatedText"] or "", "songId": sys.argv[1],
    },
}, ensure_ascii=False))
PY
)
jget() { printf '%s' "$CTX_JSON" | "$VENV_PY" -c "import sys,json;print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
VID=$(jget vocabId)
TERM=$(jget term)
ENC_BODY=$(printf '%s' "$CTX_JSON" | "$VENV_PY" -c 'import sys,json;print(json.dumps(json.load(sys.stdin)["body"],ensure_ascii=False))')
echo "encounter payload: term='$TERM' vocabId='$VID' songId=$SONG"
cleanup # start clean in case a previous run died mid-way

# --- 2. encounter: create-on-first-review at quality 0 -> due tomorrow ---
req POST /vocab/review "$ENC_BODY"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | "$VENV_PY" -c \
  'import sys,json;b=json.load(sys.stdin);sys.exit(0 if b["created"] and b["intervalDays"]==1 and b["repetitions"]==0 else 1)'; then
  echo "encounter: 200 created, interval 1, reps 0 (due tomorrow)"
else echo "encounter: FAIL -> $CODE $BODY"; FAIL=1; fi
req GET /vocab/due
printf '%s' "$BODY" | grep -q "\"$VID\"" \
  && { echo "encounter due-today: FAIL (should not be due yet)"; FAIL=1; } \
  || echo "encounter not in today's due list (correct)"

# --- 3. backdate: BOTH nextReviewAt and GSI2SK (the due query reads GSI2SK) ---
aws dynamodb update-item --table-name LyraLearnTable --region "$AWS_REGION" \
  --key "{\"PK\":{\"S\":\"$USER_PK\"},\"SK\":{\"S\":\"VOCAB#$VID\"}}" \
  --update-expression "SET nextReviewAt = :d, GSI2SK = :d" \
  --expression-attribute-values '{":d":{"S":"2026-01-01T00:00:00Z"}}'
echo "backdated to 2026-01-01"

# --- 4. now due, with the term+definition the browser saved ---
req GET /vocab/due
printf '%s' "$BODY" | grep -q "\"$VID\"" \
  && echo "due after backdate: contains $VID" \
  || { echo "due after backdate: FAIL -> $BODY"; FAIL=1; }

# --- 5. quiz question has REAL lyric context (the create path end-to-end) ---
req GET /vocab/quiz
if [ "$CODE" = "200" ] && "$VENV_PY" - "$CTX_JSON" "$BODY" <<'PY'
import sys, json
exp, resp = json.loads(sys.argv[1]), json.loads(sys.argv[2])
q = next((q for q in resp.get("questions", []) if q["vocabId"] == exp["vocabId"]), None)
assert q, "created item missing from quiz"
assert q["hasContext"] is True, f"hasContext: {q['hasContext']}"
assert q["prompt"] == exp["prompt"], f"prompt: {q['prompt']!r} != {exp['prompt']!r}"
assert q["translation"] == exp["translation"]
PY
then echo "quiz: created-via-API item has real lyric context (prompt byte-equal)"
else echo "quiz context: FAIL -> $CODE $BODY"; FAIL=1; fi

# --- 6. answer Good(4): reps 0->1, interval 1 -> due tomorrow, out of due ---
req POST /vocab/review "{\"vocabId\":\"$VID\",\"quality\":4}"
[ "$CODE" = "200" ] && echo "answer: 200 -> nextReviewAt=$(printf '%s' "$BODY" | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["nextReviewAt"])')" \
  || { echo "answer: FAIL -> $CODE $BODY"; FAIL=1; }
req GET /vocab/due
printf '%s' "$BODY" | grep -q "\"$VID\"" \
  && { echo "due after answer: FAIL (still due)"; FAIL=1; } \
  || echo "due after answer: empty of $VID (rescheduled out)"

# --- 7. persisted schedule is coherent ---
[ "$(g 'Item.repetitions.N')" = "1" ] && echo "item: repetitions=1" || { echo "item reps: FAIL"; FAIL=1; }
[ "$(g 'Item.GSI2SK.S')" = "$(g 'Item.nextReviewAt.S')" ] \
  && echo "item: GSI2SK == nextReviewAt" || { echo "item GSI2SK drift: FAIL"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 5.5 API loop verified. Now run the browser gate." \
  || echo "FAIL - see lines above."
exit $FAIL
