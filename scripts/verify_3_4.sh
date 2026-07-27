#!/usr/bin/env bash
# Phase 3.4 done-when: uploading the same song twice (even re-encoded at a
# different bitrate) links the second upload to the first song's existing
# data instead of running the pipeline again.
# Usage: AWS_REGION=... POOL_ID=... CLIENT_ID=... API=... scripts/verify_3_4.sh
set -euo pipefail
: "${AWS_REGION:?}" "${POOL_ID:?}" "${CLIENT_ID:?}" "${API:?}"
FAIL=0

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@lyralearn.dev,PASSWORD=LyraTest2026Pass \
  --region "$AWS_REGION" --query AuthenticationResult.IdToken --output text)

sfn_count() {
  aws stepfunctions list-executions --state-machine-arn "$1" --region "$AWS_REGION" \
    --query "length(executions)" --output text
}
LINEAR_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline"
CHUNKED_ARN="arn:aws:states:$AWS_REGION:503233513399:stateMachine:lyralearn-pipeline-chunked"

# Idempotency: de-index fingerprints left by prior gate runs (dev table -
# every FP1# entry at this phase is gate residue). Without this, a re-run's
# song A matches its own previous upload and the VALIDATED assertions fail.
aws dynamodb scan --table-name LyraLearnTable --region "$AWS_REGION" \
  --filter-expression "begins_with(GSI3PK, :p)" \
  --expression-attribute-values '{":p":{"S":"FP1#"}}' \
  --projection-expression "PK,SK" --query "Items" --output json |
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

# --- song A: original 128k upload -> VALIDATED with fingerprint attributes ---
A=$(new_song "Dedup Original")
A_ID=$(echo "$A" | field songId); A_URL=$(echo "$A" | field uploadUrl)
curl -s -X PUT --upload-file test_data/input_song.mp3 "$A_URL"
A_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$A_ID/process")
echo "$A_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['valid'] is True and d['format']=='mp3' and 'linkedSongId' not in d" \
  && echo "original: accepted, not linked" || { echo "original: FAIL -> $A_OUT"; FAIL=1; }
[ "$(status_of "$A_ID")" = "VALIDATED" ] \
  && echo "original: status VALIDATED" || { echo "original: status FAIL"; FAIL=1; }
case "$(attr_of "$A_ID" GSI3PK.S)" in
  FP1#*) echo "original: GSI3PK written" ;;
  *) echo "original: GSI3PK FAIL"; FAIL=1 ;;
esac
[ "$(attr_of "$A_ID" fpFull.B)" != "None" ] \
  && echo "original: fpFull stored" || { echo "original: fpFull FAIL"; FAIL=1; }

# GSI3 is eventually consistent - give the index a beat before the dup upload
# relies on it (a real race here just means a missed dedup, not corruption).
sleep 5

# --- song B: SAME song re-encoded at 64k -> THE done-when: LINKED, no pipeline ---
ffmpeg -y -loglevel error -i test_data/input_song.mp3 -c:a libmp3lame -b:a 64k reenc_64k.mp3
B=$(new_song "Dedup Re-encode")
B_ID=$(echo "$B" | field songId); B_URL=$(echo "$B" | field uploadUrl)
curl -s -X PUT --upload-file reenc_64k.mp3 "$B_URL"; rm -f reenc_64k.mp3
B_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$B_ID/process")
B_LINKED=$(echo "$B_OUT" | field linkedSongId)
[ "$B_LINKED" = "$A_ID" ] \
  && echo "re-encoded dup: linkedSongId == original" || { echo "re-encoded dup: FAIL -> $B_OUT"; FAIL=1; }
[ "$(status_of "$B_ID")" = "LINKED" ] \
  && echo "re-encoded dup: status LINKED" || { echo "re-encoded dup: status FAIL"; FAIL=1; }
[ "$(attr_of "$B_ID" GSI3PK.S)" = "None" ] \
  && echo "re-encoded dup: no GSI3PK (index stays canonical)" || { echo "re-encoded dup: GSI3PK present FAIL"; FAIL=1; }

# --- song C: a DIFFERENT song -> must NOT link (false-positive control) ---
C=$(new_song "Different Song Control")
C_ID=$(echo "$C" | field songId); C_URL=$(echo "$C" | field uploadUrl)
# Copy to an ASCII temp name: Windows mingw curl cannot open non-ASCII paths.
cp "test_data/Trenulețul - Zdob și Zdub (128k).mp3" control_song.mp3
curl -s -X PUT --upload-file control_song.mp3 "$C_URL"; rm -f control_song.mp3
C_OUT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$C_ID/process")
echo "$C_OUT" | python -c "import json,sys; d=json.load(sys.stdin); assert d['valid'] is True and 'linkedSongId' not in d" \
  && echo "different song: VALIDATED, not linked" || { echo "different song: FAIL -> $C_OUT"; FAIL=1; }

# --- regression: garbage upload still rejected (3.3 behavior preserved) ---
BAD=$(new_song "Garbage Regression")
BAD_ID=$(echo "$BAD" | field songId); BAD_URL=$(echo "$BAD" | field uploadUrl)
python -c "open('bad_upload.bin','wb').write(b'this is definitely not audio ' * 4000)"
curl -s -X PUT --upload-file bad_upload.bin "$BAD_URL"; rm -f bad_upload.bin
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" "$API/songs/$BAD_ID/process")
[ "$BAD_CODE" = "400" ] && [ "$(status_of "$BAD_ID")" = "REJECTED" ] \
  && echo "garbage upload: still rejected 400/REJECTED" || { echo "garbage upload: regression FAIL"; FAIL=1; }

# --- the measured clause: zero new SFN executions across ALL cases ---
AFTER_LINEAR=$(sfn_count "$LINEAR_ARN"); AFTER_CHUNKED=$(sfn_count "$CHUNKED_ARN")
[ "$BEFORE_LINEAR" = "$AFTER_LINEAR" ] && [ "$BEFORE_CHUNKED" = "$AFTER_CHUNKED" ] \
  && echo "Step Functions: zero new executions (before/after $BEFORE_LINEAR/$AFTER_LINEAR linear, $BEFORE_CHUNKED/$AFTER_CHUNKED chunked)" \
  || { echo "Step Functions: EXECUTION COUNT CHANGED"; FAIL=1; }

[ "$FAIL" = "0" ] && echo "PASS - Phase 3.4 done-when met." || echo "FAIL - see lines above."
exit $FAIL
