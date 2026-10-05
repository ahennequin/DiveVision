type Listener = (photoId: string) => void;

const listeners = new Set<Listener>();

/**
 * Tell mounted screens (the gallery under a photo's screen) that a Photo was
 * deleted. Realtime does not deliver DELETE events on filtered channels.
 */
export function notifyPhotoDeleted(photoId: string): void {
  listeners.forEach((listener) => listener(photoId));
}

export function onPhotoDeleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
