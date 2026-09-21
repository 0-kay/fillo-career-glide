-- Server-side profile lookups for the LLM autofill orchestrator (apps/api).
--
-- These run as SECURITY DEFINER and take the owner explicitly, so they must only be
-- callable by the server (service_role), which has already verified the user's session.
-- Exposing them to anon/authenticated would let any client read any user's profile.
--
-- Inside a SQL function a parameter named like a column loses to the column, so the
-- parameters are always referenced by function-qualified name below.

-- get_application_profile(profile_id, user_id): one profile, only if the user owns it
create or replace function public.get_application_profile(profile_id uuid, user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(ap) from public.application_profiles ap
  where ap.id = get_application_profile.profile_id
    and ap.user_id = get_application_profile.user_id;
$$;

-- get_default_profile_for_user(user_id): the user's most recently updated profile
create or replace function public.get_default_profile_for_user(user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(ap) from public.application_profiles ap
  where ap.user_id = get_default_profile_for_user.user_id
  order by ap.updated_at desc
  limit 1;
$$;

revoke all on function public.get_application_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_default_profile_for_user(uuid) from public, anon, authenticated;
grant execute on function public.get_application_profile(uuid, uuid) to service_role;
grant execute on function public.get_default_profile_for_user(uuid) to service_role;
