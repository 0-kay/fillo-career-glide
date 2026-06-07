// Auth Listener Content Script
// Listens for authentication messages from the Fillo web app

(function() {
  console.log('[Fillo Auth] Listener initialized on:', window.location.hostname);

  // Listen for postMessage from the web app
  window.addEventListener('message', async (event) => {
    // Only accept messages from the same origin (localhost)
    if (event.source !== window) {
      return;
    }

    const message = event.data;

    // Check if this is a Fillo auth message
    if (message && message.source === 'web-app' && message.type === 'SEND_TOKEN') {
      console.log('[Fillo Auth] Received token from web app');

      const token = message.token;

      if (token) {
        try {
          // Store the token in chrome.storage
          await chrome.storage.local.set({ FILLO_AUTH_TOKEN: token });
          console.log('[Fillo Auth] ✅ Token stored successfully');

          // Notify the web app that the token was received
          window.postMessage({
            source: 'fillo-extension',
            type: 'TOKEN_RECEIVED',
            success: true
          }, '*');

          // Show a notification
          const notification = document.createElement('div');
          notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          `;
          notification.textContent = '✅ Fillo extension authenticated!';
          document.body.appendChild(notification);
          setTimeout(() => {
            if (notification.parentNode) {
              notification.parentNode.removeChild(notification);
            }
          }, 3000);

        } catch (error) {
          console.error('[Fillo Auth] ❌ Failed to store token:', error);
          window.postMessage({
            source: 'fillo-extension',
            type: 'TOKEN_RECEIVED',
            success: false,
            error: error.message
          }, '*');
        }
      } else {
        console.log('[Fillo Auth] Token is null, clearing storage');
        try {
          await chrome.storage.local.remove('FILLO_AUTH_TOKEN');
          console.log('[Fillo Auth] ✅ Token cleared');
        } catch (error) {
          console.error('[Fillo Auth] ❌ Failed to clear token:', error);
        }
      }
    }
  });

  // Also expose a global function for direct token setting
  window.filloExtensionNotifyAuth = async function(token) {
    console.log('[Fillo Auth] Direct notification received');
    if (token) {
      try {
        await chrome.storage.local.set({ FILLO_AUTH_TOKEN: token });
        console.log('[Fillo Auth] ✅ Token stored via direct call');
        return true;
      } catch (error) {
        console.error('[Fillo Auth] ❌ Failed to store token:', error);
        return false;
      }
    } else {
      try {
        await chrome.storage.local.remove('FILLO_AUTH_TOKEN');
        console.log('[Fillo Auth] ✅ Token cleared via direct call');
        return true;
      } catch (error) {
        console.error('[Fillo Auth] ❌ Failed to clear token:', error);
        return false;
      }
    }
  };

  console.log('[Fillo Auth] ✅ Listener ready');
})();
