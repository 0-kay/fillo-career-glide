import { useState, useEffect, createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Type declaration for Chrome extension API
declare global {
  interface Window {
    chrome?: {
      storage?: {
        local?: {
          set: (items: Record<string, any>) => Promise<void>;
          remove: (keys: string[]) => Promise<void>;
        };
      };
    };
  }
}

console.log('Supabase client initialized for authentication');

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simple function to save auth token to Chrome storage
    const saveTokenToChrome = (session: Session | null) => {
      if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
        if (session?.access_token) {
          console.log('💾 Saving token to Chrome storage...');
          window.chrome.storage.local.set({
            FILLO_AUTH_TOKEN: session.access_token
          }).then(() => {
            console.log('✅ Token saved to Chrome storage');
          }).catch((error) => {
            console.log('❌ Failed to save token:', error);
          });
        } else {
          console.log('🗑️ Clearing token from Chrome storage...');
          window.chrome.storage.local.remove(['FILLO_AUTH_TOKEN']).then(() => {
            console.log('✅ Token cleared from Chrome storage');
          }).catch((error) => {
            console.log('❌ Failed to clear token:', error);
          });
        }
      }
    };

    // Auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('🔐 Auth state changed:', event);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Google/Apple signups skip the confirmation email, so ask the server to tell the owner.
        if (event === 'SIGNED_IN' && session && session.user.app_metadata?.provider !== 'email') {
          // Deferred: supabase calls made synchronously inside this listener can stall on the auth lock.
          setTimeout(() => {
            supabase.functions
              .invoke('notify-signup', { body: { domain: window.location.host } })
              .then(({ data, error }) => console.log('notify-signup:', error ?? data))
              .catch((e) => console.error('notify-signup failed', e));
          }, 0);
        }

        // Always save token to Chrome storage on any auth change
        saveTokenToChrome(session);
      }
    );

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('🔐 Initial session loaded');
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      // Save initial token to Chrome storage
      saveTokenToChrome(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    // Land on the dashboard of whichever domain the user signed up on (must be in Supabase's redirect allow-list).
    const redirectUrl = `${window.location.origin}/dashboard`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName
        }
      }
    });
    if (error) {
      console.error('Sign up error:', error);
    } else {
      console.log('User signed up successfully');
    }
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) {
      console.error('Sign in error:', error);
    } else {
      console.log('User signed in successfully');
    }
    return { error };
  };

  const signInWithOAuth = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard` }
    });
    if (error) console.error(`${provider} sign in error:`, error);
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    console.log('User signed out');
  };

  const value = {
    user,
    session,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
