
-- Update the application_profiles table to store comprehensive resume data
ALTER TABLE public.application_profiles 
ADD COLUMN IF NOT EXISTS personal_details JSONB,
ADD COLUMN IF NOT EXISTS education_history JSONB,
ADD COLUMN IF NOT EXISTS work_experience JSONB,
ADD COLUMN IF NOT EXISTS technical_skills JSONB,
ADD COLUMN IF NOT EXISTS soft_skills JSONB,
ADD COLUMN IF NOT EXISTS tools_technologies JSONB,
ADD COLUMN IF NOT EXISTS certifications_licenses JSONB,
ADD COLUMN IF NOT EXISTS awards_honors JSONB,
ADD COLUMN IF NOT EXISTS projects JSONB,
ADD COLUMN IF NOT EXISTS languages JSONB,
ADD COLUMN IF NOT EXISTS volunteer_experience JSONB,
ADD COLUMN IF NOT EXISTS job_preferences JSONB,
ADD COLUMN IF NOT EXISTS resume_metadata JSONB;

-- Update the existing columns to be more specific
COMMENT ON COLUMN public.application_profiles.personal_info IS 'Basic personal information (legacy)';
COMMENT ON COLUMN public.application_profiles.personal_details IS 'Comprehensive personal details including full name parts, contact info, etc.';
COMMENT ON COLUMN public.application_profiles.education_history IS 'Array of education entries with detailed information';
COMMENT ON COLUMN public.application_profiles.work_experience IS 'Array of work experience entries with comprehensive details';
COMMENT ON COLUMN public.application_profiles.technical_skills IS 'Technical skills with proficiency levels';
COMMENT ON COLUMN public.application_profiles.soft_skills IS 'Soft skills and interpersonal abilities';
COMMENT ON COLUMN public.application_profiles.tools_technologies IS 'Tools and technologies with proficiency levels';
COMMENT ON COLUMN public.application_profiles.certifications_licenses IS 'Certifications and licenses with expiration dates';
COMMENT ON COLUMN public.application_profiles.awards_honors IS 'Awards and honors received';
COMMENT ON COLUMN public.application_profiles.projects IS 'Projects with descriptions and technologies used';
COMMENT ON COLUMN public.application_profiles.languages IS 'Languages with proficiency levels';
COMMENT ON COLUMN public.application_profiles.volunteer_experience IS 'Volunteer work and community involvement';
COMMENT ON COLUMN public.application_profiles.job_preferences IS 'Job search preferences and requirements';
COMMENT ON COLUMN public.application_profiles.resume_metadata IS 'Resume file information and parsing status';
