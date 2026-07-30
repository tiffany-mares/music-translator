#!/usr/bin/env bash
# Phase 3.5 done-when (section 10): POST /songs/{id}/process triggers the
# chunked Step Functions pipeline on cache miss and the direct-link path on
# cache hit - both exercised end to end. Plus the binding MongoDB migration
# evidence: lyrics served from Atlas (X-Lyrics-Source: mongo), independent
# Atlas doc checks (new song AND backfilled test-song-001), live-pipeline
# audioKeys, and the RE-ASSERTED zero-new-executions clause for duplicate +
# malformed uploads. Runtime ~35-50 min (one full run at MAX_CONCURRENCY=1).
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_3_5.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

mint_token() {
  aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
    --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text
}
TOKEN=$(mint_token)

sfn_count() {
  aws stepfunctions list-executions --state-machine-arn "$1" --region "$AWS_REGION" \
    --query "length(executions)" --output text
}
LINEAR_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline"
CHUNKED_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline-chunked"

# Idempotency pre-clean: de-index prior gate runs' fingerprints (guarded at
# dev scale - identical block and reasoning as verify_3_4.sh).
FP_ITEMS=$(aws dynamodb scan --table-name LyraLearnTable --region "$AWS_REGION" \
  --filter-expression "begins_with(GSI3PK, :p)" \
  --expression-attribute-values '{":p":{"S":"FP1#"}}' \
  --projection-expression "PK,SK" --query "Items" --output json)
FP_COUNT=$(echo "$FP_ITEMS" | python -c "import json,sys; print(len(json.load(sys.stdin)))")
if [ "$FP_COUNT" -gt 10 ] && [ "${ALLOW_FP_CLEANUP:-0}" != "1" ]; then
  echo "refusing to de-index $FP_COUNT fingerprints - real data? set ALLOW_FP_CLEANUP=1 to override"
  exit 1
fi
echo "$FP_ITEMS" |
python -c "
import json,subprocess,sys
for it in json.load(sys.stdin):
    subprocess.run(['aws','dynamodb','update-item','--table-name','LyraLearnTable',
        '--region','$AWS_REGION','--key',json.dumps({'PK':it['PK'],'SK':it['SK']}),
        '--update-expression','REMOVE GSI3PK'],check=True)
"

BEFORE_LINEAR=$(sfn_count "$LINEAR_ARN"); BEFORE_CHUNKED=$(sfn_count "$CHUNKED_ARN")

new_song() {
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"title\":\"$1\"}" "$API/songs"
}
field() { python -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }
status_of() {
  aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"SONG#$1\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --query "Item.status.S" --output text
}
attr_of() {
  aws dynamodb get-item --table-name LyraLearnTable --region "$AWS_REGION" \
    --key "{\"PK\":{\"S\":\"SONG#$1\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --query "Item.$2" --output text
}

# --- case 1: genuinely new song -> full chunked pipeline, end to end ---
A=$(new_song "3.5 Wire Full Pipeline")
A_ID=$(echo "$A" | field songId); A_URL=$(echo "$A" | field uploadUrl)
curl -s -X PUT --upload-file test_data/input_song.mp3 "$A_URL"
A_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$A_ID/process")
A_JOB=$(echo "$A_OUT" | field jobId)
case "$A_JOB" in
  "$A_ID".?*) echo "new song: composite jobId minted ($A_JOB)" ;;
  *) echo "new song: jobId FAIL -> $A_OUT"; FAIL=1 ;;
esac
[ "$(sfn_count "$CHUNKED_ARN")" = "$((BEFORE_CHUNKED + 1))" ] \
  && echo "new song: exactly one new chunked execution" \
  || { echo "new song: chunked execution count FAIL"; FAIL=1; }

# Poll the public job route to COMPLETE (~30 min at MAX_CONCURRENCY=1; 50 min cap).
DEADLINE=$(( $(date +%s) + 3000 )); JOB_STATUS=""
while :; do
  J=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/jobs/$A_JOB")
  JOB_STATUS=$(echo "$J" | field status)
  echo "$(date +%T) job: ${JOB_STATUS:-<none>}"
  [ "$JOB_STATUS" = "COMPLETE" ] && break
  [ "$JOB_STATUS" = "FAILED" ] && { echo "job FAILED -> $J"; FAIL=1; break; }
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then echo "job poll TIMEOUT"; FAIL=1; break; fi
  sleep 60
done
TOKEN=$(mint_token)  # ID tokens last 1 h; the poll can consume most of it

if [ "$JOB_STATUS" = "COMPLETE" ]; then
  HDRS=$(mktemp)
  LYR=$(curl -s -D "$HDRS" -H "Authorization: Bearer $TOKEN" "$API/songs/$A_ID/lyrics")
  grep -qi "^x-lyrics-source: *mongo" "$HDRS" \
    && echo "lyrics: served from Mongo (X-Lyrics-Source: mongo)" \
    || { echo "lyrics: NOT served from Mongo"; cat "$HDRS"; FAIL=1; }
  rm -f "$HDRS"
  echo "$LYR" | python -c "
