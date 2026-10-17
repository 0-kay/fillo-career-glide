-- Minimal stand-in for the parts of a Supabase project the admin migration touches, so the
-- migration can run against an in-process Postgres (PGlite) in tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);

create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, created_at timestamptz default now(), updated_at timestamptz default now(),
  plan text not null default 'free', subscription_status text not null default 'inactive',
  price_interval text, current_period_end timestamptz
);
create table public.application_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text, completeness integer default 0
);
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  company_name text not null, position_title text not null, application_url text,
  status text default 'applied', applied_at timestamptz default now(), notes text
);
create table public.fill_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now()
);
create table public.missed_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);
create table public.form_mappings (
  id uuid primary key default gen_random_uuid(),
  platform text, field_name text not null default '', field_label text not null default '',
  profile_path text not null default '',
  success_count integer not null default 0, override_count integer not null default 0,
  missing_count integer not null default 0
);
