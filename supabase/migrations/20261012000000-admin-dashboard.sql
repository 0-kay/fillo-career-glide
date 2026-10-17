-- Owner / admin dashboard: entitlements, fill ledger, admin roles, audit log, plans,
-- feature flags, platform settings, bulk jobs and the SQL behind the admin metrics.
--
-- Depends on 20260921120000-add-billing-and-usage.sql (profiles.plan, fill_usage_events).
--
-- Design notes
--  * The fill ledger is the source of truth for a user's balance. entitlements.balance is a
--    cache that a reconciliation job (admin_reconcile_balances) verifies.
--  * fill_ledger and audit_log are append-only (triggers block UPDATE/DELETE/TRUNCATE) and
--    deliberately have no FK to auth.users, so history survives account deletion.
--  * Every table here has RLS enabled with NO policies and no grants for anon/authenticated.
--    Admin access goes through the admin-api edge function (service role); the extension
--    only talks to the few user-scoped RPCs granted to `authenticated` at the bottom.
--  * Admin state changes are SQL functions so the change and its audit row commit in one
--    transaction.
--  * One "fill" = one completed autofill run (what log_fill_usage already counted). The
--    ledger is unit-agnostic: log_fill_usage takes the number of units to consume.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (name = upper(name) and length(name) between 1 and 32),
  default_fills  integer not null default 0 check (default_fills >= 0),
  renewal_period text not null default 'none' check (renewal_period in ('none', 'monthly')),
  -- {"unlimited": true} makes fills free of balance checks.
  limits         jsonb not null default '{}'::jsonb,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into public.plans (name, default_fills, renewal_period, limits) values
  ('FREE', 5, 'monthly', '{}'),
  ('BETA', 50, 'monthly', '{}'),
  ('PRO', 0, 'none', '{"unlimited": true}'),
  ('CUSTOM', 0, 'none', '{}')
on conflict (name) do nothing;

create table if not exists public.entitlements (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  status                     text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  plan                       text not null default 'FREE' references public.plans(name) on update cascade,
  suspended_until            timestamptz,
  daily_fill_cap             integer check (daily_fill_cap is null or daily_fill_cap >= 0),
  max_applications_per_day   integer check (max_applications_per_day is null or max_applications_per_day >= 0),
  balance                    integer not null default 0,
  updated_at                 timestamptz not null default now()
);

create table if not exists public.fill_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  delta           integer not null,
  source          text not null check (source in
                    ('PLAN_GRANT', 'ADMIN_GRANT', 'ADMIN_REMOVE', 'USAGE', 'REFUND', 'EXPIRY', 'RESET')),
  -- Fills consumed by a USAGE row. delta = -units for metered users, 0 for unlimited plans.
  units           integer not null default 0 check (units >= 0),
  reason          text,
  admin_id        uuid,
  related_id      text,
  idempotency_key text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint fill_ledger_admin_reason check (
    source not in ('ADMIN_GRANT', 'ADMIN_REMOVE', 'RESET') or length(trim(coalesce(reason, ''))) > 0
  )
);

create index if not exists fill_ledger_user_idx on public.fill_ledger (user_id, created_at desc);
create index if not exists fill_ledger_usage_idx on public.fill_ledger (source, created_at);
create unique index if not exists fill_ledger_plan_grant_uniq
  on public.fill_ledger (user_id, related_id) where source = 'PLAN_GRANT';
create unique index if not exists fill_ledger_expiry_uniq
  on public.fill_ledger (user_id, related_id) where source = 'EXPIRY';
create unique index if not exists fill_ledger_idem_uniq
  on public.fill_ledger (user_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  -- null until the invited person signs in with a confirmed email matching `email`
  user_id       uuid unique references auth.users(id) on delete set null,
  email         text not null unique check (email = lower(email)),
  role          text not null check (role in ('owner', 'admin', 'viewer')),
  status        text not null default 'active' check (status in ('active', 'disabled')),
  mfa_enrolled  boolean not null default false,
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid,
  admin_email    text,
  action         text not null,
  target_user_id uuid,
  before         jsonb,
  after          jsonb,
  reason         text,
  ip             text,
  created_at     timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_user_id, created_at desc);
create index if not exists audit_log_admin_idx on public.audit_log (admin_id, created_at desc);

create table if not exists public.feature_flags (
  key             text primary key check (key ~ '^[a-z0-9_.-]{1,64}$'),
  description     text not null default '',
  default_enabled boolean not null default false,
  -- {"users": {"<uuid>": true}, "plans": {"FREE": false}}; user beats plan beats default
  overrides       jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.platform_settings (key, value) values
  ('kill_switch', '{"enabled": false, "message": "Autofill is temporarily paused while we fix an issue. Please try again soon."}'),
  ('tracking_policy', '{"sensitive_field_denylist": ["ssn", "social_security", "password", "passport", "date_of_birth", "bank", "salary"], "retention_days": 365}')
on conflict (key) do nothing;

create table if not exists public.bulk_jobs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null,
  admin_email text,
  action      text not null check (action in ('grant', 'suspend', 'revoke', 'reinstate', 'plan')),
  params      jsonb not null default '{}'::jsonb,
  filter      jsonb not null default '{}'::jsonb,
  reason      text not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total       integer not null default 0,
  succeeded   integer not null default 0,
  failed      integer not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.bulk_job_items (
  job_id  uuid not null references public.bulk_jobs(id) on delete cascade,
  user_id uuid not null,
  status  text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  error   text,
  primary key (job_id, user_id)
);

create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'error')),
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists job_runs_job_idx on public.job_runs (job, started_at desc);

