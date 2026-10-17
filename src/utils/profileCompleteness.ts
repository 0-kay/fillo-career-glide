// The scorer lives with the server pipeline (which writes the score after parsing);
// the app re-uses it so the dashboard and editor agree with what the server stored.
export * from '../../supabase/functions/_shared/resume/completeness';
