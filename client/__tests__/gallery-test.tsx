import { fireEvent, render, screen } from '@testing-library/react-native';

import GalleryScreen from '@/app/(app)/index';
import { PickPhotoError, pickPhoto } from '@/lib/pickPhoto';
import { useMyPhotos } from '@/lib/useMyPhotos';
import { USER_ID, makePhoto } from '@/test-utils/fakeSupabase';
import { mockRouter } from '@/test-utils/mockRouter';

const mockApi = { uploadPhoto: jest.fn(), deletePhoto: jest.fn(), deleteAccount: jest.fn() };

jest.mock('expo-router', () => require('@/test-utils/mockRouter').mockExpoRouter);
jest.mock('@/lib/api', () => ({ getApi: () => mockApi }));
jest.mock('@/lib/auth', () => ({ useUserId: () => require('@/test-utils/fakeSupabase').USER_ID }));
jest.mock('@/lib/useMyPhotos', () => ({ useMyPhotos: jest.fn() }));
jest.mock('@/lib/pickPhoto', () => ({
  ...jest.requireActual('@/lib/pickPhoto'),
  pickPhoto: jest.fn(),
}));

const photos = [
  makePhoto({ id: 'cccccccc-0000-4000-8000-000000000001', status: 'completed' }),
  makePhoto({ id: 'cccccccc-0000-4000-8000-000000000002', status: 'processing' }),
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useMyPhotos).mockReturnValue({
    photos,
    thumbnails: {},
    loading: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
  });
});

it("lists the User's photos with their status", async () => {
  await render(<GalleryScreen />);
  expect(useMyPhotos).toHaveBeenCalledWith(USER_ID);
  expect(screen.getByText('Enhanced')).toBeOnTheScreen();
  expect(screen.getByText('Enhancing…')).toBeOnTheScreen();
});

it('opens a photo', async () => {
  await render(<GalleryScreen />);
  await fireEvent.press(screen.getByText('Enhanced'));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/photos/[id]',
    params: { id: photos[0].id },
  });
});

it('uploads a picked photo through the API and opens it', async () => {
  const file = new Blob(['x'], { type: 'image/jpeg' });
  jest.mocked(pickPhoto).mockResolvedValueOnce({ file, name: 'reef.jpg' });
  mockApi.uploadPhoto.mockResolvedValueOnce({ id: 'new-id', status: 'pending' });

  await render(<GalleryScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Upload a photo' }));

  expect(mockApi.uploadPhoto).toHaveBeenCalledWith(file, 'reef.jpg');
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/photos/[id]',
    params: { id: 'new-id' },
  });
});

it('explains a rejected photo', async () => {
  jest.mocked(pickPhoto).mockRejectedValueOnce(
    new PickPhotoError('Only JPEG and PNG photos are supported.'),
  );
  await render(<GalleryScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Upload a photo' }));
  expect(await screen.findByText('Only JPEG and PNG photos are supported.')).toBeOnTheScreen();
  expect(mockApi.uploadPhoto).not.toHaveBeenCalled();
});

it('invites a first upload when empty', async () => {
  jest.mocked(useMyPhotos).mockReturnValue({ ...jest.mocked(useMyPhotos)(USER_ID), photos: [] });
  await render(<GalleryScreen />);
  expect(screen.getByText(/No photos yet/)).toBeOnTheScreen();
});