do $$
declare t text;
begin
  foreach t in array array['plans', 'entitlements', 'fill_ledger', 'admin_users', 'audit_log',
                           'feature_flags', 'platform_settings', 'bulk_jobs', 'bulk_job_items', 'job_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

drop trigger if exists fill_ledger_append_only on public.fill_ledger;
create trigger fill_ledger_append_only
  before update or delete on public.fill_ledger
  for each row execute function public.forbid_mutation();
drop trigger if exists fill_ledger_no_truncate on public.fill_ledger;
create trigger fill_ledger_no_truncate
  before truncate on public.fill_ledger
  for each statement execute function public.forbid_mutation();

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Ledger / entitlement internals
-- ---------------------------------------------------------------------------

create or replace function public._lock_user(p_user uuid)
returns void
language sql
as $$ select pg_advisory_xact_lock(hashtextextended('fyllo-entitlement:' || p_user::text, 0)); $$;

create or replace function public._ensure_entitlement(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$ insert into public.entitlements (user_id) values (p_user) on conflict (user_id) do nothing; $$;

create or replace function public._refresh_balance(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare b integer;
begin
  select coalesce(sum(delta), 0)::int into b from public.fill_ledger where user_id = p_user;
  update public.entitlements set balance = b where user_id = p_user and balance is distinct from b;
  return b;
end;
$$;

-- Expires the unspent remainder of grants whose expires_at has passed. Debits are applied
-- to the soonest-expiring open grant at the time they happen (FIFO by expiry), so a grant
-- that was already used up never expires twice. Idempotent: the unique index on
-- (user_id, related_id) for EXPIRY rows is the guard.
create or replace function public._settle_expiry(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  ids uuid[] := '{}';
  exps timestamptz[] := '{}';
  rems integer[] := '{}';
  out_ids uuid[] := '{}';
  out_amounts integer[] := '{}';
  out_times timestamptz[] := '{}';
  i integer;
  j integer;
  need integer;
  take integer;
begin
  if not exists (
    select 1 from public.fill_ledger g
    where g.user_id = p_user and g.delta > 0 and g.expires_at is not null and g.expires_at <= now()
      and not exists (
        select 1 from public.fill_ledger x
        where x.user_id = p_user and x.source = 'EXPIRY' and x.related_id = g.id::text)
  ) then
    return;
  end if;

  for ev in
    select created_at as at, 0 as ord, id, delta, expires_at as exp, 'row' as kind
      from public.fill_ledger where user_id = p_user and source <> 'EXPIRY'
    union all
    select expires_at, 1, id, delta, expires_at, 'expire'
      from public.fill_ledger
      where user_id = p_user and source <> 'EXPIRY' and delta > 0
        and expires_at is not null and expires_at <= now()
    order by 1, 2, 3
  loop
    if ev.kind = 'row' then
      if ev.delta > 0 then
        ids := ids || ev.id;
        exps := exps || coalesce(ev.exp, 'infinity'::timestamptz);
        rems := rems || ev.delta;
      elsif ev.delta < 0 then
        need := -ev.delta;
        while need > 0 loop
          j := null;
          for i in 1 .. coalesce(array_length(ids, 1), 0) loop
            if rems[i] > 0 and (j is null or exps[i] < exps[j]) then j := i; end if;
          end loop;
          exit when j is null;
          take := least(need, rems[j]);
          rems[j] := rems[j] - take;
          need := need - take;
        end loop;
      end if;
    else
      for i in 1 .. coalesce(array_length(ids, 1), 0) loop
        if ids[i] = ev.id and rems[i] > 0 then
          out_ids := out_ids || ids[i];
          out_amounts := out_amounts || rems[i];
          out_times := out_times || ev.exp;
          rems[i] := 0;
        end if;
      end loop;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(out_ids, 1), 0) loop
    insert into public.fill_ledger (user_id, delta, source, reason, related_id, created_at)
    values (p_user, -out_amounts[i], 'EXPIRY', 'Granted fills expired', out_ids[i]::text, out_times[i])
    on conflict do nothing;
  end loop;
end;
$$;

-- Lazily issues this month's plan allowance (idempotent per user per UTC month).
create or replace function public._grant_period_allowance(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_next timestamptz := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
begin
  select pl.* into v_plan
  from public.entitlements e join public.plans pl on pl.name = e.plan
  where e.user_id = p_user;

  if v_plan is null
     or coalesce((select pr.plan = 'pro' from public.profiles pr where pr.id = p_user), false)
     or v_plan.renewal_period <> 'monthly'
     or v_plan.default_fills <= 0
     or coalesce((v_plan.limits->>'unlimited')::boolean, false) then
    return;
  end if;

  insert into public.fill_ledger (user_id, delta, source, reason, related_id, expires_at)
  values (p_user, v_plan.default_fills, 'PLAN_GRANT', 'Monthly allowance (' || v_plan.name || ')', v_period, v_next)
  on conflict do nothing;
end;
$$;

create or replace function public._audit(
  p_admin uuid, p_action text, p_target uuid, p_before jsonb, p_after jsonb, p_reason text, p_ip text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (admin_id, admin_email, action, target_user_id, before, after, reason, ip)
  values (p_admin, (select email from public.admin_users where user_id = p_admin), p_action, p_target,
          p_before, p_after, p_reason, p_ip);
$$;

-- Public wrapper so the admin-api can record events that are not a database state change
-- (user views, account deletion, admin management). Service role only.
create or replace function public.admin_audit_event(
  p_admin uuid, p_action text, p_target uuid, p_before jsonb, p_after jsonb, p_reason text, p_ip text
) returns void
language sql
security definer
set search_path = public
as $$ select public._audit(p_admin, p_action, p_target, p_before, p_after, p_reason, p_ip); $$;

create or replace function public._revoke_sessions(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.sessions where user_id = p_user;
exception when others then
  -- The admin-api also bans the user through the Auth admin API; do not fail the revoke.
  raise warning 'could not delete sessions for %: %', p_user, sqlerrm;
end;
$$;

-- The single source of truth for "may this user fill right now?".
create or replace function public.entitlement_status(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent public.entitlements;
  v_kill jsonb;
  v_unlimited boolean;
  v_balance integer;
  v_daily_used integer;
  v_allowed boolean := true;
  v_reason text := 'ok';
  v_message text := '';
begin
  if p_user is null then
    return jsonb_build_object('allowed', true, 'status', 'ACTIVE', 'reason', 'anonymous');
  end if;

  perform public._lock_user(p_user);
  perform public._ensure_entitlement(p_user);

  update public.entitlements
     set status = 'ACTIVE', suspended_until = null, updated_at = now()
   where user_id = p_user and status = 'SUSPENDED' and suspended_until is not null and suspended_until <= now();
  if found then
    perform public._audit(null, 'status.auto_reinstate', p_user,
      jsonb_build_object('status', 'SUSPENDED'), jsonb_build_object('status', 'ACTIVE'),
      'Time-boxed suspension expired', null);
  end if;

  perform public._settle_expiry(p_user);
  perform public._grant_period_allowance(p_user);
  v_balance := public._refresh_balance(p_user);

  select * into v_ent from public.entitlements where user_id = p_user;
  select value into v_kill from public.platform_settings where key = 'kill_switch';

  v_unlimited :=
    coalesce((select pr.plan = 'pro' from public.profiles pr where pr.id = p_user), false)
    or coalesce((select (pl.limits->>'unlimited')::boolean from public.plans pl where pl.name = v_ent.plan), false);

  select coalesce(sum(units), 0)::int into v_daily_used
  from public.fill_ledger
  where user_id = p_user and source = 'USAGE'
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  if v_ent.status = 'REVOKED' then
    v_allowed := false; v_reason := 'revoked';
    v_message := 'Your access has been removed. Contact support.';
  elsif coalesce((v_kill->>'enabled')::boolean, false) then
    v_allowed := false; v_reason := 'kill_switch';
    v_message := coalesce(nullif(v_kill->>'message', ''), 'Autofill is temporarily paused. Please try again soon.');
  elsif v_ent.status = 'SUSPENDED' then
    v_allowed := false; v_reason := 'suspended';
    v_message := 'Your access has been paused. Contact support.';
  elsif v_ent.daily_fill_cap is not null and v_daily_used >= v_ent.daily_fill_cap then
    v_allowed := false; v_reason := 'daily_cap';
    v_message := 'You have reached your daily autofill limit. It resets at midnight UTC.';
  elsif not v_unlimited and v_balance <= 0 then
    v_allowed := false; v_reason := 'no_balance';
    v_message := 'You have used all of your fills. Upgrade to Pro for unlimited autofills.';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'status', v_ent.status,
    'balance', v_balance,
    'unlimited', v_unlimited,
    'plan', case when v_unlimited and v_ent.plan = 'FREE' then 'PRO' else v_ent.plan end,
    'reason', v_reason,
    'message', v_message,
    'daily_cap', v_ent.daily_fill_cap,
    'daily_used', v_daily_used,
    'checked_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- User-facing RPCs (the extension and web app call these with the user's JWT).
-- can_run_fill / log_fill_usage / get_fill_usage keep their existing names and
-- signatures so the already-shipped extension build is enforced without an update.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_entitlement()
returns jsonb
language sql
security definer
set search_path = public
as $$ select public.entitlement_status(auth.uid()); $$;

create or replace function public.can_run_fill()
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then true
    else coalesce((public.entitlement_status(auth.uid())->>'allowed')::boolean, true)
  end;
$$;

create or replace function public.log_fill_usage()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_status jsonb;
begin
  if v_user is null then return; end if;
  v_status := public.entitlement_status(v_user);
  -- Revoked users cannot spend anything; everyone else is charged for a run that completed.
  if v_status->>'status' = 'REVOKED' then return; end if;

  insert into public.fill_ledger (user_id, delta, source, units, reason)
  values (
    v_user,
    case when coalesce((v_status->>'unlimited')::boolean, false) then 0 else -1 end,
    'USAGE', 1, 'Autofill run'
  );
  perform public._refresh_balance(v_user);
end;
$$;

create or replace function public.get_fill_usage()
returns table (used integer, cap integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status jsonb := public.entitlement_status(auth.uid());
  v_used integer;
begin
  select coalesce(sum(units), 0)::int into v_used
  from public.fill_ledger
  where user_id = auth.uid() and source = 'USAGE'
    and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');

  used := v_used;
  cap := case
    when coalesce((v_status->>'unlimited')::boolean, false) then null
    else v_used + greatest(coalesce((v_status->>'balance')::int, 0), 0)
  end;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------

create or replace function public.feature_flag_enabled(p_key text, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feature_flags;
  v_plan text;
begin
  select * into f from public.feature_flags where key = p_key;
  if f is null then return false; end if;
  if p_user is not null and f.overrides->'users' ? p_user::text then
    return (f.overrides->'users'->>p_user::text)::boolean;
  end if;
  select coalesce(
           case when pr.plan = 'pro' then 'PRO' else e.plan end, 'FREE')
    into v_plan
  from public.profiles pr left join public.entitlements e on e.user_id = pr.id
  where pr.id = p_user;
  if v_plan is not null and f.overrides->'plans' ? v_plan then
    return (f.overrides->'plans'->>v_plan)::boolean;
  end if;
  return f.default_enabled;
end;
$$;

create or replace function public.get_my_flags()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, public.feature_flag_enabled(key, auth.uid())), '{}'::jsonb)
  from public.feature_flags;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions (service role only; each writes its audit row in the same transaction)
-- ---------------------------------------------------------------------------

create or replace function public.admin_adjust_fills(
  p_admin uuid,
  p_user uuid,
  p_op text,
  p_amount integer,
  p_reason text,
  p_expires_at timestamptz default null,
  p_idempotency_key text default null,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
  v_after integer;
  v_delta integer;
  v_source text;
  v_default integer;
  v_replay jsonb;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  perform public._lock_user(p_user);

  if p_idempotency_key is not null then
    select jsonb_build_object('balance', e.balance, 'delta', l.delta, 'replayed', true) into v_replay
    from public.fill_ledger l join public.entitlements e on e.user_id = l.user_id
    where l.user_id = p_user and l.idempotency_key = p_idempotency_key;
    if v_replay is not null then return v_replay; end if;
  end if;

  perform public._ensure_entitlement(p_user);
  perform public._settle_expiry(p_user);
  perform public._grant_period_allowance(p_user);
  v_before := public._refresh_balance(p_user);

  if p_op = 'grant' then
    if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
    v_delta := p_amount; v_source := 'ADMIN_GRANT';
  elsif p_op = 'remove' then
    if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
    if p_amount > greatest(v_before, 0) then raise exception 'insufficient_balance' using errcode = 'P0001'; end if;
    v_delta := -p_amount; v_source := 'ADMIN_REMOVE';
  elsif p_op = 'set' then
    if p_amount is null or p_amount < 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
    v_delta := p_amount - v_before;
    v_source := case when v_delta >= 0 then 'ADMIN_GRANT' else 'ADMIN_REMOVE' end;
  elsif p_op = 'reset' then
    select pl.default_fills into v_default
    from public.entitlements e join public.plans pl on pl.name = e.plan where e.user_id = p_user;
    v_delta := coalesce(v_default, 0) - v_before;
    v_source := 'RESET';
  else
    raise exception 'invalid_op' using errcode = 'P0001';
  end if;

  if p_expires_at is not null and (v_delta <= 0 or p_expires_at <= now()) then
    raise exception 'invalid_expiry' using errcode = 'P0001';
  end if;

  if v_delta = 0 then
    return jsonb_build_object('balance', v_before, 'delta', 0, 'noop', true);
  end if;

  insert into public.fill_ledger (user_id, delta, source, reason, admin_id, expires_at, idempotency_key)
  values (p_user, v_delta, v_source, p_reason, p_admin, p_expires_at, p_idempotency_key);

  v_after := public._refresh_balance(p_user);

  perform public._audit(p_admin, 'fills.' || p_op, p_user,
    jsonb_build_object('balance', v_before),
    jsonb_build_object('balance', v_after, 'delta', v_delta, 'expires_at', p_expires_at),
    p_reason, p_ip);

  return jsonb_build_object('balance', v_after, 'delta', v_delta);
end;
$$;

create or replace function public.admin_set_status(
  p_admin uuid,
  p_user uuid,
  p_status text,
  p_reason text,
  p_until timestamptz default null,
  p_balance integer default null,
  p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.entitlements;
  v_new_until timestamptz;
  v_adjust jsonb;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if p_until is not null and (p_status <> 'SUSPENDED' or p_until <= now()) then
    raise exception 'invalid_until' using errcode = 'P0001';
  end if;
  if p_balance is not null and p_status <> 'ACTIVE' then
    raise exception 'invalid_balance' using errcode = 'P0001';
  end if;

  perform public._lock_user(p_user);
  perform public._ensure_entitlement(p_user);
  select * into v_old from public.entitlements where user_id = p_user;
  v_new_until := case when p_status = 'SUSPENDED' then p_until else null end;

  if v_old.status = p_status and v_old.suspended_until is not distinct from v_new_until and p_balance is null then
    return jsonb_build_object('status', p_status, 'noop', true);
  end if;

  update public.entitlements
     set status = p_status, suspended_until = v_new_until, updated_at = now()
   where user_id = p_user;

  if p_status = 'REVOKED' then
    perform public._revoke_sessions(p_user);
  end if;

  perform public._audit(p_admin, 'status.' || lower(p_status), p_user,
    jsonb_build_object('status', v_old.status, 'suspended_until', v_old.suspended_until),
    jsonb_build_object('status', p_status, 'suspended_until', v_new_until, 'balance', p_balance),
    p_reason, p_ip);

  if p_balance is not null then
    v_adjust := public.admin_adjust_fills(p_admin, p_user, 'set', p_balance, p_reason, null, null, p_ip);
  end if;

  return jsonb_build_object('status', p_status, 'suspended_until', v_new_until, 'adjust', v_adjust);
end;
$$;

create or replace function public.admin_set_plan(
  p_admin uuid, p_user uuid, p_plan text, p_reason text, p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.plans where name = upper(p_plan) and active) then
    raise exception 'unknown_plan' using errcode = 'P0001';
  end if;

  perform public._lock_user(p_user);
  perform public._ensure_entitlement(p_user);
  select plan into v_old from public.entitlements where user_id = p_user;
  if v_old = upper(p_plan) then
    return jsonb_build_object('plan', v_old, 'noop', true);
  end if;

  update public.entitlements set plan = upper(p_plan), updated_at = now() where user_id = p_user;
  perform public._audit(p_admin, 'plan.change', p_user,
    jsonb_build_object('plan', v_old), jsonb_build_object('plan', upper(p_plan)), p_reason, p_ip);
  return jsonb_build_object('plan', upper(p_plan));
end;
$$;

-- p_limits keys: daily_fill_cap, max_applications_per_day. A present key set to null clears it.
create or replace function public.admin_set_limits(
  p_admin uuid, p_user uuid, p_limits jsonb, p_reason text, p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.entitlements;
  v_cap integer;
  v_apps integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  perform public._lock_user(p_user);
  perform public._ensure_entitlement(p_user);
  select * into v_old from public.entitlements where user_id = p_user;

  v_cap := case when p_limits ? 'daily_fill_cap' then (p_limits->>'daily_fill_cap')::int else v_old.daily_fill_cap end;
  v_apps := case when p_limits ? 'max_applications_per_day' then (p_limits->>'max_applications_per_day')::int
                 else v_old.max_applications_per_day end;

  if v_cap is not distinct from v_old.daily_fill_cap and v_apps is not distinct from v_old.max_applications_per_day then
    return jsonb_build_object('noop', true);
  end if;

  update public.entitlements
     set daily_fill_cap = v_cap, max_applications_per_day = v_apps, updated_at = now()
   where user_id = p_user;

  perform public._audit(p_admin, 'limits.change', p_user,
    jsonb_build_object('daily_fill_cap', v_old.daily_fill_cap, 'max_applications_per_day', v_old.max_applications_per_day),
    jsonb_build_object('daily_fill_cap', v_cap, 'max_applications_per_day', v_apps),
    p_reason, p_ip);
  return jsonb_build_object('daily_fill_cap', v_cap, 'max_applications_per_day', v_apps);
end;
$$;

-- Removes a user's activity records (usage events, missed-field reports). The fill ledger is
-- append-only and stays; it carries counts only and no content.
create or replace function public.admin_delete_activity(
  p_admin uuid, p_user uuid, p_reason text, p_ip text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events integer;
  v_missed integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  delete from public.fill_usage_events where user_id = p_user;
  get diagnostics v_events = row_count;
  delete from public.missed_fields where user_id = p_user;
  get diagnostics v_missed = row_count;

  perform public._audit(p_admin, 'data.delete_activity', p_user, null,
    jsonb_build_object('usage_events_deleted', v_events, 'missed_fields_deleted', v_missed), p_reason, p_ip);
  return jsonb_build_object('usage_events_deleted', v_events, 'missed_fields_deleted', v_missed);
end;
$$;

create or replace function public.admin_force_signout(
  p_admin uuid, p_user uuid, p_reason text, p_ip text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  perform public._revoke_sessions(p_user);
  perform public._audit(p_admin, 'session.force_signout', p_user, null, null, p_reason, p_ip);
end;
$$;

-- ---------------------------------------------------------------------------
-- Users view and reads
-- ---------------------------------------------------------------------------

create or replace function public._admin_users_view(p_filter jsonb)
returns table (
  user_id uuid, email text, full_name text, signup_at timestamptz, status text, plan text,
  effective_plan text, unlimited boolean, balance integer, suspended_until timestamptz,
  daily_fill_cap integer, fills_7d bigint, fills_all bigint, last_active timestamptz, applications bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with usage as (
    select l.user_id,
           sum(l.units) filter (where l.created_at >= now() - interval '7 days') as f7,
           sum(l.units) as fall,
           max(l.created_at) as last_at
    from public.fill_ledger l where l.source = 'USAGE' group by l.user_id
  ),
  apps as (select a.user_id, count(*) as c from public.applications a group by a.user_id),
  base as (
    select p.id, p.email, p.full_name, p.created_at,
           coalesce(e.status, 'ACTIVE') as status,
           coalesce(e.plan, 'FREE') as plan,
           case when p.plan = 'pro' then 'PRO' else coalesce(e.plan, 'FREE') end as eff_plan,
           (p.plan = 'pro' or coalesce(pl.limits->>'unlimited', 'false') = 'true') as unlimited,
           coalesce(e.balance, 0) as balance,
           e.suspended_until, e.daily_fill_cap,
           coalesce(u.f7, 0) as f7, coalesce(u.fall, 0) as fall, u.last_at,
           coalesce(a.c, 0) as apps
    from public.profiles p
    left join public.entitlements e on e.user_id = p.id
    left join public.plans pl on pl.name = e.plan
    left join usage u on u.user_id = p.id
    left join apps a on a.user_id = p.id
  )
  select b.id, b.email, b.full_name, b.created_at, b.status, b.plan, b.eff_plan, b.unlimited, b.balance,
         b.suspended_until, b.daily_fill_cap, b.f7, b.fall, b.last_at, b.apps
  from base b
  where (nullif(p_filter->>'query', '') is null
         or b.email ilike '%' || (p_filter->>'query') || '%'
         or b.full_name ilike '%' || (p_filter->>'query') || '%'
         or b.id::text = (p_filter->>'query'))
    and (nullif(p_filter->>'status', '') is null or b.status = upper(p_filter->>'status'))
    and (nullif(p_filter->>'plan', '') is null or b.eff_plan = upper(p_filter->>'plan'))
    and (nullif(p_filter->>'balance_below', '') is null or b.balance < (p_filter->>'balance_below')::int)
    and (nullif(p_filter->>'inactive_days', '') is null
         or b.last_at is null
         or b.last_at < now() - make_interval(days => (p_filter->>'inactive_days')::int))
    and (nullif(p_filter->>'active_from', '') is null or b.last_at >= (p_filter->>'active_from')::timestamptz)
    and (nullif(p_filter->>'active_to', '') is null or b.last_at < (p_filter->>'active_to')::timestamptz)
    and (nullif(p_filter->>'ids', '') is null or b.id::text = any (string_to_array(p_filter->>'ids', ',')));
$$;

create or replace function public.admin_list_users(
  p_filter jsonb, p_sort text default 'signup_at', p_dir text default 'desc',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_rows jsonb;
  v_sort text := case when p_sort in ('email', 'signup_at', 'status', 'plan', 'balance', 'fills_7d', 'fills_all',
                                       'last_active', 'applications') then p_sort else 'signup_at' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
begin
  select count(*) into v_total from public._admin_users_view(p_filter);

  execute format($q$
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
      select user_id, email, full_name, signup_at, status, effective_plan as plan, unlimited, balance,
             suspended_until, daily_fill_cap, fills_7d, fills_all, last_active, applications
      from public._admin_users_view($1)
      order by %I %s nulls last, user_id
      limit $2 offset $3
    ) r $q$, case v_sort when 'plan' then 'effective_plan' else v_sort end, v_dir)
  into v_rows using p_filter, least(greatest(p_limit, 1), 5000), greatest(p_offset, 0);

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create or replace function public.admin_segment_ids(p_filter jsonb, p_cap integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public._admin_users_view(p_filter)),
    'ids', coalesce((select jsonb_agg(user_id) from (
              select user_id from public._admin_users_view(p_filter) order by signup_at limit p_cap) s), '[]'::jsonb)
  );
$$;

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_profile record;
begin
  select * into v_row from public._admin_users_view(jsonb_build_object('ids', p_user::text)) limit 1;
  if v_row is null then return null; end if;
  select pr.plan as billing_plan, pr.subscription_status, pr.price_interval, pr.current_period_end
    into v_profile from public.profiles pr where pr.id = p_user;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_row.user_id, 'email', v_row.email, 'full_name', v_row.full_name, 'signup_at', v_row.signup_at,
      'last_active', v_row.last_active, 'applications', v_row.applications),
    'entitlement', jsonb_build_object(
      'status', v_row.status, 'plan', v_row.plan, 'effective_plan', v_row.effective_plan,
      'unlimited', v_row.unlimited, 'balance', v_row.balance,
      'suspended_until', v_row.suspended_until, 'daily_fill_cap', v_row.daily_fill_cap,
      'max_applications_per_day', (select max_applications_per_day from public.entitlements where user_id = p_user)),
    'billing', jsonb_build_object(
      'plan', v_profile.billing_plan, 'subscription_status', v_profile.subscription_status,
      'interval', v_profile.price_interval, 'current_period_end', v_profile.current_period_end),
    'usage', jsonb_build_object(
      'fills_7d', v_row.fills_7d, 'fills_all', v_row.fills_all,
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'fills', coalesce(u.f, 0)) order by d.day)
        from (select g::date as day from generate_series(
                ((now() at time zone 'utc')::date - 29)::timestamp,
                (now() at time zone 'utc')::date::timestamp, interval '1 day') g) d
        left join (
          select (created_at at time zone 'utc')::date as day, sum(units) as f
          from public.fill_ledger
          where user_id = p_user and source = 'USAGE' and created_at >= now() - interval '31 days'
          group by 1) u on u.day = d.day
      ), '[]'::jsonb)),
    -- Company, role title and status only: never the posting URL or free-text notes.
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company_name', a.company_name, 'position_title', a.position_title,
        'status', a.status, 'applied_at', a.applied_at) order by a.applied_at desc)
      from (select * from public.applications where user_id = p_user order by applied_at desc limit 25) a
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_user_ledger(p_user uuid, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.fill_ledger where user_id = p_user),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select l.id, l.delta, l.source, l.units, l.reason, l.created_at, l.expires_at,
               l.admin_id, a.email as admin_email
        from public.fill_ledger l left join public.admin_users a on a.user_id = l.admin_id
        where l.user_id = p_user
        order by l.created_at desc, l.id
        limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) r), '[]'::jsonb));
