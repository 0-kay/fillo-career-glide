-- Migration: Enhance missed_fields table with status tracking and categorization
-- This migration adds new columns to support actionable suggestions and deduplication

-- Add status tracking
ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed', 'wont_fix'));

ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS resolved_note TEXT;

-- Add categorization and priority
ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS field_category TEXT CHECK (field_category IN ('education', 'experience', 'skills', 'personal', 'certifications', 'other'));

ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'));

-- Add structured action data
ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS suggested_action JSONB;
-- Structure: {
--   targetPath: "education_history[0].graduation_date",
--   missingDataType: "date",
--   exampleValue: "06/2020"
-- }

-- Add deduplication helper
ALTER TABLE public.missed_fields
ADD COLUMN IF NOT EXISTS field_signature TEXT;
-- Computed from: category + field_category + field name (for detecting duplicates)

-- Create index for efficient status filtering
CREATE INDEX IF NOT EXISTS idx_missed_fields_status ON public.missed_fields(status);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_missed_fields_category ON public.missed_fields(field_category);

-- Create index for deduplication
CREATE INDEX IF NOT EXISTS idx_missed_fields_signature ON public.missed_fields(field_signature);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_missed_fields_profile_status
ON public.missed_fields(profile_id, status, created_at DESC);

-- Add comment for documentation
COMMENT ON COLUMN public.missed_fields.status IS 'Status of the suggestion: pending, resolved, dismissed, or wont_fix';
COMMENT ON COLUMN public.missed_fields.field_category IS 'Category of the missing field for grouping';
COMMENT ON COLUMN public.missed_fields.priority IS 'Priority level for displaying to user';
COMMENT ON COLUMN public.missed_fields.suggested_action IS 'Structured data for quick-add functionality';
COMMENT ON COLUMN public.missed_fields.field_signature IS 'Hash for detecting duplicate suggestions';