import json,sys
d=json.load(sys.stdin)
assert d['songId']=='$A_ID' and d['targetLanguage']=='en' and d['lines'][0]['words']
" && echo "lyrics: section 6.2 doc, songId linkage correct" \
    || { echo "lyrics: shape/linkage FAIL"; FAIL=1; }

  python scripts/check_mongo_doc.py "$A_ID" \
    && echo "mongo: new song's doc present in Atlas (dual-write)" \
    || { echo "mongo: new doc FAIL"; FAIL=1; }

  V=$(attr_of "$A_ID" audioKeys.M.vocals.S); NV=$(attr_of "$A_ID" audioKeys.M.noVocals.S)
  case "$V" in */vocals.wav) echo "audioKeys: vocals populated by live pipeline" ;;
    *) echo "audioKeys: vocals FAIL ($V)"; FAIL=1 ;; esac
  case "$NV" in */no_vocals.wav) echo "audioKeys: noVocals populated by live pipeline" ;;
    *) echo "audioKeys: noVocals FAIL ($NV)"; FAIL=1 ;; esac

  U=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/songs/$A_ID/audio-urls")
  echo "$U" | python -c "
import json,sys
u=json.load(sys.stdin)['urls']
assert {'raw','vocals','noVocals'} <= set(u) and all('X-Amz-Signature' in v for v in u.values())
" && echo "audio-urls: raw+vocals+noVocals presigned" \
    || { echo "audio-urls: FAIL -> $U"; FAIL=1; }
fi

# backfill evidence: the pre-3.5 seeded song's doc landed in Atlas
python scripts/check_mongo_doc.py test-song-001 \
  && echo "mongo: backfilled test-song-001 present" \
  || { echo "mongo: backfill FAIL"; FAIL=1; }

# GSI3 is eventually consistent - accepted cost-race (notes 3.4/3.5)
sleep 5

# --- case 2: duplicate (64k re-encode) -> LINKED, NO jobId, NO new execution ---
ffmpeg -y -loglevel error -i test_data/input_song.mp3 -c:a libmp3lame -b:a 64k reenc_64k.mp3
B=$(new_song "3.5 Cache Hit")
B_ID=$(echo "$B" | field songId); B_URL=$(echo "$B" | field uploadUrl)
curl -s -X PUT --upload-file reenc_64k.mp3 "$B_URL"; rm -f reenc_64k.mp3
B_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$B_ID/process")
[ "$(echo "$B_OUT" | field linkedSongId)" = "$A_ID" ] \
  && echo "cache hit: linkedSongId == original (songId linkage)" \
  || { echo "cache hit: FAIL -> $B_OUT"; FAIL=1; }
echo "$B_OUT" | python -c "import json,sys; assert 'jobId' not in json.load(sys.stdin)" \
  && echo "cache hit: no jobId (no pipeline)" || { echo "cache hit: jobId leaked FAIL"; FAIL=1; }
[ "$(status_of "$B_ID")" = "LINKED" ] \
  && echo "cache hit: status LINKED" || { echo "cache hit: status FAIL"; FAIL=1; }
case "$(attr_of "$B_ID" audioKeys.M.vocals.S)" in
  */vocals.wav) echo "cache hit: audioKeys copied from original" ;;
  *) echo "cache hit: audioKeys copy FAIL"; FAIL=1 ;;
esac

# --- case 3: malformed upload -> 400/REJECTED, and NO execution ---
BAD=$(new_song "3.5 Garbage Regression")
BAD_ID=$(echo "$BAD" | field songId); BAD_URL=$(echo "$BAD" | field uploadUrl)
python -c "open('bad_upload.bin','wb').write(b'this is definitely not audio ' * 4000)"
curl -s -X PUT --upload-file bad_upload.bin "$BAD_URL"; rm -f bad_upload.bin
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$BAD_ID/process")
[ "$BAD_CODE" = "400" ] && [ "$(status_of "$BAD_ID")" = "REJECTED" ] \
  && echo "garbage upload: rejected 400/REJECTED" || { echo "garbage upload: FAIL"; FAIL=1; }

# --- the RE-ASSERTED measured clause: exactly ONE new chunked execution (the
# --- miss), ZERO from the duplicate + malformed cases, ZERO linear ever.
AFTER_LINEAR=$(sfn_count "$LINEAR_ARN"); AFTER_CHUNKED=$(sfn_count "$CHUNKED_ARN")
[ "$AFTER_LINEAR" = "$BEFORE_LINEAR" ] && [ "$AFTER_CHUNKED" = "$((BEFORE_CHUNKED + 1))" ] \
  && echo "Step Functions: one new chunked (the miss), zero others (linear $BEFORE_LINEAR/$AFTER_LINEAR, chunked $BEFORE_CHUNKED/$AFTER_CHUNKED)" \
  || { echo "Step Functions: EXECUTION COUNT WRONG"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 3.5 done-when met." || echo "FAIL - see lines above."
exit $FAIL