$$;

create or replace function public.admin_audit_list(
  p_admin_email text default null, p_action text default null, p_target uuid default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 100, p_offset integer default 0
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select * from public.audit_log a
    where (p_admin_email is null or a.admin_email ilike '%' || p_admin_email || '%')
      and (p_action is null or a.action like p_action || '%')
      and (p_target is null or a.target_user_id = p_target)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select id, admin_id, admin_email, action, target_user_id, before, after, reason, ip, created_at
        from f order by created_at desc, id
        limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) r), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Metrics
-- ---------------------------------------------------------------------------

create or replace function public.admin_metrics_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_new integer;
  v_activated integer;
begin
  select count(*) into v_new from public.profiles where created_at >= p_from and created_at < p_to;
  select count(*) into v_activated from public.profiles p
  where p.created_at >= p_from and p.created_at < p_to
    and exists (select 1 from public.fill_ledger l
                where l.user_id = p.id and l.source = 'USAGE' and l.created_at < p_to);

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'total_users', (select count(*) from public.profiles where created_at < p_to),
    'new_users', v_new,
    'weekly_active_users', (
      select count(distinct user_id) from public.fill_ledger
      where source = 'USAGE' and created_at >= p_to - interval '7 days' and created_at < p_to),
    'active_users', (
      select count(distinct user_id) from public.fill_ledger
      where source = 'USAGE' and created_at >= p_from and created_at < p_to),
    'activated_users', v_activated,
    'activation_rate', case when v_new = 0 then null else round(v_activated::numeric / v_new, 4) end,
    'fills_consumed', (
      select coalesce(sum(units), 0) from public.fill_ledger
      where source = 'USAGE' and created_at >= p_from and created_at < p_to),
    'fills_granted', (
      select coalesce(sum(delta), 0) from public.fill_ledger
      where delta > 0 and source in ('PLAN_GRANT', 'ADMIN_GRANT', 'RESET', 'REFUND')
        and created_at >= p_from and created_at < p_to),
    'applications_logged', (
      select count(*) from public.applications where applied_at >= p_from and applied_at < p_to),
    'plan_mix', coalesce((
      select jsonb_object_agg(plan, c) from (
        select case when p.plan = 'pro' then 'PRO' else coalesce(e.plan, 'FREE') end as plan, count(*) as c
        from public.profiles p left join public.entitlements e on e.user_id = p.id
        where p.created_at < p_to group by 1) s), '{}'::jsonb),
    'status_mix', coalesce((
      select jsonb_object_agg(status, c) from (
        select coalesce(e.status, 'ACTIVE') as status, count(*) as c
        from public.profiles p left join public.entitlements e on e.user_id = p.id
        where p.created_at < p_to group by 1) s), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'fills', coalesce(u.fills, 0),
        'active_users', coalesce(u.users, 0),
        'new_users', coalesce(n.c, 0),
        'granted', coalesce(g.granted, 0)) order by d.day)
      from (select g::date as day from generate_series(
                   (p_from at time zone 'utc')::date::timestamp,
                   ((p_to - interval '1 second') at time zone 'utc')::date::timestamp, interval '1 day') g) d
      left join (
        select (created_at at time zone 'utc')::date as day, sum(units) as fills, count(distinct user_id) as users
        from public.fill_ledger where source = 'USAGE' and created_at >= p_from and created_at < p_to
        group by 1) u on u.day = d.day
      left join (
        select (created_at at time zone 'utc')::date as day, count(*) as c
        from public.profiles where created_at >= p_from and created_at < p_to group by 1) n on n.day = d.day
      left join (
        select (created_at at time zone 'utc')::date as day, sum(delta) as granted
        from public.fill_ledger
        where delta > 0 and source in ('PLAN_GRANT', 'ADMIN_GRANT', 'RESET', 'REFUND')
          and created_at >= p_from and created_at < p_to group by 1) g on g.day = d.day
    ), '[]'::jsonb)
  );
