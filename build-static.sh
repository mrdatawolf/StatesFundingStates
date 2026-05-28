#!/usr/bin/env bash
# Fetches current balance data from the running API and writes docs/data.json.
# Run this whenever you want to publish an updated snapshot to GitHub Pages.
#
# Usage:
#   ./build-static.sh              # API at http://localhost:3001 (default)
#   API_BASE=http://localhost:4000 ./build-static.sh

set -euo pipefail

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
echo "→  Fetching available years..."

YEARS=$(curl -sf "$API/balances/years")
VOTING_YEARS=$(curl -sf "$API/voting/years" 2>/dev/null || echo "[]")

if [ -z "$YEARS" ] || [ "$YEARS" = "[]" ]; then
  echo ""
  echo "✗  No balance data found."
  echo "   Use the Admin panel to ingest data and compute balances first."
  echo ""
  exit 1
fi

echo "   Balance years: $YEARS"
echo "   Voting years:  ${VOTING_YEARS}"
echo "→  Building docs/data.json..."

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
echo "✓  docs/data.json updated"
echo ""
echo "   Next steps:"
echo "   1. git add docs/data.json docs/index.html"
echo "   2. git commit -m 'update static snapshot'"
echo "   3. git push"
echo "   4. In GitHub repo settings → Pages → set source to: main branch, /docs folder"
echo ""
