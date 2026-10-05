/** A stand-in for `expo-router` in screen tests: `jest.mock('expo-router', () => mockExpoRouter)`. */
import type { ReactNode } from 'react';
import { Text } from 'react-native';

export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

export const mockSearchParams: Record<string, string> = {};

export const mockExpoRouter = {
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams,
  Link: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
};
