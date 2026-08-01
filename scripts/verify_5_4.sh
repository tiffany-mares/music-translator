#!/usr/bin/env bash
# Phase 5.4 done-when: a generated quiz question references REAL lyric context
# from an actual processed song (test-song-001 in Atlas), not placeholder text.
# Also gates: hasContext=false for a term found in no song, review persists
# songId (5.5's create-on-encounter link shape), 401 without a token.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_5_4.sh
# Mongo read: MONGODB_URI env or the lyralearn/mongodb secret (mongo_uri()).
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
export PYTHONIOENCODING=utf-8
VENV_PY=./lyralearn-env/Scripts/python.exe
SONG=test-song-001
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username test@lyralearn.dev \
  --region "$AWS_REGION" --query "UserAttributes[?Name=='sub'].Value" --output text)
USER_PK="USER#$SUB"

cleanup() {
  for id in verify54-ctx verify54-nectx verify54-new; do
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

# --- 1. pull a REAL word + its first whole-word line straight from Atlas ---
# ASCII-only candidate words ([A-Za-z]{4,}): keeps the term safe through CLI
# JSON on Windows consoles; Unicode matching itself is unit-pinned in-container.
# The boundary regex mirrors Cloze.wordPattern ([^\W_] = Unicode letters+digits).
CTX_JSON=$("$VENV_PY" - "$SONG" <<'PY'
import json, re, sys
sys.path.insert(0, ".")
from scripts.backfill_lyrics_to_mongo import mongo_uri
from pymongo import MongoClient

doc = MongoClient(mongo_uri(), serverSelectionTimeoutMS=10000)["lyralearn"]["lyrics"].find_one(
    {"songId": sys.argv[1]}, {"_id": 0})
assert doc, f"{sys.argv[1]} not in Atlas"
term = next(w for line in doc["lines"]
            for w in re.findall(r"(?<![^\W_])[A-Za-z]{4,}(?![^\W_])", line["originalText"]))
pat = re.compile(r"(?<![^\W_])" + re.escape(term) + r"(?![^\W_])", re.IGNORECASE)
line = next(l for l in doc["lines"] if pat.search(l["originalText"]))
print(json.dumps({
    "songId": sys.argv[1],
    "term": term,
    "lineNumber": line["lineNumber"],
    "original": line["originalText"],
    "prompt": pat.sub("____", line["originalText"]),
    "translation": line["translatedText"],
}, ensure_ascii=False))
PY
)
TERM=$(printf '%s' "$CTX_JSON" | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["term"])')
echo "context source: term='$TERM' from $SONG"

# --- 2. seed a past-due item LINKED to the song + a nonsense-term item ---
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"$USER_PK\"}, \"SK\": {\"S\": \"VOCAB#verify54-ctx\"},
  \"term\": {\"S\": \"$TERM\"}, \"definition\": {\"S\": \"verify54 definition\"},
  \"songId\": {\"S\": \"$SONG\"},
  \"easeFactor\": {\"N\": \"2.5\"}, \"intervalDays\": {\"N\": \"1\"},
  \"repetitions\": {\"N\": \"0\"},
  \"nextReviewAt\": {\"S\": \"2026-01-01T00:00:00Z\"},
  \"lastReviewedAt\": {\"S\": \"2025-12-31T00:00:00Z\"},
  \"GSI2PK\": {\"S\": \"$USER_PK\"}, \"GSI2SK\": {\"S\": \"2026-01-01T00:00:00Z\"}
}"
aws dynamodb put-item --table-name LyraLearnTable --region "$AWS_REGION" --item "{
  \"PK\": {\"S\": \"$USER_PK\"}, \"SK\": {\"S\": \"VOCAB#verify54-nectx\"},
  \"term\": {\"S\": \"zzzqqx\"}, \"definition\": {\"S\": \"nonsense\"},
  \"easeFactor\": {\"N\": \"2.5\"}, \"intervalDays\": {\"N\": \"1\"},
  \"repetitions\": {\"N\": \"0\"},
  \"nextReviewAt\": {\"S\": \"2026-01-02T00:00:00Z\"},
  \"lastReviewedAt\": {\"S\": \"2026-01-01T00:00:00Z\"},
  \"GSI2PK\": {\"S\": \"$USER_PK\"}, \"GSI2SK\": {\"S\": \"2026-01-02T00:00:00Z\"}
}"
echo "seed: verify54-ctx (term=$TERM, songId=$SONG) + verify54-nectx (zzzqqx) written"

# --- 3. GET /vocab/quiz -> 200 ---
req GET /vocab/quiz
[ "$CODE" = "200" ] && echo "quiz: 200" || { echo "quiz: FAIL -> $CODE $BODY"; FAIL=1; }

# --- 4. THE done-when: the ctx question carries the real Atlas lyric line ---
if "$VENV_PY" - "$CTX_JSON" "$BODY" <<'PY'
import json, sys
exp, resp = json.loads(sys.argv[1]), json.loads(sys.argv[2])
qs = {q["vocabId"]: q for q in resp.get("questions", [])}
fail = 0
def check(name, cond, got=None):
    global fail
    print(("OK   " if cond else "FAIL ") + name + ("" if cond or got is None else f" -> {got!r}"))
    if not cond: fail = 1
q = qs.get("verify54-ctx")
check("quiz contains verify54-ctx", q is not None)
if q:
    check("hasContext true", q.get("hasContext") is True, q.get("hasContext"))
    check("songId matches processed song", q.get("songId") == exp["songId"], q.get("songId"))
    check("lineNumber matches Atlas line", q.get("lineNumber") == exp["lineNumber"], q.get("lineNumber"))
    check("prompt contains ____", "____" in (q.get("prompt") or ""), q.get("prompt"))
    check("prompt == real line with term blanked", q.get("prompt") == exp["prompt"], q.get("prompt"))
    check("prompt is not the unblanked original", q.get("prompt") != exp["original"])
    check("translation == real line translation",
          q.get("translation") == exp["translation"] and bool((q.get("translation") or "").strip()),
          q.get("translation"))
n = qs.get("verify54-nectx")
check("quiz contains verify54-nectx", n is not None)
if n:
    check("nonsense term: hasContext false", n.get("hasContext") is False, n.get("hasContext"))
    check("nonsense term: prompt is null", n.get("prompt") is None, n.get("prompt"))
sys.exit(fail)
PY
then echo "quiz content: real lyric context verified"
else echo "quiz content: FAIL"; FAIL=1; fi

# --- 5. review with songId persists the link (5.5 create-on-encounter shape) ---
req POST /vocab/review "{\"vocabId\":\"verify54-new\",\"quality\":5,\"term\":\"dor\",\"definition\":\"longing\",\"songId\":\"$SONG\"}"
[ "$CODE" = "200" ] && [ "$(g verify54-new 'Item.songId.S')" = "$SONG" ] \
  && echo "review songId: persisted on create" \
  || { echo "review songId: FAIL -> $CODE $BODY"; FAIL=1; }

# --- 6. no token -> 401 ---
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/vocab/quiz")
[ "$NOAUTH" = "401" ] && echo "no token: 401 OK" || { echo "no token: FAIL -> $NOAUTH"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 5.4 done-when met." || echo "FAIL - see lines above."
exit $FAIL
