import { fireEvent, render, screen } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';
import { signIn, signUp } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({ signIn: jest.fn(), signUp: jest.fn() }));

async function fillIn(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

beforeEach(() => jest.clearAllMocks());

it('signs in with Supabase', async () => {
  await render(<SignInScreen />);
  await fillIn(' diver@example.com ', 'secret');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(signIn).toHaveBeenCalledWith('diver@example.com', 'secret');
});

it('shows why sign-in failed', async () => {
  jest.mocked(signIn).mockRejectedValueOnce(new Error('Invalid login credentials'));
  await render(<SignInScreen />);
  await fillIn('diver@example.com', 'wrong');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Invalid login credentials')).toBeOnTheScreen();
});

it('asks for both fields before calling Supabase', async () => {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByText('Enter your email and password.')).toBeOnTheScreen();
  expect(signIn).not.toHaveBeenCalled();
});

it('signs up and asks to confirm the email when required', async () => {
  jest.mocked(signUp).mockResolvedValueOnce('confirm-email');
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'New here? Create an account' }));
  await fillIn('new@example.com', 'secret');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(signUp).toHaveBeenCalledWith('new@example.com', 'secret');
  expect(
    await screen.findByText('Check your inbox to confirm your email, then sign in.'),
  ).toBeOnTheScreen();
});
