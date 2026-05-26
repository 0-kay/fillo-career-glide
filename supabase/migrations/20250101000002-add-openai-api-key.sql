-- Migration: Add OpenAI API key to profiles table for AI-powered form filling
-- This enables users to configure their OpenAI API key for intelligent field matching

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- Add comment to document the field
COMMENT ON COLUMN public.profiles.openai_api_key IS 'OpenAI API key for AI-powered form filling in browser extension';

-- Update the RLS policy to allow users to update their own API key
-- (The existing policies already cover this, but making it explicit)

-- Verify the addition
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    col_description(pg_class.oid, ordinal_position) as column_comment
FROM information_schema.columns 
LEFT JOIN pg_class ON pg_class.relname = table_name
WHERE table_name = 'profiles' 
    AND table_schema = 'public'
    AND column_name = 'openai_api_key'; 