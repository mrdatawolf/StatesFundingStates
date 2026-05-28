#!/usr/bin/env bash
# Ingest all data sources for a given fiscal year and rebuild docs/data.json.
# Run this after starting the API to fully refresh the static snapshot.
#
# Usage:
#   ./refresh-data.sh              # defaults to current year - 2 (IRS SOI lags 12-18 months)
#   ./refresh-data.sh 2024
#   API_BASE=http://localhost:4000 ./refresh-data.sh 2024

set -euo pipefail

YEAR="${1:-$(( $(date +%Y) - 2 ))}"
API="${API_BASE:-http://localhost:3001}"
DOCS="$(cd "$(dirname "$0")" && pwd)/docs"

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

# 1. USASpending federal outlays
echo "→ [1/5] Fetching USASpending.gov for FY${YEAR}..."
USA=$(curl -sf -X POST "$API/ingest/usa-spending" \
  -H "Content-Type: application/json" \
  -d "{\"fiscalYear\": $YEAR}")
echo "   ✓ Rows written: $(echo "$USA" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)"

# 2. IRS Statistics of Income (auto-download all 51 state files)
echo "→ [2/5] Downloading IRS Statistics of Income for FY${YEAR}..."
IRS=$(curl -sf -X POST "$API/ingest/irs-soi/scrape?year=${YEAR}")
echo "   ✓ Downloaded: $(echo "$IRS" | grep -o '"downloaded":[0-9]*' | head -1 | cut -d: -f2) files"

# 3. Census Bureau population (2020 decennial — only changes every 10 years)
echo "→ [3/5] Fetching Census Bureau population (2020 decennial)..."
CENSUS=$(curl -sf -X POST "$API/ingest/census" \
  -H "Content-Type: application/json" \
  -d '{"censusYear": 2020}')
echo "   ✓ Rows written: $(echo "$CENSUS" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)"

# 4. MEDSL presidential election data (covers all election years; skipped if already on disk)
echo "→ [4/5] Fetching MEDSL presidential voting data..."
MEDSL=$(curl -sf -X POST "$API/ingest/medsl-voting/scrape")
echo "   ✓ Rows written: $(echo "$MEDSL" | grep -o '"rowsWritten":[0-9]*' | cut -d: -f2)"

# 5. Compute state balances
echo "→ [5/5] Computing state balances for FY${YEAR}..."
COMPUTE=$(curl -sf -X POST "$API/ingest/compute" \
  -H "Content-Type: application/json" \
  -d "{\"fiscalYear\": $YEAR}")
echo "   ✓ States processed: $(echo "$COMPUTE" | grep -o '"statesProcessed":[0-9]*' | cut -d: -f2)"

echo ""
echo "→ Building docs/data.json..."

YEARS=$(curl -sf "$API/balances/years")
VOTING_YEARS=$(curl -sf "$API/voting/years" 2>/dev/null || echo "[]")

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
echo "✓  Done — docs/data.json updated for FY${YEAR}"
echo ""
echo "   Next steps:"
echo "   1. git add docs/data.json"
echo "   2. git commit -m 'refresh static snapshot FY${YEAR}'"
echo "   3. git push"
echo ""
