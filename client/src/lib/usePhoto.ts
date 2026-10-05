import { useCallback, useEffect, useRef, useState } from 'react';

import { getMyPhoto, signPhotoImages, subscribeToMyPhotos, type Photo, type PhotoImages } from './photos';
import { getSupabase } from './supabase';

type PhotoState = {
  photo: Photo | null;
  images: PhotoImages;
  loading: boolean;
  /** True once the Photo is known not to exist (or not to be the User's). */
  notFound: boolean;
  error: string | null;
};

const NO_IMAGES: PhotoImages = { original: null, enhanced: null };

/** One of the User's Photos with signed image URLs, following its status live. */
export function usePhoto(userId: string, photoId: string): PhotoState {
  const [state, setState] = useState<PhotoState>({
    photo: null,
    images: NO_IMAGES,
    loading: true,
    notFound: false,
    error: null,
  });
  const request = useRef(0);

  const show = useCallback(
    async (photo: Photo | null, id: number) => {
      if (photo === null) {
        if (id === request.current) {
          setState({ photo: null, images: NO_IMAGES, loading: false, notFound: true, error: null });
        }
        return;
      }
      const images = await signPhotoImages(getSupabase(), userId, photo);
      if (id === request.current) {
        setState({ photo, images, loading: false, notFound: false, error: null });
      }
    },
    [userId],
  );

  const load = useCallback(() => {
    const id = ++request.current;
    getMyPhoto(getSupabase(), userId, photoId)
      .then((photo) => show(photo, id))
      .catch((e: Error) => {
        if (id === request.current) {
          setState((s) => ({ ...s, loading: false, error: e.message }));
        }
      });
  }, [userId, photoId, show]);

  useEffect(() => {
    load();
    return subscribeToMyPhotos(
      getSupabase(),
      userId,
      (change) => {
        if (change.eventType === 'DELETE') {
          if ((change.old as Partial<Photo>).id === photoId) {
            request.current++;
            setState({ photo: null, images: NO_IMAGES, loading: false, notFound: true, error: null });
          }
          return;
        }
        if (change.new.id === photoId && change.new.user_id === userId) {
          const id = ++request.current;
          show(change.new, id).catch((e: Error) => {
            if (id === request.current) setState((s) => ({ ...s, error: e.message }));
          });
        }
      },
      load,
    );
  }, [userId, photoId, load, show]);

  return state;
}
