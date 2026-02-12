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
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simple function to save auth token to Chrome extension
    const saveTokenToChrome = (session: Session | null) => {
      if (typeof window !== 'undefined') {
        const tokenToSend = session?.access_token ?? null;
        console.log(tokenToSend ? '🔑 Notifying extension of new token' : '🗑️ Notifying extension to clear token');

        // Notify via postMessage (auth-sync.js will catch this)
        window.postMessage(
          {
            source: 'web-app',
            type: 'SEND_TOKEN',
            token: tokenToSend,
          },
          '*'
        );

        // Also try direct call if extension exposed it
        if (typeof window.filloExtensionNotifyAuth === 'function') {
          window.filloExtensionNotifyAuth(tokenToSend);
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
    const redirectUrl = `${window.location.origin}/`;

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

  const signOut = async () => {
    await supabase.auth.signOut();
    console.log('User signed out');
  };

  const value = {
    user,
    session,
    signUp,
    signIn,
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
