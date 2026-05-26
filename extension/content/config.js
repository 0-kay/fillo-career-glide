(function(ns){
  ns.config.AI_CONFIG = {
    enabled: true,
    supabaseUrl: 'https://yuojrygcrcpajiglbekd.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck'
  };

  ns.config.ENABLE_LLM_PLAN_FLAG_NAME = '__ENABLE_LLM_PLAN';

  ns.config.SEMANTIC_SCORE_THRESHOLD = 0.6;
  ns.config.MAPPING_SCORE_MIN = 5;
})(window.__Fillo);