end;
$$;

-- Matching quality from the shared form_mappings counters. Counters are cumulative (not dated),
-- so this view is all-time. It carries field labels and counts only, never values.
create or replace function public.admin_metrics_quality(p_ats text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select * from public.form_mappings
    where p_ats is null or p_ats = '' or lower(coalesce(platform, '')) = lower(p_ats)
  )
  select jsonb_build_object(
    'by_platform', coalesce((select jsonb_agg(to_jsonb(r) order by r.evidence desc) from (
      select coalesce(nullif(platform, ''), 'other') as platform,
             count(*) as mappings,
             sum(success_count) as success, sum(override_count) as override, sum(missing_count) as missing,
             sum(success_count + override_count + missing_count) as evidence,
             case when sum(success_count + override_count) = 0 then null
                  else round(sum(override_count)::numeric / sum(success_count + override_count), 4) end as override_rate,
             case when sum(success_count + override_count + missing_count) = 0 then null
                  else round(sum(missing_count)::numeric / sum(success_count + override_count + missing_count), 4) end as miss_rate
      from m group by 1) r), '[]'::jsonb),
    'top_unmatched', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select field_label as label, field_name, profile_path as canonical_key,
             coalesce(nullif(platform, ''), 'other') as platform,
             missing_count as missing, override_count as override, success_count as success
      from m where missing_count > 0
      order by missing_count desc, override_count desc limit 25) r), '[]'::jsonb),
    'top_overridden', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select field_label as label, field_name, profile_path as canonical_key,
             coalesce(nullif(platform, ''), 'other') as platform,
             override_count as override, success_count as success, missing_count as missing
      from m where override_count > 0
      order by override_count desc limit 25) r), '[]'::jsonb),
    'profile_completeness', coalesce((select jsonb_object_agg(bucket, c) from (
      select case when completeness >= 100 then '100'
                  when completeness >= 75 then '75-99'
                  when completeness >= 50 then '50-74'
                  when completeness >= 25 then '25-49' else '0-24' end as bucket,
             count(*) as c
      from public.application_profiles group by 1) s), '{}'::jsonb)
  );
