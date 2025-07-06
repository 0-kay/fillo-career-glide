# Migration Fix: SQL Syntax Error

## Issue
The original migration had a syntax error because `references` is a reserved keyword in SQL.

## Error
```
ERROR:  42601: syntax error at or near "references"
LINE 85: ADD COLUMN IF NOT EXISTS references JSONB,
```

## Solution
Changed the column name from `references` to `reference_contacts` in both migration files:

### Files Updated:
- `MANUAL_MIGRATION.sql` - Fixed column name
- `supabase/migrations/20250101000000-cleanup-unused-columns.sql` - Fixed column name  
- `src/hooks/useProfiles.tsx` - Updated TypeScript interface

### Column Name Change:
- ❌ `references JSONB` (reserved keyword)
- ✅ `reference_contacts JSONB` (safe column name)

## Status
✅ **FIXED** - The migration files are now ready to run without syntax errors.

## Next Steps
1. Run the updated `MANUAL_MIGRATION.sql` in your Supabase SQL Editor
2. The migration should now complete successfully
3. Verify the results with the verification script 