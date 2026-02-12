import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';

/**
 * Hook to integrate with the Fillo Chrome Extension.
 * Keeps the browser extension in sync with the authentication state of the user.
 */
export function useFilloExtension() {
  const { user, session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [extensionAvailable, setExtensionAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let isMounted = true;

    const notifyExtension = () => {
      const filloNotify = window.filloExtensionNotifyAuth;
      const tokenToSend = user && accessToken ? accessToken : null;

      if (isMounted) {
        setExtensionAvailable(typeof filloNotify === 'function');
      }

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
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [accessToken, user]);

  return { extensionAvailable };
}

declare global {
  interface Window {
    filloExtensionNotifyAuth?: (token: string | null) => void;
  }
}
