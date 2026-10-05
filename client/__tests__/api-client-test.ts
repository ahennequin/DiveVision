import { ApiError, createApiClient } from '@/api/client';

const BASE_URL = 'https://api.test';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';

function setup({ token = 'access-token' as string | null, status = 202, body = {} as object } = {}) {
  const requests: Request[] = [];
  const fetch = jest.fn(async (input: Request) => {
    requests.push(input);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const api = createApiClient({
    baseUrl: BASE_URL,
    getAccessToken: async () => token,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { api, fetch, requests };
}

describe('createApiClient', () => {
  it('uploads the photo as multipart form data with the bearer token', async () => {
    const { api, requests } = setup({ body: { id: PHOTO_ID, status: 'pending' } });
    const file = new Blob(['jpeg bytes'], { type: 'image/jpeg' });

    await expect(api.uploadPhoto(file, 'reef.jpg')).resolves.toEqual({
      id: PHOTO_ID,
      status: 'pending',
    });

    const [request] = requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${BASE_URL}/photos/`);
    expect(request.headers.get('Authorization')).toBe('Bearer access-token');
    // React Native's FormData type has no `get`; Jest runs on Node's.
    const form = (await request.formData()) as unknown as { get(name: string): File };
    const sent = form.get('file');
    expect(sent.name).toBe('reef.jpg');
    expect(await sent.text()).toBe('jpeg bytes');
  });

  it("surfaces the API's error detail", async () => {
    const { api } = setup({ status: 413, body: { detail: 'Image is too large' } });
    const upload = api.uploadPhoto(new Blob(['x']), 'big.jpg');
    await expect(upload).rejects.toEqual(new ApiError(413, 'Image is too large'));
  });

  it('never calls the API when signed out', async () => {
    const { api, fetch } = setup({ token: null });
    await expect(api.deleteAccount()).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deletes a photo by id', async () => {
    const { api, requests } = setup({ status: 204 });
    await api.deletePhoto(PHOTO_ID);
    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe(`${BASE_URL}/photos/${PHOTO_ID}/`);
    expect(requests[0].headers.get('Authorization')).toBe('Bearer access-token');
  });

  it('reports a photo that is gone', async () => {
    const { api } = setup({ status: 404, body: { detail: 'Photo not found' } });
    await expect(api.deletePhoto(PHOTO_ID)).rejects.toEqual(new ApiError(404, 'Photo not found'));
  });

  it('deletes the account', async () => {
    const { api, requests } = setup({ status: 204 });
    await api.deleteAccount();
    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe(`${BASE_URL}/account/`);
  });
});
