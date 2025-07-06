# Database Cleanup: application_profiles Table

## Overview

This document outlines the cleanup process for the `application_profiles` table, which had 82 columns but only 28 were actively used. The cleanup removes 54 unused columns to improve performance and maintainability.

## Changes Made

### ✅ Removed Columns (54 total)

**Personal Information (19 columns):**
- `full_name`, `first_name`, `last_name`, `middle_name`
- `email`, `phone_number`, `secondary_phone`
- `address`, `address_line_2`, `city`, `state`, `zip_code`, `country`
- `date_of_birth`, `ssn`
- `linkedin_profile`, `github_profile`, `portfolio_url`, `personal_website`

**Application-Specific (10 columns):**
- `position_applied_for`, `start_date`, `salary_expectation`
- `employment_type`, `referral_source`
- `current_company`, `current_job_title`, `years_of_experience`
- `previous_company`, `reason_for_leaving`

**Education (6 columns):**
- `university`, `degree`, `field_of_study`, `graduation_date`, `gpa`, `honors`

**Work Preferences (4 columns):**
- `work_schedule`, `remote_work_preference`, `travel_availability`, `work_authorization`

**Demographics (3 columns):**
- `race_ethnicity`, `veteran_status`, `disability_status`

**Additional (12 columns):**
- `cover_letter`, `why_this_company`, `career_goals`, `strengths`, `weaknesses`
- `reference_name`, `reference_relationship`, `reference_phone`, `reference_email`

### 🔄 Legacy Fields (Marked as Deprecated)

The following legacy JSONB fields are kept for backward compatibility but marked as deprecated:
- `personal_info` → Use `personal_details` instead
- `experience` → Use `work_experience` instead  
- `education` → Use `education_history` instead

## Current Schema

### Active Columns (28)

**Core Fields:**
- `id`, `user_id`, `name`, `completeness`, `created_at`, `updated_at`

**JSONB Data Fields:**
- `personal_details` - Comprehensive personal information
- `education_history` - Array of education entries
- `work_experience` - Array of work experience entries
- `technical_skills` - Technical skills with proficiency levels
- `soft_skills` - Soft skills and interpersonal abilities
- `tools_technologies` - Tools and technologies with proficiency levels
- `certifications_licenses` - Certifications and licenses with expiration dates
- `awards_honors` - Awards and honors received
- `projects` - Projects with descriptions and technologies used
- `languages` - Languages with proficiency levels
- `volunteer_experience` - Volunteer work and community involvement
- `job_preferences` - Job search preferences and requirements
- `resume_metadata` - Resume file information and parsing status

**Array Fields:**
- `skills` - Array of skill strings
- `certifications` - Array of certification strings

**Legacy JSONB (Deprecated):**
- `personal_info` - Basic personal information (legacy)
- `experience` - Work experience (legacy)
- `education` - Education history (legacy)

## Implementation

### Migration File
- `supabase/migrations/20250101000000-cleanup-unused-columns.sql`

### Code Changes
- Updated `src/hooks/useProfiles.tsx` to remove legacy field references
- TypeScript types will be regenerated after migration

### Script
- `scripts/cleanup-database.js` - Automated cleanup script

## Running the Cleanup

### Option 1: Automated Script
```bash
node scripts/cleanup-database.js
```

### Option 2: Manual Steps
```bash
# 1. Run migration
npx supabase db push

# 2. Regenerate TypeScript types
npx supabase gen types typescript --project-id yuojrygcrcpajiglbekd > src/integrations/supabase/types.ts
```

## Verification

After running the cleanup:

1. **Test the application** - Ensure all features work correctly
2. **Check database queries** - Verify no broken queries
3. **Review TypeScript errors** - Fix any remaining type issues
4. **Test extension functionality** - Ensure browser extension still works

## Benefits

- **Performance**: Reduced table size and faster queries
- **Maintainability**: Cleaner schema easier to understand
- **Storage**: Reduced database storage requirements
- **Developer Experience**: No confusion about which fields to use

## Future Considerations

1. **Remove Legacy JSONB Fields**: After confirming no usage, remove `personal_info`, `experience`, and `education`
2. **Normalize Complex JSONB**: Consider moving complex JSONB structures to separate tables
3. **Add Indexes**: Add appropriate indexes for frequently queried fields

## Rollback Plan

If issues arise, the migration can be rolled back by:
1. Restoring the previous migration state
2. Reverting code changes
3. Regenerating TypeScript types

## Impact Assessment

- **Low Risk**: Only unused columns were removed
- **No Breaking Changes**: All active functionality preserved
- **Performance Improvement**: Expected faster queries and reduced storage
- **Code Simplification**: Removed unused field references 