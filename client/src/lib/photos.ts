import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';

/** Where a Photo's Enhancement Job is: see CONTEXT.md, "Photo Status". */
export type PhotoStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** A `photos` row (supabase/migrations/). */
export type Photo = {
  id: string;
  user_id: string;
  original_path: string;
  processed_path: string | null;
  status: PhotoStatus;
  model_name: string;
  created_at: string;
};

export const ORIGINALS_BUCKET = 'images';
export const ENHANCED_BUCKET = 'processedimages';
export const PAGE_SIZE = 24;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInProgress(photo: Photo): boolean {
  return photo.status === 'pending' || photo.status === 'processing';
}

/*
 * Every read filters on `user_id` explicitly instead of trusting RLS alone, so
 * Photos made public later (an additive SELECT policy) never appear here.
 */

/** `limit` of the User's Photos from `offset`, newest first. */
export async function listMyPhotos(
  supabase: SupabaseClient,
  userId: string,
  offset = 0,
  limit = PAGE_SIZE,
): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    throw new Error(error.message);
  }
  return data as Photo[];
}

/** One of the User's Photos, or null if it does not exist or is not theirs. */
export async function getMyPhoto(
  supabase: SupabaseClient,
  userId: string,
  photoId: string,
): Promise<Photo | null> {
  if (!UUID.test(photoId)) {
    return null;
  }
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('user_id', userId)
    .eq('id', photoId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as Photo | null;
}

/** Storage paths must sit in the User's own folder (`<user_id>/...`). */
function ownPath(userId: string, path: string | null): path is string {
  return path !== null && path.startsWith(`${userId}/`);
}

async function signPaths(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) {
    return urls;
  }
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    throw new Error(error.message);
  }
  for (const item of data) {
    if (item.path && item.signedUrl) {
      urls.set(item.path, item.signedUrl);
    }
  }
  return urls;
}

/**
 * Signed URLs for each Photo's gallery thumbnail: its Enhanced Image once
 * completed, else its Original. Keyed by photo id.
 */
export async function signThumbnails(
  supabase: SupabaseClient,
  userId: string,
  photos: Photo[],
): Promise<Record<string, string>> {
  const enhanced = photos.filter(
    (p) => p.status === 'completed' && ownPath(userId, p.processed_path),
  );
  const originals = photos.filter(
    (p) => !enhanced.includes(p) && ownPath(userId, p.original_path),
  );
  const [enhancedUrls, originalUrls] = await Promise.all([
    signPaths(supabase, ENHANCED_BUCKET, enhanced.map((p) => p.processed_path as string)),
    signPaths(supabase, ORIGINALS_BUCKET, originals.map((p) => p.original_path)),
  ]);

  const thumbnails: Record<string, string> = {};
  for (const p of enhanced) {
    const url = enhancedUrls.get(p.processed_path as string);
    if (url) thumbnails[p.id] = url;
  }
  for (const p of originals) {
    const url = originalUrls.get(p.original_path);
    if (url) thumbnails[p.id] = url;
  }
  return thumbnails;
}

export type PhotoImages = { original: string | null; enhanced: string | null };

/** Signed URLs for one Photo's Original and (once completed) Enhanced Image. */
export async function signPhotoImages(
  supabase: SupabaseClient,
  userId: string,
  photo: Photo,
): Promise<PhotoImages> {
  const hasEnhanced = photo.status === 'completed' && ownPath(userId, photo.processed_path);
  const [original, enhanced] = await Promise.all([
    ownPath(userId, photo.original_path)
      ? signPaths(supabase, ORIGINALS_BUCKET, [photo.original_path])
      : Promise.resolve(new Map<string, string>()),
    hasEnhanced
      ? signPaths(supabase, ENHANCED_BUCKET, [photo.processed_path as string])
      : Promise.resolve(new Map<string, string>()),
  ]);
  return {
    original: original.get(photo.original_path) ?? null,
    enhanced: hasEnhanced ? (enhanced.get(photo.processed_path as string) ?? null) : null,
  };
}

export type PhotoChange = RealtimePostgresChangesPayload<Photo>;

/** Apply one Realtime change to a newest-first list of the User's Photos. */
export function applyPhotoChange(photos: Photo[], userId: string, change: PhotoChange): Photo[] {
  if (change.eventType === 'DELETE') {
    const id = (change.old as Partial<Photo>).id;
    return photos.filter((p) => p.id !== id);
  }
  const row = change.new;
  if (row.user_id !== userId) {
    return photos;
  }
  const index = photos.findIndex((p) => p.id === row.id);
  if (index === -1) {
    return change.eventType === 'INSERT' ? [row, ...photos] : photos;
  }
  const next = photos.slice();
  next[index] = row;
  return next;
}

/**
 * Follow changes to the User's `photos` rows over Realtime. `onSubscribed`
 * fires once the channel is live (and after each reconnect), so callers can
 * refetch whatever changed before it was. Returns an unsubscribe function.
 */
export function subscribeToMyPhotos(
  supabase: SupabaseClient,
  userId: string,
  onChange: (change: PhotoChange) => void,
  onSubscribed?: () => void,
): () => void {
  const channel = supabase
    .channel(`photos:${userId}:${Math.random().toString(36).slice(2)}`)
    .on<Photo>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'photos', filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onSubscribed?.();
      }
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}
