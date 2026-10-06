import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { Button, ErrorMessage, colors } from '@/components/ui';
import { getApi } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { pickPhoto } from '@/lib/pickPhoto';
import type { Photo } from '@/lib/photos';
import { useMyPhotos } from '@/lib/useMyPhotos';

const TILE_MIN_WIDTH = 160;

export default function GalleryScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { photos, thumbnails, loading, error, hasMore, loadMore } = useMyPhotos(userId);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const columns = Math.max(2, Math.min(5, Math.floor((width - 16) / TILE_MIN_WIDTH)));

  const upload = async () => {
    setUploadError(null);
    try {
      const picked = await pickPhoto();
      if (picked === null) return;
      setUploading(true);
      const created = await getApi().uploadPhoto(picked.file, picked.name);
      router.push({ pathname: '/photos/[id]', params: { id: created.id } });
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const renderItem = ({ item }: { item: Photo }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Photo from ${new Date(item.created_at).toLocaleString()}, ${item.status}`}
      onPress={() => router.push({ pathname: '/photos/[id]', params: { id: item.id } })}
      style={[styles.tile, { width: `${100 / columns}%` }]}>
      <View style={styles.thumbnail}>
        {thumbnails[item.id] ? (
          <Image source={{ uri: thumbnails[item.id] }} style={styles.image} resizeMode="cover" />
        ) : null}
      </View>
      <StatusBadge status={item.status} />
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <Button label="Upload a photo" onPress={upload} busy={uploading} />
        <ErrorMessage message={uploadError ?? error} />
      </View>
      <FlatList
        key={columns}
        data={photos}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>
              No photos yet. Upload an underwater photo to enhance it.
            </Text>
          )
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : hasMore ? (
            <View style={styles.footer}>
              <Button label="Load more" variant="secondary" onPress={loadMore} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  toolbar: { padding: 16, gap: 8 },
  list: { paddingHorizontal: 8, paddingBottom: 24 },
  tile: { padding: 8, gap: 6 },
  thumbnail: {
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  empty: { textAlign: 'center', color: colors.muted, padding: 32 },
  footer: { padding: 16, alignItems: 'center' },
});