$$;

create or replace function public.admin_system_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ledger_rows_24h', (select count(*) from public.fill_ledger where created_at >= now() - interval '24 hours'),
    'fills_24h', (select coalesce(sum(units), 0) from public.fill_ledger
                  where source = 'USAGE' and created_at >= now() - interval '24 hours'),
    'admin_actions_24h', (select count(*) from public.audit_log where created_at >= now() - interval '24 hours'),
    'balance_mismatches', (
      select count(*) from public.entitlements e
      where e.balance is distinct from coalesce((select sum(delta) from public.fill_ledger l where l.user_id = e.user_id), 0)),
    'bulk_jobs', coalesce((select jsonb_object_agg(status, c) from (
      select status, count(*) as c from public.bulk_jobs where created_at >= now() - interval '7 days' group by 1) s), '{}'::jsonb),
    'jobs', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select distinct on (job) job, started_at, finished_at, status, detail,
             extract(epoch from (finished_at - started_at)) as seconds
      from public.job_runs order by job, started_at desc) r), '[]'::jsonb),
    'kill_switch', (select value from public.platform_settings where key = 'kill_switch')
  );
$$;

-- Verifies entitlements.balance against the ledger and settles due expiries. Safe to re-run.
create or replace function public.admin_reconcile_balances(p_fix boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_u uuid;
  v_settled integer := 0;
  v_checked integer := 0;
  v_mismatch integer := 0;
begin
  insert into public.job_runs (job) values ('reconcile') returning id into v_run;

  for v_u in
    select distinct g.user_id from public.fill_ledger g
    where g.delta > 0 and g.expires_at is not null and g.expires_at <= now()
      and not exists (select 1 from public.fill_ledger x
                      where x.user_id = g.user_id and x.source = 'EXPIRY' and x.related_id = g.id::text)
      and exists (select 1 from public.entitlements e where e.user_id = g.user_id)
  loop
    perform public._lock_user(v_u);
    perform public._settle_expiry(v_u);
    v_settled := v_settled + 1;
  end loop;

  select count(*) into v_checked from public.entitlements;
  select count(*) into v_mismatch from public.entitlements e
  where e.balance is distinct from coalesce((select sum(delta) from public.fill_ledger l where l.user_id = e.user_id), 0);

  if p_fix and v_mismatch > 0 then
    update public.entitlements e
       set balance = coalesce((select sum(delta) from public.fill_ledger l where l.user_id = e.user_id), 0)
     where e.balance is distinct from coalesce((select sum(delta) from public.fill_ledger l where l.user_id = e.user_id), 0);
  end if;

  update public.job_runs
     set finished_at = now(), status = 'ok',
         detail = jsonb_build_object('checked', v_checked, 'mismatched', v_mismatch,
                                     'fixed', case when p_fix then v_mismatch else 0 end, 'expiries_settled_users', v_settled)
   where id = v_run;

  return jsonb_build_object('checked', v_checked, 'mismatched', v_mismatch,
                            'fixed', case when p_fix then v_mismatch else 0 end, 'expiries_settled_users', v_settled);
end;
$$;

-- ---------------------------------------------------------------------------
-- New users get an entitlement row; existing users are backfilled below.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_profile_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlements (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_create_entitlement on public.profiles;
create trigger profiles_create_entitlement
  after insert on public.profiles
  for each row execute function public.handle_new_profile_entitlement();

insert into public.entitlements (user_id)
select p.id from public.profiles p
where exists (select 1 from auth.users u where u.id = p.id)
on conflict (user_id) do nothing;

-- Carry this month's already-used quota into the ledger so nobody gets a fresh allowance
-- the moment this migration lands: allowance, then this month's legacy usage.
insert into public.fill_ledger (user_id, delta, source, reason, related_id, expires_at)
select e.user_id, pl.default_fills, 'PLAN_GRANT', 'Monthly allowance (' || pl.name || ')',
       to_char(now() at time zone 'utc', 'YYYY-MM'),
       (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'
from public.entitlements e
join public.plans pl on pl.name = e.plan
where pl.renewal_period = 'monthly' and pl.default_fills > 0
on conflict do nothing;

insert into public.fill_ledger (user_id, delta, source, units, reason, related_id, created_at)
select f.user_id,
       case when pr.plan = 'pro' then 0 else -count(*)::int end,
       'USAGE', count(*)::int, 'Backfilled from fill_usage_events', 'legacy-backfill', min(f.created_at)
from public.fill_usage_events f
join public.entitlements e on e.user_id = f.user_id
left join public.profiles pr on pr.id = f.user_id
where f.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
  and not exists (select 1 from public.fill_ledger x where x.user_id = f.user_id and x.related_id = 'legacy-backfill')
group by f.user_id, pr.plan;

update public.entitlements e
   set balance = coalesce((select sum(delta) from public.fill_ledger l where l.user_id = e.user_id), 0);

-- ---------------------------------------------------------------------------
-- Grants: everything above is service-role only except the user-scoped RPCs.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname like '\_%' or p.proname in
           ('entitlement_status', 'feature_flag_enabled', 'forbid_mutation', 'handle_new_profile_entitlement'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

revoke all on function public.get_my_entitlement() from public, anon;
revoke all on function public.get_my_flags() from public, anon;
revoke all on function public.can_run_fill() from public, anon;
revoke all on function public.log_fill_usage() from public, anon;
revoke all on function public.get_fill_usage() from public, anon;
grant execute on function public.get_my_entitlement() to authenticated;
grant execute on function public.get_my_flags() to authenticated;
grant execute on function public.can_run_fill() to authenticated;
grant execute on function public.log_fill_usage() to authenticated;
grant execute on function public.get_fill_usage() to authenticated;
