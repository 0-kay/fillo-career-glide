import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';

// The content script heartbeats every 3s (see extension/content/auth-listener.js).
// Two missed beats before we call it "disconnected" tolerates a slow tab/GC pause
// without flapping the indicator.
const HEARTBEAT_TIMEOUT_MS = 8000;
const CONNECTION_CHECK_INTERVAL_MS = 2000;

/**
 * Hook to integrate with the Fillo Chrome Extension.
 * Keeps the browser extension in sync with the authentication state of the user,
 * and tracks a live connection status via the extension's heartbeat.
 */
export function useFilloExtension() {
  const { user, session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const lastSeenRef = useRef<number | null>(null);

  // Auth sync: push the current session token to the extension.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const notifyExtension = () => {
      const tokenToSend = user && accessToken ? accessToken : null;

      const filloNotify = window.filloExtensionNotifyAuth;
      if (typeof filloNotify === 'function') {
        filloNotify(tokenToSend);
      }

      window.postMessage(
        {
          source: 'web-app',
          type: 'SEND_TOKEN',
          token: tokenToSend,
        },
        '*',
      );
    };

    notifyExtension();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        notifyExtension();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [accessToken, user]);

  // Live connection status: listen for the extension's heartbeat rather than
  // inferring presence from a global function existing on the page.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) {
        return;
      }
      const message = event.data;
      if (message && message.source === 'fillo-extension' && message.type === 'HEARTBEAT') {
        lastSeenRef.current = Date.now();
        setLastSeen(lastSeenRef.current);
        setExtensionAvailable(true);
      }
    };

    window.addEventListener('message', handleMessage);

    // Ask for an immediate heartbeat instead of waiting for the extension's
    // own interval, so the indicator resolves quickly on page load/focus.
    const requestHeartbeat = () => {
      window.postMessage({ source: 'web-app', type: 'PING' }, '*');
    };
    requestHeartbeat();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        requestHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const staleCheck = setInterval(() => {
      const seen = lastSeenRef.current;
      if (seen === null || Date.now() - seen > HEARTBEAT_TIMEOUT_MS) {
        setExtensionAvailable(false);
      }
    }, CONNECTION_CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(staleCheck);
    };
  }, []);

  return { extensionAvailable, lastSeen };
}

declare global {
  interface Window {
    filloExtensionNotifyAuth?: (token: string | null) => void;
  }
}
