import { act, renderHook, waitFor } from '@testing-library/react-native';

import { notifyPhotoDeleted } from '@/lib/photoEvents';
import { useMyPhotos } from '@/lib/useMyPhotos';
import { usePhoto } from '@/lib/usePhoto';
import { OTHER_USER_ID, USER_ID, fakeSupabase, makePhoto } from '@/test-utils/fakeSupabase';

let mockSupabase = fakeSupabase();
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockSupabase.client }));

const pending = makePhoto({ id: 'bbbbbbbb-0000-4000-8000-000000000001' });
const processedPath = `${USER_ID}/${pending.id}.png`;

beforeEach(() => {
  mockSupabase = fakeSupabase([pending, makePhoto({ id: 'bbbbbbbb-0000-4000-8000-000000000002', user_id: OTHER_USER_ID })]);
});

describe('useMyPhotos', () => {
  it("loads only the User's photos and follows their status over Realtime", async () => {
    const { result, unmount } = await renderHook(() => useMyPhotos(USER_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photos).toEqual([pending]);
    expect(result.current.thumbnails[pending.id]).toBe(
      `https://signed.test/images/${pending.original_path}`,
    );

    const completed = { ...pending, status: 'completed' as const, processed_path: processedPath };
    await act(async () => {
      mockSupabase.emit({ eventType: 'UPDATE', new: completed });
    });
    expect(result.current.photos).toEqual([completed]);
    await waitFor(() =>
      expect(result.current.thumbnails[pending.id]).toBe(
        `https://signed.test/processedimages/${processedPath}`,
      ),
    );

    await unmount();
    expect(mockSupabase.subscriptions).toBe(0);
  });

  it('drops a photo deleted elsewhere in the app', async () => {
    const { result } = await renderHook(() => useMyPhotos(USER_ID));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    await act(async () => notifyPhotoDeleted(pending.id));
    expect(result.current.photos).toEqual([]);
  });
});

describe('usePhoto', () => {
  it('shows the Enhanced Image once the photo completes', async () => {
    const { result } = await renderHook(() => usePhoto(USER_ID, pending.id));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photo?.status).toBe('pending');
    expect(result.current.images.enhanced).toBeNull();

    await act(async () => {
      mockSupabase.emit({
        eventType: 'UPDATE',
        new: { ...pending, status: 'completed', processed_path: processedPath },
      });
    });
    await waitFor(() =>
      expect(result.current.images.enhanced).toBe(
        `https://signed.test/processedimages/${processedPath}`,
      ),
    );
    expect(result.current.photo?.status).toBe('completed');
  });

  it("reports someone else's photo as not found", async () => {
    const { result } = await renderHook(() =>
      usePhoto(USER_ID, 'bbbbbbbb-0000-4000-8000-000000000002'),
    );
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.photo).toBeNull();
  });
});
