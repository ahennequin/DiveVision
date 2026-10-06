import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PAGE_SIZE,
  applyPhotoChange,
  listMyPhotos,
  signThumbnails,
  subscribeToMyPhotos,
  type Photo,
} from './photos';
import { onPhotoDeleted } from './photoEvents';
import { getSupabase } from './supabase';

type MyPhotos = {
  photos: Photo[];
  thumbnails: Record<string, string>;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
};

/** The User's gallery: paged from Supabase, kept current over Realtime. */
export function useMyPhotos(userId: string): MyPhotos {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const loaded = useRef(0);
  const refreshRequest = useRef(0);
  const pageRequest = useRef(0);

  useEffect(() => {
    loaded.current = photos.length;
  }, [photos]);

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const supabase = getSupabase();
      const page = await listMyPhotos(supabase, userId, offset, limit);
      return { page, urls: await signThumbnails(supabase, userId, page) };
    },
    [userId],
  );

  /** Reload everything shown so far (at least one page), in the background. */
  const refresh = useCallback(() => {
    const id = ++refreshRequest.current;
    const limit = Math.max(loaded.current, PAGE_SIZE);
    fetchPage(0, limit)
      .then(({ page, urls }) => {
        if (id !== refreshRequest.current) return;
        setPhotos(page);
        setThumbnails(urls);
        setHasMore(page.length === limit);
        setError(null);
      })
      .catch((e: Error) => {
        if (id === refreshRequest.current) setError(e.message);
      })
      .finally(() => {
        if (id === refreshRequest.current) setLoading(false);
      });
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    const id = ++pageRequest.current;
    setLoading(true);
    fetchPage(loaded.current, PAGE_SIZE)
      .then(({ page, urls }) => {
        if (id !== pageRequest.current) return;
        setPhotos((current) => {
          const known = new Set(current.map((p) => p.id));
          return [...current, ...page.filter((p) => !known.has(p.id))];
        });
        setThumbnails((current) => ({ ...current, ...urls }));
        setHasMore(page.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e: Error) => {
        if (id === pageRequest.current) setError(e.message);
      })
      .finally(() => {
        if (id === pageRequest.current) setLoading(false);
      });
  }, [fetchPage]);

  useEffect(() => {
    refresh();
    return subscribeToMyPhotos(
      getSupabase(),
      userId,
      (change) => {
        setPhotos((current) => applyPhotoChange(current, userId, change));
        if (change.eventType !== 'DELETE' && change.new.user_id === userId) {
          // A new row, or a completed one, needs a (new) thumbnail URL.
          signThumbnails(getSupabase(), userId, [change.new])
            .then((urls) => setThumbnails((current) => ({ ...current, ...urls })))
            .catch(() => {});
        }
      },
      // Catch up on anything that changed before the channel was (re)connected.
      refresh,
    );
  }, [userId, refresh]);

  useEffect(
    () =>
      onPhotoDeleted((photoId) => {
        setPhotos((current) => current.filter((p) => p.id !== photoId));
      }),
    [],
  );

  return { photos, thumbnails, loading, error, hasMore, loadMore, refresh };
}
