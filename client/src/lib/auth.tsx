import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { getSupabase } from './supabase';

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** Tracks the Supabase session; screens read it with `useSession`. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, loading: false });
      })
      .catch(() => {
        if (active) setState({ session: null, loading: false });
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthState {
  return useContext(AuthContext);
}

/** The signed-in User's id; only use under the signed-in routes. */
export function useUserId(): string {
  const { session } = useSession();
  if (session === null) {
    throw new Error('useUserId needs a signed-in User');
  }
  return session.user.id;
}

/** Outcome of a sign-up: signed straight in, or waiting on email confirmation. */
export type SignUpResult = 'signed-in' | 'confirm-email';

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  return data.session ? 'signed-in' : 'confirm-email';
}

/**
 * Sign out on this device only. `local` scope also works after the account was
 * deleted, when the server no longer knows the session.
 */
export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut({ scope: 'local' });
}
