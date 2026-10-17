#!/usr/bin/env bash
# Deploys server-side résumé parsing. Run from the repo root: bash scripts/deploy-resume-parsing.sh
set -euo pipefail

REF="yuojrygcrcpajiglbekd"
SB="npx --yes supabase"

echo "→ Checking OPENAI_API_KEY secret…"
if ! $SB secrets list --project-ref "$REF" | grep -q "OPENAI_API_KEY"; then
  echo "OPENAI_API_KEY is not set. Run: $SB secrets set OPENAI_API_KEY=sk-... --project-ref $REF"
  exit 1
fi

echo "→ Deploying process-resume…"
$SB functions deploy process-resume --project-ref "$REF"

echo "→ Redeploying azure-resume-parser (now uses the shared prompt)…"
$SB functions deploy azure-resume-parser --project-ref "$REF"

echo "✓ Done. Upload a résumé and watch the profile card flip to ready."
