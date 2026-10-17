-- One row per account-activity email sent. The unique key makes each send idempotent
-- (Stripe retries, double-clicks, re-runs). Service role only: RLS on, no policies.
create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  dedupe_key text not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, kind, dedupe_key)
);

alter table public.email_log enable row level security;
