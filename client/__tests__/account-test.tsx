import { fireEvent, render, screen } from '@testing-library/react-native';

import AccountScreen from '@/app/(app)/account';
import { signOut } from '@/lib/auth';

const mockApi = { uploadPhoto: jest.fn(), deletePhoto: jest.fn(), deleteAccount: jest.fn() };

jest.mock('@/lib/api', () => ({ getApi: () => mockApi }));
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(),
  useSession: () => ({ session: { user: { email: 'diver@example.com' } }, loading: false }),
}));

beforeEach(() => jest.clearAllMocks());

it('shows who is signed in and signs out', async () => {
  await render(<AccountScreen />);
  expect(screen.getByText('diver@example.com')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalled();
});

it('deletes the account through the API, then signs out', async () => {
  mockApi.deleteAccount.mockResolvedValueOnce(undefined);
  await render(<AccountScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  expect(mockApi.deleteAccount).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete everything' }));

  expect(mockApi.deleteAccount).toHaveBeenCalled();
  expect(signOut).toHaveBeenCalled();
});

it('stays signed in when deletion fails', async () => {
  mockApi.deleteAccount.mockRejectedValueOnce(new Error('Could not delete account'));
  await render(<AccountScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete everything' }));
  expect(await screen.findByText('Could not delete account')).toBeOnTheScreen();
  expect(signOut).not.toHaveBeenCalled();
});

it('can back out of deleting the account', async () => {
  await render(<AccountScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeOnTheScreen();
  expect(mockApi.deleteAccount).not.toHaveBeenCalled();
});
