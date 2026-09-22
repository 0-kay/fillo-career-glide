(function(ns){
  // Auto-detect extension ID
  ns.config.EXTENSION_ID = chrome.runtime.id;

  ns.config.AI_CONFIG = {
    enabled: false,  // Disabled – use Supabase match data for field matching, no AI calls
    fallbackEnabled: false,  // After all rules run, ask the AI to fill fields that are still empty
    supabaseUrl: 'https://yuojrygcrcpajiglbekd.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck'
  };

  ns.config.MATCH_CONFIG_ENDPOINT = `${ns.config.AI_CONFIG.supabaseUrl}/functions/v1/match-config`;

  ns.config.ENABLE_LLM_PLAN_FLAG_NAME = '__ENABLE_LLM_PLAN';

  ns.config.MAPPING_SCORE_MIN = 5;

  // When false (default), filling only runs when the user clicks the Fill button.
  // When true, a MutationObserver re-fills automatically as new fields render
  // (e.g. dependent Workday fields after selecting a country).
  ns.config.AUTO_REFILL_ON_MUTATION = false;

  // Log extension info on initialization
  console.log(`[Fillo] Extension ID: ${ns.config.EXTENSION_ID}`);
  console.log(`[Fillo] Version: ${chrome.runtime.getManifest().version}`);
})(window.__Fillo);
