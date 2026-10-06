import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { UploadFile } from '@/api/client';

/** The API's limits (`MAX_UPLOAD_BYTES`, `ACCEPTED_FORMATS` in main.py). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export type PickedPhoto = { file: UploadFile; name: string };

export class PickPhotoError extends Error {}

/** Turn a picked asset into an upload, rejecting what the API would refuse. */
export function toUpload(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
  const type = asset.mimeType ?? asset.file?.type ?? '';
  if (!(type in ACCEPTED_TYPES)) {
    throw new PickPhotoError('Only JPEG and PNG photos are supported.');
  }
  const size = asset.fileSize ?? asset.file?.size;
  if (size !== undefined && size > MAX_UPLOAD_BYTES) {
    throw new PickPhotoError('This photo is larger than 50 MB.');
  }
  const name = asset.fileName ?? `photo.${ACCEPTED_TYPES[type]}`;
  if (Platform.OS === 'web') {
    if (!asset.file) {
      throw new PickPhotoError('Could not read the selected file.');
    }
    return { file: asset.file, name };
  }
  return { file: { uri: asset.uri, name, type }, name };
}

/** Let the User choose one photo from their library; null if they cancel. */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: false,
    quality: 1,
    // iOS: hand over HEIC photos as JPEG, which the API accepts.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return toUpload(result.assets[0]);
}
