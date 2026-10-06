import type { ImagePickerAsset } from 'expo-image-picker';

import { MAX_UPLOAD_BYTES, toUpload } from '@/lib/pickPhoto';

const asset = (overrides: Partial<ImagePickerAsset>): ImagePickerAsset => ({
  uri: 'file:///photos/reef.jpg',
  width: 4000,
  height: 3000,
  fileName: 'reef.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1024,
  ...overrides,
});

it('uploads a native photo by its URI', () => {
  expect(toUpload(asset({}))).toEqual({
    file: { uri: 'file:///photos/reef.jpg', name: 'reef.jpg', type: 'image/jpeg' },
    name: 'reef.jpg',
  });
});

it('names an unnamed photo after its type', () => {
  expect(toUpload(asset({ fileName: null, mimeType: 'image/png' })).name).toBe('photo.png');
});

it('rejects formats the API refuses', () => {
  expect(() => toUpload(asset({ mimeType: 'image/heic' }))).toThrow(
    'Only JPEG and PNG photos are supported.',
  );
});

it('rejects photos over the upload limit', () => {
  expect(() => toUpload(asset({ fileSize: MAX_UPLOAD_BYTES + 1 }))).toThrow(
    'This photo is larger than 50 MB.',
  );
});
