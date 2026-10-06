import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BeforeAfter } from '@/components/BeforeAfter';
import { ConfirmButton } from '@/components/ConfirmButton';
import { StatusBadge } from '@/components/StatusBadge';
import { Centered, ErrorMessage, colors } from '@/components/ui';
import { getApi } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { notifyPhotoDeleted } from '@/lib/photoEvents';
import { isInProgress } from '@/lib/photos';
import { usePhoto } from '@/lib/usePhoto';

export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useUserId();
  const router = useRouter();
  const { photo, images, loading, notFound, error } = usePhoto(userId, id);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deletePhoto = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await getApi().deletePhoto(id);
      notifyPhotoDeleted(id);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );
  }
  if (notFound || photo === null) {
    return (
      <Centered>
        <ErrorMessage message={error} />
        {error ? null : <Text style={styles.text}>This photo does not exist.</Text>}
        <Link href="/" style={styles.link}>
          Back to my photos
        </Link>
      </Centered>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <StatusBadge status={photo.status} />
        <Text style={styles.muted}>{new Date(photo.created_at).toLocaleString()}</Text>
      </View>

      {photo.status === 'completed' && images.original && images.enhanced ? (
        <BeforeAfter before={images.original} after={images.enhanced} />
      ) : (
        <View style={styles.pending}>
          {images.original ? (
            <Image
              testID="original-image"
              source={{ uri: images.original }}
              style={styles.original}
              resizeMode="contain"
            />
          ) : null}
          {isInProgress(photo) ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.text}>
                {photo.status === 'pending' ? 'Waiting to be enhanced…' : 'Enhancing your photo…'}
              </Text>
            </View>
          ) : null}
          {photo.status === 'failed' ? (
            <Text style={styles.text}>
              Enhancement failed. Delete this photo and upload it again to retry.
            </Text>
          ) : null}
        </View>
      )}

      <ErrorMessage message={error ?? deleteError} />
      <ConfirmButton
        label="Delete photo"
        prompt="Delete this photo and its enhanced version? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={deletePhoto}
        busy={deleting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, width: '100%', maxWidth: 752, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pending: { gap: 12 },
  original: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted },
  link: { color: colors.primary, fontWeight: '600' },
});
