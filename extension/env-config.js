// Environment configuration for the extension
// This file should be updated with your actual values

const ENV_CONFIG = {
  // Extension ID - auto-detected at runtime
  EXTENSION_ID: chrome.runtime.id,

  // Supabase URL - update this with your Supabase project URL
  SUPABASE_URL: 'https://yuojrygcrcpajiglbekd.supabase.co',

  // Web app origin - update this with your deployed web app URL
  WEB_APP_ORIGIN: 'http://localhost:8080',

  // Alternative origins for development
  ALLOWED_ORIGINS: [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    // Add your production domain here when deployed
    // 'https://app.fillo.com'
  ]
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ENV_CONFIG;
}
