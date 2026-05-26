#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🧹 Starting database cleanup process...');

try {
  // Step 1: Run the migration
  console.log('📦 Running database migration...');
  execSync('npx supabase db push', { stdio: 'inherit' });
  
  // Step 2: Generate new TypeScript types
  console.log('🔧 Regenerating TypeScript types...');
  execSync('npx supabase gen types typescript --project-id yuojrygcrcpajiglbekd > src/integrations/supabase/types.ts', { stdio: 'inherit' });
  
  console.log('✅ Database cleanup completed successfully!');
  console.log('');
  console.log('📋 Summary of changes:');
  console.log('   • Removed 54 unused columns from application_profiles table');
  console.log('   • Updated TypeScript types to reflect new schema');
  console.log('   • Legacy JSONB fields marked as deprecated');
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   1. Test the application to ensure everything works');
  console.log('   2. Consider removing legacy JSONB fields in a future migration');
  console.log('   3. Update any remaining code references if needed');
  
} catch (error) {
  console.error('❌ Error during cleanup:', error.message);
  process.exit(1);
} 