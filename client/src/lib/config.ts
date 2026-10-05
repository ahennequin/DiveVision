/**
 * The client's whole configuration: public values only, inlined at build time
 * from `EXPO_PUBLIC_*` variables (see `.env.example`).
 *
 * The client never holds the Supabase service-role/secret key: it bypasses RLS,
 * and everything compiled into a web or app bundle is public.
 */
export type ClientConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiUrl: string;
};

export type ConfigResult = { config: ClientConfig; error: null } | { config: null; error: string };

type Env = Record<string, string | undefined>;

/** Whether `key` is a Supabase key that bypasses RLS (secret or service-role). */
export function isPrivilegedSupabaseKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) {
    return true;
  }
  // Legacy keys are JWTs whose payload names the Postgres role they act as.
  const payload = key.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

export function readConfig(env: Env): ConfigResult {
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const apiUrl = (env.EXPO_PUBLIC_API_URL?.trim() ?? '').replace(/\/+$/, '');

  const missing = [
    ['EXPO_PUBLIC_SUPABASE_URL', supabaseUrl],
    ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', supabasePublishableKey],
    ['EXPO_PUBLIC_API_URL', apiUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return { config: null, error: `Missing configuration: ${missing.join(', ')}` };
  }
  if (isPrivilegedSupabaseKey(supabasePublishableKey)) {
    return {
      config: null,
      error:
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a secret/service-role key. ' +
        'Use the publishable (anon) key; the secret key must never reach the client.',
    };
  }
  return { config: { supabaseUrl, supabasePublishableKey, apiUrl }, error: null };
}

// Expo inlines `process.env.EXPO_PUBLIC_*` only when each one is read by name.
export const configResult = readConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

/** The validated configuration; only call once `configResult.error` is null. */
export function getConfig(): ClientConfig {
  if (configResult.config === null) {
    throw new Error(configResult.error);
  }
  return configResult.config;
}
