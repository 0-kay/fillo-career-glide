-- Billing (Stripe) and usage-quota support for the Free / Pro plans.
--
-- Free: 1 application profile, 5 autofills/month, capped AI-fallback input.
-- Pro ($9/mo or $90/yr): unlimited profiles, unlimited fills, full AI fallback.

alter table public.profiles
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists price_interval text,
  add column if not exists current_period_end timestamptz;

alter table public.profiles
  add constraint profiles_plan_check check (plan in ('free', 'pro')),
  add constraint profiles_price_interval_check check (price_interval is null or price_interval in ('month', 'year'));

-- "Users can update their own profile" (existing policy) is row-level only — it does
-- not stop a signed-in user from updating their OWN plan/subscription columns directly
-- via the client SDK, which would let them grant themselves Pro for free. Revoke
-- column-level UPDATE on the billing columns from authenticated; only the stripe-*
-- edge functions (via the service-role key, which bypasses grants and RLS) may write
-- them. full_name/email and other existing columns are unaffected.
revoke update (
  stripe_customer_id, stripe_subscription_id, plan, subscription_status,
  price_interval, current_period_end
) on public.profiles from authenticated;

-- One row per completed autofill run, used only to count usage for the free-tier quota.
create table if not exists public.fill_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now()
);

alter table public.fill_usage_events enable row level security;

create policy "Users can view their own fill usage"
  on public.fill_usage_events for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for normal users: rows are only ever written by
-- log_fill_usage() below (SECURITY DEFINER), so a client can't pad or erase its own quota.

create index if not exists fill_usage_events_user_month_idx
  on public.fill_usage_events (user_id, created_at);

-- True if the signed-in user may run another autofill this calendar month.
-- Pro is always true; Free is capped at 5 fills/month.
create or replace function public.can_run_fill()
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when (select plan from public.profiles where id = auth.uid()) = 'pro' then true
    else (
      select count(*) < 5
      from public.fill_usage_events
      where user_id = auth.uid()
        and created_at >= date_trunc('month', now())
    )
  end;
$$;

revoke all on function public.can_run_fill() from public, anon;
grant execute on function public.can_run_fill() to authenticated;

-- Records one autofill run for the signed-in user. Call after a fill completes
-- (fields_filled > 0), not before — a checked-but-aborted run shouldn't cost quota.
create or replace function public.log_fill_usage()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.fill_usage_events (user_id) values (auth.uid());
$$;

revoke all on function public.log_fill_usage() from public, anon;
grant execute on function public.log_fill_usage() to authenticated;

-- How many application_profiles the signed-in user may have. null = unlimited (Pro).
create or replace function public.max_profiles_allowed()
returns integer
language sql
security definer
set search_path = public
as $$
  select case when (select plan from public.profiles where id = auth.uid()) = 'pro' then null else 1 end;
$$;

revoke all on function public.max_profiles_allowed() from public, anon;
grant execute on function public.max_profiles_allowed() to authenticated;

-- Current month's fill count and the plan's cap, for a usage meter in the UI.
-- cap = null means unlimited (Pro).
create or replace function public.get_fill_usage()
returns table (used integer, cap integer)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.fill_usage_events
      where user_id = auth.uid() and created_at >= date_trunc('month', now())) as used,
    (select case when plan = 'pro' then null else 5 end from public.profiles where id = auth.uid()) as cap;
$$;

revoke all on function public.get_fill_usage() from public, anon;
grant execute on function public.get_fill_usage() to authenticated;

-- Enforce the profile-count limit in the database, not just in the client UI — a
-- direct insert via the client SDK must not be able to bypass the free-tier cap.
create or replace function public.enforce_profile_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed integer;
  existing integer;
begin
  select case when p.plan = 'pro' then null else 1 end into allowed
  from public.profiles p where p.id = new.user_id;

  if allowed is not null then
    select count(*) into existing from public.application_profiles where user_id = new.user_id;
    if existing >= allowed then
      raise exception 'Free plan is limited to % profile(s). Upgrade to Pro for unlimited profiles.', allowed
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_limit_trigger on public.application_profiles;
create trigger enforce_profile_limit_trigger
  before insert on public.application_profiles
  for each row execute function public.enforce_profile_limit();
