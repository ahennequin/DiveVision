import { fireEvent, render, screen } from '@testing-library/react-native';

import PhotoScreen from '@/app/(app)/photos/[id]';
import { notifyPhotoDeleted } from '@/lib/photoEvents';
import { usePhoto } from '@/lib/usePhoto';
import { USER_ID, makePhoto } from '@/test-utils/fakeSupabase';
import { mockRouter, mockSearchParams } from '@/test-utils/mockRouter';

const mockApi = { uploadPhoto: jest.fn(), deletePhoto: jest.fn(), deleteAccount: jest.fn() };

jest.mock('expo-router', () => require('@/test-utils/mockRouter').mockExpoRouter);
jest.mock('@/lib/api', () => ({ getApi: () => mockApi }));
jest.mock('@/lib/auth', () => ({ useUserId: () => require('@/test-utils/fakeSupabase').USER_ID }));
jest.mock('@/lib/usePhoto', () => ({ usePhoto: jest.fn() }));
jest.mock('@/lib/photoEvents', () => ({ notifyPhotoDeleted: jest.fn() }));

const photo = makePhoto();
const show = (overrides: Partial<ReturnType<typeof usePhoto>>) =>
  jest.mocked(usePhoto).mockReturnValue({
    photo,
    images: { original: 'https://signed.test/original', enhanced: null },
    loading: false,
    notFound: false,
    error: null,
    ...overrides,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams.id = photo.id;
});

it('shows the before/after comparison once enhanced', async () => {
  show({
    photo: { ...photo, status: 'completed' },
    images: { original: 'https://signed.test/original', enhanced: 'https://signed.test/enhanced' },
  });
  await render(<PhotoScreen />);
  expect(usePhoto).toHaveBeenCalledWith(USER_ID, photo.id);
  expect(screen.getByTestId('before-after')).toBeOnTheScreen();
  expect(screen.getByTestId('before-image').props.source).toEqual({
    uri: 'https://signed.test/original',
  });
  expect(screen.getByTestId('after-image').props.source).toEqual({
    uri: 'https://signed.test/enhanced',
  });
});

it('shows the Original while the enhancement is queued', async () => {
  show({});
  await render(<PhotoScreen />);
  expect(screen.getByText('Waiting to be enhanced…')).toBeOnTheScreen();
  expect(screen.getByTestId('original-image')).toBeOnTheScreen();
  expect(screen.queryByTestId('before-after')).toBeNull();
});

it('explains a failed enhancement', async () => {
  show({ photo: { ...photo, status: 'failed' } });
  await render(<PhotoScreen />);
  expect(screen.getByText(/Enhancement failed/)).toBeOnTheScreen();
});

it('handles a photo that does not exist', async () => {
  show({ photo: null, notFound: true });
  await render(<PhotoScreen />);
  expect(screen.getByText('This photo does not exist.')).toBeOnTheScreen();
});

it('deletes the photo through the API after confirmation', async () => {
  show({});
  mockApi.deletePhoto.mockResolvedValueOnce(undefined);
  await render(<PhotoScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
  expect(mockApi.deletePhoto).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));

  expect(mockApi.deletePhoto).toHaveBeenCalledWith(photo.id);
  expect(notifyPhotoDeleted).toHaveBeenCalledWith(photo.id);
  expect(mockRouter.back).toHaveBeenCalled();
});

it('keeps the photo when deletion fails', async () => {
  show({});
  mockApi.deletePhoto.mockRejectedValueOnce(new Error('Photo not found'));
  await render(<PhotoScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Photo not found')).toBeOnTheScreen();
  expect(notifyPhotoDeleted).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});
