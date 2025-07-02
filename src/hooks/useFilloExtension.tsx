import { useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * Hook to integrate with the Fillo Chrome Extension
 * Automatically notifies the extension when user auth state changes
 */
export function useFilloExtension() {
  const { user, session } = useAuth();

  useEffect(() => {
    // Function to notify the extension of auth changes
    const notifyExtension = () => {
      try {
        // Check if the extension's content script is available
        if (typeof window.filloExtensionNotifyAuth === 'function') {
          const accessToken = session?.access_token;
          
          if (user && accessToken) {
            console.log('🔔 Notifying Fillo extension: User authenticated');
            window.filloExtensionNotifyAuth(accessToken);
          } else {
            console.log('🔔 Notifying Fillo extension: User logged out');
            window.filloExtensionNotifyAuth(null);
          }
        } else {
          // Extension not installed or content script not loaded
          console.log('🤖 Fillo extension not detected');
        }
      } catch (error) {
        console.log('❌ Error communicating with extension:', error);
      }
    };

    // Notify on auth state changes
    notifyExtension();

    // Also notify when the page becomes visible (user switches tabs)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setTimeout(notifyExtension, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, session]);

  return {
    extensionAvailable: typeof window.filloExtensionNotifyAuth === 'function'
  };
}

// Add TypeScript declaration for the global function
declare global {
  interface Window {
    filloExtensionNotifyAuth?: (token: string | null) => void;
  }
} 