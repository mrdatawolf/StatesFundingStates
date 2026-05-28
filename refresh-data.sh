#!/usr/bin/env bash
# Ingest all data sources for a given fiscal year and rebuild docs/data.json.
# Run this after starting the API to fully refresh the static snapshot.
#
# Usage:
#   ./refresh-data.sh              # defaults to current year - 2 (IRS SOI lags 12-18 months)
#   ./refresh-data.sh 2024
#   API_BASE=http://localhost:4000 ./refresh-data.sh 2024

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
YEAR="${1:-$(( $(date +%Y) - 2 ))}"
API="${API_BASE:-http://localhost:3001}"
DOCS="${SCRIPT_DIR}/docs"

# Load .env from repo root so key checks reflect what the API server was given
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# ── Key requirement descriptions ────────────────────────────────────────────────
missing_census_key() {
  echo "   ⚠  CENSUS_API_KEY not set — skipping Census population"
  echo ""
  echo "      To enable:"
  echo "        1. Request a free key at https://api.census.gov/data/key_signup.html"
  echo "           (delivered by email within minutes)"
  echo "        2. Add to .env:  CENSUS_API_KEY=your_key_here"
  echo "        3. Restart the API server and re-run this script"
  echo ""
}

missing_dataverse_key() {
  echo "   ⚠  DATAVERSE_API_KEY not set — skipping MEDSL election data"
  echo ""
  echo "      To enable:"
  echo "        1. Register free at https://dataverse.harvard.edu"
  echo "        2. Go to Account → API Token → Generate Token"
  echo "        3. Add to .env:  DATAVERSE_API_KEY=your_token_here"
  echo "        4. Restart the API server and re-run this script"
  echo ""
}

# ── API check ────────────────────────────────────────────────────────────────────
echo "→ Checking API at $API..."
if ! curl -sf "$API/health" > /dev/null 2>&1; then
  echo ""
  echo "✗  API is not reachable at $API"
  echo "   Start it first:  cd apps/api && pnpm dev"
  echo ""
  exit 1
fi
echo "✓  API is up"
echo "   Fiscal year: $YEAR"
echo ""

