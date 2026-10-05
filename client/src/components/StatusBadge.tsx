import { StyleSheet, Text } from 'react-native';

import type { PhotoStatus } from '@/lib/photos';

const LABELS: Record<PhotoStatus, string> = {
  pending: 'Queued',
  processing: 'Enhancing…',
  completed: 'Enhanced',
  failed: 'Failed',
};

const BACKGROUNDS: Record<PhotoStatus, string> = {
  pending: '#E8EEF3',
  processing: '#FFF4D6',
  completed: '#DDF3E4',
  failed: '#FBE1DF',
};

export function StatusBadge({ status }: { status: PhotoStatus }) {
  return (
    <Text style={[styles.badge, { backgroundColor: BACKGROUNDS[status] }]}>{LABELS[status]}</Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '600',
    color: '#0B1F2E',
    overflow: 'hidden',
  },
});
