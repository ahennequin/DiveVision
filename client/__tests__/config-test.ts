import { isPrivilegedSupabaseKey, readConfig } from '@/lib/config';

const base64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: object) => ['header', base64url(JSON.stringify(claims)), 'signature'].join('.');

const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
  EXPO_PUBLIC_API_URL: 'http://localhost:8000/',
};

describe('readConfig', () => {
  it('accepts the public values and trims the API URL', () => {
    expect(readConfig(valid)).toEqual({
      config: {
        supabaseUrl: 'https://project.supabase.co',
        supabasePublishableKey: 'sb_publishable_abc',
        apiUrl: 'http://localhost:8000',
      },
      error: null,
    });
  });

  it('names every missing variable', () => {
    const result = readConfig({ EXPO_PUBLIC_API_URL: 'http://localhost:8000' });
    expect(result.error).toBe(
      'Missing configuration: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  });

  it.each([
    ['a secret key', 'sb_secret_abc'],
    ['a legacy service-role JWT', jwt({ role: 'service_role' })],
  ])('refuses %s', (_name, key) => {
    const result = readConfig({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
    expect(result.config).toBeNull();
    expect(result.error).toMatch(/must never reach the client/);
  });
});

describe('isPrivilegedSupabaseKey', () => {
  it('allows publishable and legacy anon keys', () => {
    expect(isPrivilegedSupabaseKey('sb_publishable_abc')).toBe(false);
    expect(isPrivilegedSupabaseKey(jwt({ role: 'anon' }))).toBe(false);
    expect(isPrivilegedSupabaseKey('not.a-jwt.at-all')).toBe(false);
  });
});
