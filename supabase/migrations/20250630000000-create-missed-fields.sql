-- Create missed_fields table to store unfilled form fields for AI analysis
CREATE TABLE IF NOT EXISTS public.missed_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.application_profiles(id) ON DELETE CASCADE,
    field_data JSONB NOT NULL,
    page_url TEXT,
    ai_suggestion TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.missed_fields ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Users can insert their own missed fields"
ON public.missed_fields FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own missed fields"
ON public.missed_fields FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own missed fields"
ON public.missed_fields FOR DELETE
USING (auth.uid() = user_id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_missed_fields_profile_id ON public.missed_fields(profile_id);
CREATE INDEX IF NOT EXISTS idx_missed_fields_user_id ON public.missed_fields(user_id);
