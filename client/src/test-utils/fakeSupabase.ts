import type { SupabaseClient } from '@supabase/supabase-js';

import type { Photo, PhotoChange } from '@/lib/photos';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

export function makePhoto(overrides: Partial<Photo> = {}): Photo {
  const id = overrides.id ?? '22222222-2222-4222-8222-222222222222';
  const userId = overrides.user_id ?? USER_ID;
  return {
    id,
    user_id: userId,
    original_path: `${userId}/${id}.jpg`,
    processed_path: null,
    status: 'pending',
    model_name: 'U-Shape',
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

/**
 * An offline stand-in for the parts of supabase-js the client uses. Its
 * `photos` table returns every row matching the query's filters, like a
 * project where RLS would also let other rows through (e.g. future public
 * Photos), so tests prove the client filters by `user_id` itself.
 */
export function fakeSupabase(rows: Photo[] = []) {
  const filters: [string, unknown][][] = [];
  const channelFilters: Record<string, unknown>[] = [];
  const signed: { bucket: string; paths: string[] }[] = [];
  let listeners: ((change: PhotoChange) => void)[] = [];
  let subscribedCallbacks: ((status: string) => void)[] = [];

  const query = () => {
    const applied: [string, unknown][] = [];
    filters.push(applied);
    const matching = () =>
      rows.filter((row) => applied.every(([column, value]) => row[column as keyof Photo] === value));
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        applied.push([column, value]);
        return builder;
      },
      range: async (from: number, to: number) => ({
        data: matching().slice(from, to + 1),
        error: null,
      }),
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      if (table !== 'photos') throw new Error(`unexpected table ${table}`);
      return query();
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => {
          signed.push({ bucket, paths });
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://signed.test/${bucket}/${path}`,
              error: null,
            })),
            error: null,
          };
        },
      }),
    },
    channel: () => {
      const channel = {
        on: (_type: string, filter: Record<string, unknown>, cb: (c: PhotoChange) => void) => {
          channelFilters.push(filter);
          listeners.push(cb);
          return channel;
        },
        subscribe: (cb?: (status: string) => void) => {
          if (cb) subscribedCallbacks.push(cb);
          return channel;
        },
      };
      return channel;
    },
    removeChannel: jest.fn(async () => {
      listeners = [];
      subscribedCallbacks = [];
      return 'ok';
    }),
  };

  return {
    client: client as unknown as SupabaseClient,
    rows,
    filters,
    channelFilters,
    signed,
    /** Deliver a Realtime change to every live subscription. */
    emit: (change: Partial<PhotoChange> & { eventType: PhotoChange['eventType'] }) =>
      listeners.forEach((listener) => listener(change as PhotoChange)),
    /** Report every channel as connected. */
    connect: () => subscribedCallbacks.forEach((cb) => cb('SUBSCRIBED')),
    get subscriptions() {
      return listeners.length;
    },
  };
}
