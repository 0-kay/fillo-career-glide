#!/usr/bin/env bash
# Deploys the functions that send account-activity emails. Run from the repo root.
# Apply supabase/migrations/20261017000100-email-log.sql in the SQL editor FIRST,
# otherwise emails are skipped (the send is claimed in that table).
set -euo pipefail

REF="yuojrygcrcpajiglbekd"
SB="npx --yes supabase"

echo "→ Checking RESEND_API_KEY secret…"
$SB secrets list --project-ref "$REF" | grep -q "RESEND_API_KEY" || { echo "RESEND_API_KEY is not set."; exit 1; }

for fn in process-resume stripe-webhook admin-api; do
  echo "→ Deploying ${fn}..."
  $SB functions deploy "$fn" --project-ref "$REF"
done
echo "✓ Done."
