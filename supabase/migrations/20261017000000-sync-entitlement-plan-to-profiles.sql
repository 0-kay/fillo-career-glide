-- The admin dashboard changes a user's plan on public.entitlements (FREE/BETA/PRO/CUSTOM),
-- but the app, the extension and the quota RPCs (can_run_fill, get_fill_usage, the free
-- profile limit, ATS account assist) all read public.profiles.plan ('free' | 'pro').
-- An admin upgrade therefore left the user on Free. Keep profiles.plan in step.

create or replace function public._sync_entitlement_plan_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A brand-new FREE entitlement row is just a default; don't let it downgrade someone
  -- who is already Pro through Stripe. Explicit changes (UPDATE of plan) always win.
  if tg_op = 'INSERT' and new.plan = 'FREE' then
    return new;
  end if;

  update public.profiles
     set plan = case when new.plan = 'PRO' then 'pro' else 'free' end
   where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists entitlements_sync_plan on public.entitlements;
create trigger entitlements_sync_plan
  after insert or update of plan on public.entitlements
  for each row execute function public._sync_entitlement_plan_to_profile();

-- Users the admin already upgraded before this existed. Upgrades only: never downgrade
-- a Stripe subscriber based on a default entitlement row.
update public.profiles p
   set plan = 'pro'
  from public.entitlements e
 where e.user_id = p.id and e.plan = 'PRO' and p.plan <> 'pro';
