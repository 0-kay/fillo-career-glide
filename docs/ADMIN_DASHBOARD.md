# Owner / admin dashboard

An internal web app (`/admin`) and API (`admin-api` edge function) for the platform owner to see
usage, control individual users, and administer the platform. Implements
`Fyllo Owner Dashboard and Admin Controls`.

## What is where

| Piece | Location |
|---|---|
| Schema, SQL logic, backfill | `supabase/migrations/20261012000000-admin-dashboard.sql` |
| Admin API (path-routed) | `supabase/functions/admin-api/index.ts` |
| Pure helpers (roles, MFA recency, ranges, CSV) | `supabase/functions/_shared/admin/` |
| Server-side fill enforcement | `entitlement_status()` in the migration; `requireUser(req, { gate })` in `_shared/typesafe/auth.ts` |
| Extension check | `utils.getEntitlement` in `extension/content/utils.js`, used by `engine.js` |
| Admin UI | `src/admin/` (lazy-loaded; end users never download it) |
| Tests | `tests/admin/` (PGlite: runs the real migration and the real edge function) |

## Model

* **A fill** is one completed autofill run, which is what `log_fill_usage` already counted. The
  ledger is unit-agnostic, so switching the unit later changes what is written, not the schema.
* **Balance** is `SUM(fill_ledger.delta)`. `entitlements.balance` is a cache; the `reconcile` job
  (System health, "Re-run reconciliation") verifies and repairs it.
* **Ledger** and **audit log** are append-only (triggers reject UPDATE/DELETE/TRUNCATE) and have no
  FK to `auth.users`, so history survives account deletion.
* **Monthly allowance:** plans with `renewal_period = monthly` get a `PLAN_GRANT` row lazily at the
  first check each UTC month (FREE = 5, BETA = 50). It expires at month end; unspent fills are
  removed by an `EXPIRY` row (FIFO by expiry, so a used-up grant never expires twice).
* **Unlimited plans** (`profiles.plan = 'pro'` from Stripe, or a plan with `limits.unlimited`) are
  never balance-checked; their `USAGE` rows carry `delta = 0` and `units = 1`, so consumption is still
  counted without driving the balance negative.
* **Checks, in order:** revoked, kill switch, suspended, daily cap, no balance.

## Enforcement

* `can_run_fill()`, `log_fill_usage()` and `get_fill_usage()` keep their names and signatures, so the
  **already-shipped extension is enforced without an update**. They now read the ledger.
* `get_my_entitlement()` is the user-facing `GET /entitlement` (`{allowed, status, balance, reason,
  message, ...}`); the new extension code caches it for 60 s and never serves a block from cache.
* The AI and planner endpoints re-check on the server (`gate: "fill"`), and every authenticated
  function rejects a revoked user (`gate: "revoked"`). Stripe checkout/portal and sign-up are
  `gate: "none"` so a revoked paying customer can still cancel.
* Revoke deletes the user's `auth.sessions`, bans the account through the Auth admin API (no new
  tokens), and the extension remembers a `REVOKED` answer so it stops even when the token can no
  longer refresh. An access token already issued stays valid for up to its lifetime (about an hour)
  for direct reads of the user's own rows; fill endpoints reject it immediately.
* The local, rules-only fill path runs in the extension and cannot be enforced server-side. A
  modified extension could skip the client check; it still cannot use the AI/planner endpoints and
  its fills are not counted.
* **Entitlement service down:** the extension and `requireUser` fail open (fills continue and are
  reconciled afterwards); a remembered `REVOKED` stays blocked.

## Admin access

* Separate path (`/admin/login`) with **TOTP MFA required**. The API refuses everything except
  `GET /me` below `aal2`, checks `admin_users` membership and role on **every** request, and
  returns the same 403 for "not an admin" and "disabled".
* Step-up (TOTP verified in the last 5 minutes): delete account, kill switch, admin management.
* Roles: `owner` (all), `admin` (users, bulk, metrics), `viewer` (read-only).
* Optional hardening via function secrets: `ADMIN_IP_ALLOWLIST` (comma-separated IPs),
  `ADMIN_ALLOWED_ORIGINS` (CORS). Bearer-token auth in a header, so CSRF does not apply.
* Admins see counts, plans, statuses, ledger reasons, and application company/role/status. No field
  values, profile contents or URLs; the user-detail RPC does not select them.

## Setup (nothing here is applied or deployed yet)

1. Apply `20261012000000-admin-dashboard.sql` after `20260921120000-add-billing-and-usage.sql`. The
   repo's CLI `db push` fails on dash-named migrations; use the SQL editor as for the previous ones.
   The backfill carries this month's existing usage into the ledger so nobody gets a fresh allowance.
2. Supabase dashboard -> Authentication -> enable **MFA (TOTP)**.
3. Set secret `ADMIN_BOOTSTRAP_OWNER_EMAIL=<your confirmed email>`, deploy `admin-api`, sign in at
   `/admin/login`, enrol the authenticator. The bootstrap only creates the first owner and is a
   no-op once any owner exists. (Or insert the row yourself:
   `insert into admin_users (email, role) values ('you@example.com','owner');`.)
4. Redeploy the functions that changed: `ai-batch-analysis`, `ai-field-analysis`, `ai-match-option`,
   `ai-screening-answer`, `resolve-form-fill`, `report-fill-outcome`, `stripe-checkout`,
   `stripe-portal`, `notify-signup`.
5. Ship the extension build for the nicer blocked-state messages and the revoked memory.
6. Optional: schedule `select public.admin_reconcile_balances();` with pg_cron (it also runs from
   the System page).

## Decisions on the spec's open questions

| # | Decision (v1) |
|---|---|
| 1 | One fill = one completed autofill run (existing meaning). |
| 2 | Free = 5/month, BETA = 50/month as ledger grants; editable under Platform -> Plans. |
| 3 | Users are identified by email (Supabase auth), shown with the user id. |
| 4 | Same Supabase project and auth, but a separate admin allowlist + required MFA + `aal2` check. |
| 5 | Fail open; a revoked state is remembered client-side. |
| 6 | Per-fill cost is not tracked (no cost data is recorded yet). |
| 7 | VIEWER role included. |
| 8 | Grants can expire (`expires_at`); expiry is settled lazily and by the reconcile job. |

## Known gaps

* The tracking spec's tables (Application, PageFill, FieldEvent, UsageDailyRollup) do not exist yet.
  Metrics read the ledger, `profiles`, `applications` (the user-logged tracker) and the shared
  `form_mappings` counters. Applications started/submitted, fields/pages filled, failure rate,
  failure reasons, per-extension-version rates, queue lag and API latency show "n/a" until tracking
  lands. "Delete activity data" removes `fill_usage_events` and `missed_fields` for now.
* Fill/override/miss rates are all-time (the mapping counters are not dated).
* Announcements (v1.5) and impersonation are not built.
* No email/Slack alerts; no automated abuse detection.
