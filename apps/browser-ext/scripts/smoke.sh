#!/usr/bin/env bash
# Live API smoke test (spec §7.4). Hand-runnable: covers /score, /capture,
# /diff, /wiki/recent against a self-hosted Trailhead API with the demo team
# token.
#
# Trailhead has no hosted API — bring one up with `docker compose up` from the
# repo root (see SELFHOSTING.md). Set TRAILHEAD_API_URL to point elsewhere.

set -euo pipefail

DEFAULT_API_URL="http://localhost:3000"
API_URL="${TRAILHEAD_API_URL:-}"
TOKEN="${TRAILHEAD_TEAM_TOKEN:-trailhead_demo_acme_2026}"

if [[ "${1:-}" == "--local" ]]; then
  API_URL="$DEFAULT_API_URL"
fi

if [[ -z "$API_URL" ]]; then
  API_URL="$DEFAULT_API_URL"
  echo "! TRAILHEAD_API_URL not set — defaulting to ${API_URL}" >&2
  echo "  Start a self-hosted API with \`docker compose up\` from the repo root," >&2
  echo "  or export TRAILHEAD_API_URL=<your api base url>." >&2
  echo >&2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "smoke.sh requires curl" >&2
  exit 1
fi

# Fail loudly and early rather than emitting six confusing curl errors.
if ! curl -sSf -o /dev/null --max-time 5 "${API_URL}/teams" 2>/dev/null; then
  echo "! Cannot reach a Trailhead API at ${API_URL}" >&2
  echo "  Start one with \`docker compose up\` (see SELFHOSTING.md), or set" >&2
  echo "  TRAILHEAD_API_URL to the base URL of your server." >&2
  exit 1
fi
JQ="cat"
if command -v jq >/dev/null 2>&1; then
  JQ="jq ."
fi

H_JSON=( -H "Content-Type: application/json" -H "X-Team-Token: ${TOKEN}" )

echo "=== POST /score ==="
curl -sS -X POST "${API_URL}/score" "${H_JSON[@]}" \
  -d '{"prompt":"fix the retry","user_id":"demo"}' | $JQ
echo

echo "=== POST /capture ==="
curl -sS -X POST "${API_URL}/capture" "${H_JSON[@]}" \
  -d '{"surface":"browser","user_prompt":"fix the retry","user_id":"demo"}' | $JQ
echo

echo "=== POST /diff ==="
curl -sS -X POST "${API_URL}/diff" "${H_JSON[@]}" \
  -d '{"user_prompt":"fix the retry","file_path":"src/api/webhooks/handler.ts","user_id":"demo"}' | $JQ
echo

echo "=== POST /improve (next, empty history) ==="
curl -sS -X POST "${API_URL}/improve" "${H_JSON[@]}" \
  -d '{"original_prompt":"fix the retry","missing":{"specificity":"name the file"},"history":[],"command":"next","user_id":"demo"}' | $JQ
echo

echo "=== POST /improve (finalize after one turn) ==="
curl -sS -X POST "${API_URL}/improve" "${H_JSON[@]}" \
  -d '{"original_prompt":"fix the retry","missing":{"specificity":"name the file"},"history":[{"role":"assistant","text":"What file?"},{"role":"user","text":"src/api/webhooks/handler.ts"}],"command":"finalize","user_id":"demo"}' | $JQ
echo

echo "=== GET /wiki/recent ==="
SINCE=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
  || date -u -v-1H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
  || echo "2026-04-25T00:00:00.000Z")
curl -sS -G "${API_URL}/wiki/recent" "${H_JSON[@]}" \
  --data-urlencode "since=${SINCE}" | $JQ
echo

echo "smoke ok"
