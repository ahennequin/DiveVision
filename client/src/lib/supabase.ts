import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { authStorage } from './authStorage';
import { getConfig } from './config';

let client: SupabaseClient | null = null;

/**
 * The app's Supabase client, signed in as the current User (publishable key +
 * their session). Created on first use, so a misconfigured build can still
 * render its configuration error instead of crashing on import.
 */
export function getSupabase(): SupabaseClient {
  if (client === null) {
    const { supabaseUrl, supabasePublishableKey } = getConfig();
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        // On web, finish sign-up when the email confirmation link lands here.
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
    if (Platform.OS !== 'web') {
      // Native apps only refresh tokens while in the foreground.
      AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          client?.auth.startAutoRefresh();
        } else {
          client?.auth.stopAutoRefresh();
        }
      });
    }
  }
  return client;
}

/** The current User's access token, refreshed by supabase-js if it expired. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
