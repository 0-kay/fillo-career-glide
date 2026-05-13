(function(ns){
  // Auto-detect extension ID
  ns.config.EXTENSION_ID = chrome.runtime.id;

  ns.config.AI_CONFIG = {
    enabled: false,  // Disabled – use Supabase match data for field matching, no AI calls
    supabaseUrl: 'https://yuojrygcrcpajiglbekd.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck'
  };

  ns.config.ENABLE_LLM_PLAN_FLAG_NAME = '__ENABLE_LLM_PLAN';

  ns.config.MAPPING_SCORE_MIN = 5;

  // Log extension info on initialization
  console.log(`[Fillo] Extension ID: ${ns.config.EXTENSION_ID}`);
  console.log(`[Fillo] Version: ${chrome.runtime.getManifest().version}`);
})(window.__Fillo);