import { createApiClient, type ApiClient } from '@/api/client';

import { getConfig } from './config';
import { getAccessToken } from './supabase';

let api: ApiClient | null = null;

/** The API client for the signed-in User. */
export function getApi(): ApiClient {
  if (api === null) {
    api = createApiClient({ baseUrl: getConfig().apiUrl, getAccessToken });
  }
  return api;
}
