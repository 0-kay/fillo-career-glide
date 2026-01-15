-- Add missing UPDATE policy for missed_fields table
-- This allows users to update (resolve/dismiss) their own missed field suggestions

CREATE POLICY "Users can update their own missed fields"
ON public.missed_fields FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
