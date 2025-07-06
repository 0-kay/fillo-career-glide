-- ========================================
-- SCHEMA VERIFICATION: application_profiles table
-- ========================================
-- Run this to check the current structure of the application_profiles table

-- Check current column count and structure
SELECT 
    'Current Schema' as status,
    COUNT(*) as total_columns
FROM information_schema.columns 
WHERE table_name = 'application_profiles' 
    AND table_schema = 'public';

-- List all current columns
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'application_profiles' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check for any data in the table
SELECT 
    COUNT(*) as total_rows,
    COUNT(DISTINCT user_id) as unique_users,
    MAX(created_at) as latest_profile,
    MIN(created_at) as earliest_profile
FROM public.application_profiles;

-- Check usage of legacy fields
SELECT 
    COUNT(*) as total_profiles,
    COUNT(CASE WHEN personal_info IS NOT NULL THEN 1 END) as has_personal_info,
    COUNT(CASE WHEN personal_details IS NOT NULL THEN 1 END) as has_personal_details,
    COUNT(CASE WHEN experience IS NOT NULL THEN 1 END) as has_experience,
    COUNT(CASE WHEN work_experience IS NOT NULL THEN 1 END) as has_work_experience,
    COUNT(CASE WHEN education IS NOT NULL THEN 1 END) as has_education,
    COUNT(CASE WHEN education_history IS NOT NULL THEN 1 END) as has_education_history
FROM public.application_profiles; 