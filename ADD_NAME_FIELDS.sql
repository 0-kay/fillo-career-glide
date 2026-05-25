-- ========================================
-- ADD NAME FIELDS: application_profiles table
-- ========================================
-- This migration adds first_name, middle_name, and last_name fields
-- Run this in your Supabase SQL Editor after the cleanup migration

-- Add the name fields
ALTER TABLE public.application_profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS middle_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add comments to document the name fields
COMMENT ON COLUMN public.application_profiles.first_name IS 'First name extracted from resume';
COMMENT ON COLUMN public.application_profiles.middle_name IS 'Middle name extracted from resume (nullable)';
COMMENT ON COLUMN public.application_profiles.last_name IS 'Last name extracted from resume';

-- Optional: Update existing profiles to populate name fields from existing data
-- This is a one-time update for existing profiles
UPDATE public.application_profiles 
SET 
  first_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL THEN 
      split_part(personal_details->>'fullName', ' ', 1)
    ELSE 
      split_part(name, ' ', 1)
  END,
  last_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL THEN 
      CASE 
        WHEN array_length(string_to_array(personal_details->>'fullName', ' '), 1) > 1 THEN
          split_part(personal_details->>'fullName', ' ', array_length(string_to_array(personal_details->>'fullName', ' '), 1))
        ELSE ''
      END
    ELSE 
      CASE 
        WHEN array_length(string_to_array(name, ' '), 1) > 1 THEN
          split_part(name, ' ', array_length(string_to_array(name, ' '), 1))
        ELSE ''
      END
  END,
  middle_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL THEN 
      CASE 
        WHEN array_length(string_to_array(personal_details->>'fullName', ' '), 1) = 3 THEN
          split_part(personal_details->>'fullName', ' ', 2)
        WHEN array_length(string_to_array(personal_details->>'fullName', ' '), 1) > 3 THEN
          array_to_string(
            (string_to_array(personal_details->>'fullName', ' '))[2:array_length(string_to_array(personal_details->>'fullName', ' '), 1)-1], 
            ' '
          )
        ELSE NULL
      END
    ELSE 
      CASE 
        WHEN array_length(string_to_array(name, ' '), 1) = 3 THEN
          split_part(name, ' ', 2)
        WHEN array_length(string_to_array(name, ' '), 1) > 3 THEN
          array_to_string(
            (string_to_array(name, ' '))[2:array_length(string_to_array(name, ' '), 1)-1], 
            ' '
          )
        ELSE NULL
      END
  END
WHERE first_name IS NULL OR last_name IS NULL;

-- Show the updated schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'application_profiles' 
    AND table_schema = 'public'
    AND column_name IN ('first_name', 'middle_name', 'last_name', 'name')
ORDER BY ordinal_position; 