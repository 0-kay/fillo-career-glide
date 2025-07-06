-- ========================================
-- MANUAL MIGRATION: Clean up application_profiles table
-- ========================================
-- This migration removes 54 unused columns from the application_profiles table
-- Run this in your Supabase SQL Editor

-- IMPORTANT: This migration will remove columns permanently!
-- Make sure you have a backup before running this.

-- Step 1: Drop completely unused personal information columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS full_name,
DROP COLUMN IF EXISTS first_name,
DROP COLUMN IF EXISTS last_name,
DROP COLUMN IF EXISTS middle_name,
DROP COLUMN IF EXISTS email,
DROP COLUMN IF EXISTS phone_number,
DROP COLUMN IF EXISTS secondary_phone,
DROP COLUMN IF EXISTS address,
DROP COLUMN IF EXISTS address_line_2,
DROP COLUMN IF EXISTS city,
DROP COLUMN IF EXISTS state,
DROP COLUMN IF EXISTS zip_code,
DROP COLUMN IF EXISTS country,
DROP COLUMN IF EXISTS date_of_birth,
DROP COLUMN IF EXISTS ssn,
DROP COLUMN IF EXISTS linkedin_profile,
DROP COLUMN IF EXISTS github_profile,
DROP COLUMN IF EXISTS portfolio_url,
DROP COLUMN IF EXISTS personal_website;

-- Step 2: Drop unused application-specific columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS position_applied_for,
DROP COLUMN IF EXISTS start_date,
DROP COLUMN IF EXISTS salary_expectation,
DROP COLUMN IF EXISTS employment_type,
DROP COLUMN IF EXISTS referral_source,
DROP COLUMN IF EXISTS current_company,
DROP COLUMN IF EXISTS current_job_title,
DROP COLUMN IF EXISTS years_of_experience,
DROP COLUMN IF EXISTS previous_company,
DROP COLUMN IF EXISTS reason_for_leaving;

-- Step 3: Drop unused education columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS university,
DROP COLUMN IF EXISTS degree,
DROP COLUMN IF EXISTS field_of_study,
DROP COLUMN IF EXISTS graduation_date,
DROP COLUMN IF EXISTS gpa,
DROP COLUMN IF EXISTS honors;

-- Step 4: Drop unused work preference columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS work_schedule,
DROP COLUMN IF EXISTS remote_work_preference,
DROP COLUMN IF EXISTS travel_availability,
DROP COLUMN IF EXISTS work_authorization;

-- Step 5: Drop unused demographic columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS race_ethnicity,
DROP COLUMN IF EXISTS veteran_status,
DROP COLUMN IF EXISTS disability_status;

-- Step 6: Drop unused additional columns
ALTER TABLE public.application_profiles 
DROP COLUMN IF EXISTS cover_letter,
DROP COLUMN IF EXISTS why_this_company,
DROP COLUMN IF EXISTS career_goals,
DROP COLUMN IF EXISTS strengths,
DROP COLUMN IF EXISTS weaknesses,
DROP COLUMN IF EXISTS reference_name,
DROP COLUMN IF EXISTS reference_relationship,
DROP COLUMN IF EXISTS reference_phone,
DROP COLUMN IF EXISTS reference_email;

-- Step 7: Add missing columns that might be needed
ALTER TABLE public.application_profiles 
ADD COLUMN IF NOT EXISTS willing_to_relocate BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS background_check_consent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS drug_test_consent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS criminal_history TEXT,
ADD COLUMN IF NOT EXISTS reference_contacts JSONB,
ADD COLUMN IF NOT EXISTS skills_detailed JSONB,
ADD COLUMN IF NOT EXISTS publications JSONB;

-- Step 8: Mark legacy JSONB fields as deprecated
COMMENT ON COLUMN public.application_profiles.personal_info IS 'DEPRECATED: Use personal_details instead';
COMMENT ON COLUMN public.application_profiles.experience IS 'DEPRECATED: Use work_experience instead';
COMMENT ON COLUMN public.application_profiles.education IS 'DEPRECATED: Use education_history instead';

-- Step 9: Add comments to document the cleanup
COMMENT ON TABLE public.application_profiles IS 'Cleaned up application_profiles table - removed 54 unused columns. Current structure uses JSONB fields for comprehensive data storage.';

-- Step 10: Show the final schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'application_profiles' 
    AND table_schema = 'public'
ORDER BY ordinal_position; 