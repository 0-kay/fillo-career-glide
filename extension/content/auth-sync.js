/**
 * Fillo Auth Sync Content Script
 * Runs only on http://localhost:8080 (the web app)
 * Automatically syncs Supabase auth token to extension storage
 */

(function() {
  console.log('🔄 Fillo Auth Sync: Active on web app');

  // 1. Listen for messages from the web app
  window.addEventListener('message', (event) => {
    // Only accept messages from our own window
    if (event.source !== window) return;

    if (event.data && event.data.source === 'web-app' && event.data.type === 'SEND_TOKEN') {
      const token = event.data.token;
      if (token) {
        console.log('🔑 Fillo Auth Sync: Received token from web app');
        chrome.runtime.sendMessage({ action: 'SYNC_AUTH_TOKEN', token: token }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Sync failed:', chrome.runtime.lastError.message);
          } else {
            console.log('✅ Fillo Auth Sync: Token synced via message');
          }
        });
      }
    }
  });

  // 2. Periodic check of localStorage (backup/alternative)
  // Scalable to different Supabase project IDs or renamed keys
  function checkLocalStorage() {
    try {
      // Look for any supabase auth token in localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('auth-token') && key.includes('supabase')) {
          const data = localStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              chrome.runtime.sendMessage({
                action: 'SYNC_AUTH_TOKEN',
                token: parsed.access_token
              });
              return true;
            }
          }
        }
      }
    } catch (e) {
      // Silently fail, likely JSON parse error
    }
    return false;
  }

  // Check on load
  checkLocalStorage();

  // And periodically check if user signs in
  setInterval(checkLocalStorage, 10000); // Every 10 seconds

  // 3. Expose a helper on window for the web app to call directly if needed
  window.filloExtensionNotifyAuth = function(token) {
    console.log('🔑 Fillo Auth Sync: Direct notification received');
    chrome.runtime.sendMessage({ action: 'SYNC_AUTH_TOKEN', token: token });
  };
})();
