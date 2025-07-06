-- ========================================
-- COMPLETE NAME MIGRATION: application_profiles table
-- ========================================
-- This migration:
-- 1. Adds first_name, middle_name, last_name fields
-- 2. Migrates data from existing name field
-- 3. Removes deprecated name field
-- 4. Cleans up other deprecated fields

-- Step 1: Add the new name fields
ALTER TABLE public.application_profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS middle_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Step 2: Migrate existing data to new name fields
UPDATE public.application_profiles 
SET 
  first_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL AND personal_details->>'fullName' != '' THEN 
      split_part(trim(personal_details->>'fullName'), ' ', 1)
    WHEN name IS NOT NULL AND name != '' THEN
      split_part(trim(name), ' ', 1)
    ELSE ''
  END,
  last_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL AND personal_details->>'fullName' != '' THEN 
      CASE 
        WHEN array_length(string_to_array(trim(personal_details->>'fullName'), ' '), 1) > 1 THEN
          split_part(trim(personal_details->>'fullName'), ' ', array_length(string_to_array(trim(personal_details->>'fullName'), ' '), 1))
        ELSE ''
      END
    WHEN name IS NOT NULL AND name != '' THEN
      CASE 
        WHEN array_length(string_to_array(trim(name), ' '), 1) > 1 THEN
          split_part(trim(name), ' ', array_length(string_to_array(trim(name), ' '), 1))
        ELSE ''
      END
    ELSE ''
  END,
  middle_name = CASE 
    WHEN personal_details->>'fullName' IS NOT NULL AND personal_details->>'fullName' != '' THEN 
      CASE 
        WHEN array_length(string_to_array(trim(personal_details->>'fullName'), ' '), 1) = 3 THEN
          split_part(trim(personal_details->>'fullName'), ' ', 2)
        WHEN array_length(string_to_array(trim(personal_details->>'fullName'), ' '), 1) > 3 THEN
          array_to_string(
            (string_to_array(trim(personal_details->>'fullName'), ' '))[2:array_length(string_to_array(trim(personal_details->>'fullName'), ' '), 1)-1], 
            ' '
          )
        ELSE NULL
      END
    WHEN name IS NOT NULL AND name != '' THEN
      CASE 
        WHEN array_length(string_to_array(trim(name), ' '), 1) = 3 THEN
          split_part(trim(name), ' ', 2)
        WHEN array_length(string_to_array(trim(name), ' '), 1) > 3 THEN
          array_to_string(
            (string_to_array(trim(name), ' '))[2:array_length(string_to_array(trim(name), ' '), 1)-1], 
            ' '
          )
        ELSE NULL
      END
    ELSE NULL
  END
WHERE first_name IS NULL OR last_name IS NULL;

-- Step 3: Remove the deprecated name field
-- (Only after confirming data migration was successful)
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS name;

-- Step 4: Remove other deprecated fields that might still exist
-- Remove any legacy JSONB fields that are now fully replaced
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS personal_info,
DROP COLUMN IF EXISTS experience,
DROP COLUMN IF EXISTS education;

-- Step 5: Add comments to document the new structure
COMMENT ON COLUMN public.application_profiles.first_name IS 'First name extracted from resume - replaces deprecated name field';
COMMENT ON COLUMN public.application_profiles.middle_name IS 'Middle name(s) extracted from resume (nullable)';
COMMENT ON COLUMN public.application_profiles.last_name IS 'Last name extracted from resume - replaces deprecated name field';

-- Step 6: Add NOT NULL constraints after data migration (optional)
-- Uncomment these if you want to enforce that first_name and last_name are required
-- ALTER TABLE public.application_profiles ALTER COLUMN first_name SET NOT NULL;
-- ALTER TABLE public.application_profiles ALTER COLUMN last_name SET NOT NULL;

-- Step 7: Update table comment
COMMENT ON TABLE public.application_profiles IS 'Application profiles with individual name components. Deprecated name field removed, legacy JSONB fields cleaned up.';

-- Step 8: Verify the final schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    col_description(pg_class.oid, ordinal_position) as column_comment
FROM information_schema.columns 
LEFT JOIN pg_class ON pg_class.relname = table_name
WHERE table_name = 'application_profiles' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Step 9: Show sample data to verify migration
SELECT 
    id,
    first_name,
    middle_name,
    last_name,
    CONCAT_WS(' ', first_name, middle_name, last_name) as reconstructed_full_name,
    personal_details->>'fullName' as original_full_name
FROM public.application_profiles 
LIMIT 5; 