# Helper: POST to API, return response body; exit on failure
api_post() {
  local url="$1"; shift
  local resp
  resp=$(curl -s -X POST "$url" "$@")
  if echo "$resp" | grep -q '"statusCode":5'; then
    local msg
    msg=$(echo "$resp" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "✗  API error: ${msg:-unknown}" >&2
    return 1
  fi
  echo "$resp"
}

# ── 1. USASpending (no key required) ─────────────────────────────────────────────
echo "→ [1/5] Fetching USASpending.gov for FY${YEAR}..."
USA=$(api_post "$API/ingest/usa-spending" \
  -H "Content-Type: application/json" \
  -d "{\"fiscalYear\": $YEAR}")
echo "   ✓ Rows written: $(echo "$USA" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)"

# ── 2. IRS Statistics of Income (no key required) ────────────────────────────────
echo "→ [2/5] Downloading IRS Statistics of Income for FY${YEAR}..."
IRS=$(api_post "$API/ingest/irs-soi/scrape?year=${YEAR}")
DOWNLOADED=$(echo "$IRS" | grep -o '"downloaded":[0-9]*' | head -1 | cut -d: -f2)
INGESTED=$(echo "$IRS" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)
echo "   ✓ Downloaded: ${DOWNLOADED:-0} files, ingested: ${INGESTED:-0} rows"

# ── 3. Census Bureau (requires free API key) ──────────────────────────────────────
echo "→ [3/5] Fetching Census Bureau population (2020 decennial)..."
if [ -z "${CENSUS_API_KEY:-}" ]; then
  missing_census_key
else
  CENSUS=$(api_post "$API/ingest/census" \
    -H "Content-Type: application/json" \
    -d '{"censusYear": 2020}')
  echo "   ✓ Rows written: $(echo "$CENSUS" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)"
fi

# ── 4. MEDSL election data (requires free Dataverse API key) ──────────────────────
echo "→ [4/5] Fetching MEDSL presidential voting data..."
if [ -z "${DATAVERSE_API_KEY:-}" ]; then
  missing_dataverse_key
else
  echo "   (downloading from Harvard Dataverse — may take 30–60 s)"
  MEDSL_RESP=$(curl -s --max-time 120 -X POST "$API/ingest/medsl-voting/scrape" 2>&1) || true
  if echo "$MEDSL_RESP" | grep -q 'restart the API server'; then
    echo "   ⚠  Key found in .env but the API server was started before it was added."
    echo "      Restart the API server (Ctrl-C, then: cd apps/api && pnpm dev) and re-run."
    echo ""
  elif echo "$MEDSL_RESP" | grep -q '"statusCode":5'; then
    MSG=$(echo "$MEDSL_RESP" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "   ⚠  API error: ${MSG:-unknown} — voting data skipped"
    echo ""
  else
    ROWS=$(echo "$MEDSL_RESP" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)
    SKIPPED=$(echo "$MEDSL_RESP" | grep -o '"skipped":true' | head -1)
    if [ -n "$SKIPPED" ]; then
      echo "   ✓ Already on disk — skipped download, rows written: ${ROWS:-0}"
    else
      echo "   ✓ Rows written: ${ROWS:-0}"
    fi
  fi
fi

# ── 5. Compute state balances ─────────────────────────────────────────────────────
echo "→ [5/5] Computing state balances for FY${YEAR}..."
COMPUTE=$(api_post "$API/ingest/compute" \
  -H "Content-Type: application/json" \
  -d "{\"fiscalYear\": $YEAR}")
echo "   ✓ States processed: $(echo "$COMPUTE" | grep -o '"statesProcessed":[0-9]*' | cut -d: -f2)"

# ── Build docs/data.json ──────────────────────────────────────────────────────────
echo ""
echo "→ Building docs/data.json..."

YEARS=$(curl -sf "$API/balances/years")
VOTING_YEARS=$(curl -s "$API/voting/years" 2>/dev/null || echo "[]")
# Ensure it's a JSON array — the endpoint returns {} error if no voting data exists yet
case "$VOTING_YEARS" in
  \[*) ;;
  *) VOTING_YEARS="[]" ;;
esac

if [ -z "$YEARS" ] || [ "$YEARS" = "[]" ]; then
  echo "✗  No balance data found after compute — check ingest run logs."
  exit 1
fi

VERSION=$(node -e "process.stdout.write(require('./package.json').version)")

node --input-type=module << EOF
import { writeFileSync } from 'node:fs';

const api         = "${API}";
const years       = ${YEARS};
const votingYears = ${VOTING_YEARS};
const result      = { years, votingYears, version: "${VERSION}", generatedAt: new Date().toISOString() };

for (const y of years) {
  const r = await fetch(\`\${api}/balances?year=\${y}\`);
  if (!r.ok) throw new Error(\`/balances?year=\${y} returned \${r.status}\`);
  result[y] = await r.json();
  console.log(\`   balance \${y}: \${result[y].length} states\`);
}

result.voting = {};
for (const vy of votingYears) {
  const r = await fetch(\`\${api}/voting?year=\${vy}\`);
  if (!r.ok) throw new Error(\`/voting?year=\${vy} returned \${r.status}\`);
  result.voting[vy] = await r.json();
  console.log(\`   voting  \${vy}: \${result.voting[vy].length} states\`);
}

writeFileSync('${DOCS}/data.json', JSON.stringify(result));
EOF

echo ""
echo "✓  docs/data.json updated for FY${YEAR}"
echo ""
echo "   Next steps:"
echo "   1. git add docs/data.json"
echo "   2. git commit -m 'refresh static snapshot FY${YEAR}'"
echo "   3. git push"
echo ""
