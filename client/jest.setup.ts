// Placeholder public config so modules that read it at import time load in
// tests; nothing here ever reaches a real Supabase project or API.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.EXPO_PUBLIC_API_URL = 'https://api.test';

// The native image module is not available under Jest; report a 4:3 image.
jest
  .spyOn(require('react-native').Image, 'getSize')
  .mockImplementation((...args: unknown[]) => (args[1] as (w: number, h: number) => void)(400, 300));
