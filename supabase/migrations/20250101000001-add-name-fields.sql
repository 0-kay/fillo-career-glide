-- Migration: Add name fields back to application_profiles table
-- This adds first_name, middle_name, and last_name fields for proper name parsing

ALTER TABLE public.application_profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS middle_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add comments to document the name fields
COMMENT ON COLUMN public.application_profiles.first_name IS 'First name extracted from resume';
COMMENT ON COLUMN public.application_profiles.middle_name IS 'Middle name extracted from resume (nullable)';
COMMENT ON COLUMN public.application_profiles.last_name IS 'Last name extracted from resume'; 