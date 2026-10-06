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
  const shown = useRef<Photo[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const generation = useRef(0);

  const update = useCallback((change: (current: Photo[]) => Photo[]) => {
    shown.current = change(shown.current);
    setPhotos(shown.current);
  }, []);

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const supabase = getSupabase();
      const page = await listMyPhotos(supabase, userId, offset, limit);
      return { page, urls: await signThumbnails(supabase, userId, page) };
    },
    [userId],
  );

  /** Run gallery fetches one at a time, each against the list the previous one left. */
  const enqueue = useCallback((run: (isCurrent: () => boolean) => Promise<void>) => {
    const gen = generation.current;
    const isCurrent = () => gen === generation.current;
    queued.current += 1;
    queue.current = queue.current
      .then(() => (isCurrent() ? run(isCurrent) : undefined))
      .catch((e: Error) => {
        if (isCurrent()) setError(e.message);
      })
      .finally(() => {
        queued.current -= 1;
        if (queued.current === 0) setLoading(false);
      });
  }, []);

  /** Reload everything shown so far (at least one page), in the background. */
  const refresh = useCallback(
    () =>
      enqueue(async (isCurrent) => {
        const limit = Math.max(shown.current.length, PAGE_SIZE);
        const { page, urls } = await fetchPage(0, limit);
        if (!isCurrent()) return;
        update(() => page);
        setThumbnails(urls);
        setHasMore(page.length === limit);
        setError(null);
      }),
    [enqueue, fetchPage, update],
  );

  const loadMore = useCallback(() => {
    setLoading(true);
    enqueue(async (isCurrent) => {
      const { page, urls } = await fetchPage(shown.current.length, PAGE_SIZE);
      if (!isCurrent()) return;
      update((current) => {
        const known = new Set(current.map((p) => p.id));
        return [...current, ...page.filter((p) => !known.has(p.id))];
      });
      setThumbnails((current) => ({ ...current, ...urls }));
      setHasMore(page.length === PAGE_SIZE);
      setError(null);
    });
  }, [enqueue, fetchPage, update]);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeToMyPhotos(
      getSupabase(),
      userId,
      (change) => {
        update((current) => applyPhotoChange(current, userId, change));
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
    return () => {
      generation.current += 1;
      unsubscribe();
    };
  }, [userId, refresh, update]);

  useEffect(
    () =>
      onPhotoDeleted((photoId) => {
        update((current) => current.filter((p) => p.id !== photoId));
      }),
    [update],
  );

  return { photos, thumbnails, loading, error, hasMore, loadMore, refresh };
}
