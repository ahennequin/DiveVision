import createClient, { type Middleware } from 'openapi-fetch';

import type { components, paths } from './schema';

export type PhotoCreated = components['schemas']['PhotoCreated'];

/** What `FormData.append` takes for a file: a web `Blob`, or a native `{ uri, name, type }`. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiClientOptions = {
  baseUrl: string;
  /** The User's current Supabase access token, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (status === 401) {
    return 'Your session has expired. Please sign in again.';
  }
  return `Request failed (${status})`;
}

/**
 * The DiveVision API, typed from FastAPI's OpenAPI schema (`schema.d.ts`).
 *
 * Only uploads and deletions go through it; the client reads its Photos
 * straight from Supabase (see `lib/photos.ts`).
 */
export function createApiClient({ baseUrl, getAccessToken, fetch: fetchImpl }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, fetch: fetchImpl });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await getAccessToken();
      if (token === null) {
        throw new ApiError(401, 'You are signed out.');
      }
      request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
  };
  client.use(auth);

  return {
    /** Store an Original and queue its enhancement; resolves once it is `pending`. */
    async uploadPhoto(file: UploadFile, fileName: string): Promise<PhotoCreated> {
      const { data, error, response } = await client.POST('/photos/', {
        // The schema types the binary part as a string; the serializer below
        // sends the real file as multipart form data.
        body: { file: file as unknown as string },
        bodySerializer() {
          const form = new FormData();
          // React Native's FormData takes `{ uri, name, type }` for files.
          form.append('file', file as Blob, fileName);
          return form;
        },
      });
      if (data === undefined) {
        throw new ApiError(response.status, errorMessage(response.status, error));
      }
      return data;
    },

    async deletePhoto(photoId: string): Promise<void> {
      const { error, response } = await client.DELETE('/photos/{photo_id}/', {
        params: { path: { photo_id: photoId } },
      });
      if (!response.ok) {
        throw new ApiError(response.status, errorMessage(response.status, error));
      }
    },

    /** Erase the User's account, Photos included. */
    async deleteAccount(): Promise<void> {
      const { error, response } = await client.DELETE('/account/');
      if (!response.ok) {
        throw new ApiError(response.status, errorMessage(response.status, error));
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
