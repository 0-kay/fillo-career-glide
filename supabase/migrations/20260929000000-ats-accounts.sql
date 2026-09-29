-- Candidate accounts a user has at employer ATS tenants (Workday companies, iCIMS portals).
--
-- Holds no secrets: passwords live in the user's own browser password manager. Fyllo uses this
-- to tell "sign in" from "create account" per employer, and to list the user's accounts.
-- Writing is a Pro feature (enforced here, not only in the extension).

CREATE TABLE IF NOT EXISTS public.ats_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant            TEXT NOT NULL,            -- host, e.g. nvidia.wd5.myworkdayjobs.com
  platform          TEXT NOT NULL CHECK (platform IN ('workday', 'icims')),
  email             TEXT,
  status            TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'needs_reset')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_signed_in_at TIMESTAMPTZ,
  UNIQUE (user_id, tenant)
);

ALTER TABLE public.ats_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ATS accounts"
  ON public.ats_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Pro users can add their own ATS accounts"
  ON public.ats_accounts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT plan FROM public.profiles WHERE id = auth.uid()) = 'pro'
  );

CREATE POLICY "Pro users can update their own ATS accounts"
  ON public.ats_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT plan FROM public.profiles WHERE id = auth.uid()) = 'pro'
  );

CREATE POLICY "Users can delete their own ATS accounts"
  ON public.ats_accounts FOR DELETE
  USING (auth.uid() = user_id);
