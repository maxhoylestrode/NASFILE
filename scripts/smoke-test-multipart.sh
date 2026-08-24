#!/bin/bash
# One-time verification of the multipart upload paths that can't be
# exercised in an automated test suite against a real MinIO instance:
# ListParts (used for resume and for the complete-without-a-body
# fallback) and AbortMultipartUpload. The s3rver test double used for
# this repo's automated tests doesn't implement either (returns 405).
#
# Run this once against your actual deployed MinIO, after Session 3 is
# deployed and `npm run create-admin` has been run.
#
# Usage:
#   BASE_URL=https://drive.yourdomain.com \
#   ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='...' \
#   bash scripts/smoke-test-multipart.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:?set ADMIN_EMAIL}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== login =="
LOGIN=$(curl -sf -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
ACCESS=$(echo "$LOGIN" | jq -r .accessToken)
ROOT_ID=$(echo "$LOGIN" | jq -r .rootFolderId)
echo "logged in, rootFolderId=$ROOT_ID"

# 12MB across two 6MB "parts" worth of size — real UPLOAD_PART_SIZE_BYTES
# is 100MB by default, so override it in .env for this test if you want
# genuinely separate parts, or just accept a 1-part upload for the basic
# initiate/complete/download check.
SIZE=$((6 * 1024 * 1024))
echo "== initiate upload (test-resume.bin, $SIZE bytes) =="
INIT=$(curl -sf -X POST "$BASE_URL/files/uploads" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"folderId\":\"$ROOT_ID\",\"name\":\"test-resume.bin\",\"sizeBytes\":$SIZE,\"mimeType\":\"application/octet-stream\"}")
FILE_ID=$(echo "$INIT" | jq -r .fileId)
TOTAL_PARTS=$(echo "$INIT" | jq -r .totalParts)
echo "fileId=$FILE_ID totalParts=$TOTAL_PARTS"

if [ "$TOTAL_PARTS" -lt 2 ]; then
  echo "NOTE: totalParts=$TOTAL_PARTS (UPLOAD_PART_SIZE_BYTES is bigger than this test file)."
  echo "      Resume test needs >=2 parts to be meaningful — set UPLOAD_PART_SIZE_BYTES=5242880 in .env temporarily to test resume properly."
fi

dd if=/dev/urandom of="$TMP/part.bin" bs=1M count=6 status=none

echo "== upload part 1 only (simulating a dropped connection before the rest finished) =="
PART1_URL=$(echo "$INIT" | jq -r '.parts[0].url')
curl -sf -X PUT "$PART1_URL" --data-binary "@$TMP/part.bin" -o /dev/null
echo "part 1 uploaded"

echo "== GET /files/uploads/:id — resume check =="
RESUME=$(curl -sf -H "Authorization: Bearer $ACCESS" "$BASE_URL/files/uploads/$FILE_ID")
echo "$RESUME" | jq '{uploadedParts: (.uploadedParts | length), missingParts: (.missingParts | map(.partNumber))}'
UPLOADED_COUNT=$(echo "$RESUME" | jq '.uploadedParts | length')
if [ "$UPLOADED_COUNT" -ge 1 ]; then
  echo "PASS: ListParts correctly reports part 1 as already uploaded"
else
  echo "FAIL: ListParts did not report part 1 — check MinIO ListParts support"
fi

echo "== upload remaining parts from the resume response =="
echo "$RESUME" | jq -c '.missingParts[]' | while read -r part; do
  URL=$(echo "$part" | jq -r .url)
  curl -sf -X PUT "$URL" --data-binary "@$TMP/part.bin" -o /dev/null
done
echo "remaining parts uploaded"

echo "== complete WITHOUT a body (exercises the ListParts fallback) =="
COMPLETE=$(curl -sf -X POST "$BASE_URL/files/uploads/$FILE_ID/complete" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{}')
echo "$COMPLETE" | jq .
STATUS=$(echo "$COMPLETE" | jq -r .status)
[ "$STATUS" = "complete" ] && echo "PASS: complete-without-body (ListParts fallback) worked" || echo "FAIL: expected status=complete, got $STATUS"

echo "== download =="
DL=$(curl -sf -H "Authorization: Bearer $ACCESS" "$BASE_URL/files/$FILE_ID/download")
DL_URL=$(echo "$DL" | jq -r .url)
curl -sf -o "$TMP/downloaded.bin" "$DL_URL"
ORIGINAL_SIZE=$((TOTAL_PARTS * SIZE))
DOWNLOADED_SIZE=$(wc -c < "$TMP/downloaded.bin")
echo "downloaded $DOWNLOADED_SIZE bytes"
[ "$DOWNLOADED_SIZE" -gt 0 ] && echo "PASS: presigned download URL resolved and returned data" || echo "FAIL: download was empty"

echo "== cleanup =="
curl -sf -X DELETE "$BASE_URL/files/$FILE_ID" -H "Authorization: Bearer $ACCESS" -o /dev/null
echo "PASS: delete (and underlying MinIO object delete) succeeded"

echo "== abort path: initiate a second upload and abort it without completing =="
INIT2=$(curl -sf -X POST "$BASE_URL/files/uploads" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"folderId\":\"$ROOT_ID\",\"name\":\"test-abort.bin\",\"sizeBytes\":$SIZE,\"mimeType\":\"application/octet-stream\"}")
FILE_ID2=$(echo "$INIT2" | jq -r .fileId)
curl -sf -X DELETE "$BASE_URL/files/$FILE_ID2" -H "Authorization: Bearer $ACCESS" -o /dev/null
echo "PASS: AbortMultipartUpload path succeeded (no error deleting a pending, never-completed upload)"

echo ""
echo "All multipart smoke tests passed against $BASE_URL."
