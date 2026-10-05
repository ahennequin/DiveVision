import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BeforeAfter } from '@/components/BeforeAfter';

const clipWidth = () => StyleSheet.flatten(screen.getByTestId('before-clip').props.style).width;

async function renderAt(width: number) {
  await render(<BeforeAfter before="https://signed.test/a" after="https://signed.test/b" />);
  await fireEvent(screen.getByTestId('before-after'), 'layout', {
    nativeEvent: { layout: { width, height: 300, x: 0, y: 0 } },
  });
}

it('starts split down the middle', async () => {
  await renderAt(400);
  expect(clipWidth()).toBe(200);
});

it('follows a drag across the image', async () => {
  await renderAt(400);
  const frame = screen.getByTestId('before-after');
  await fireEvent(frame, 'responderGrant', { nativeEvent: { locationX: 100 } });
  expect(clipWidth()).toBe(100);
  await fireEvent(frame, 'responderMove', { nativeEvent: { locationX: 900 } });
  expect(clipWidth()).toBe(400);
});

it('jumps to the whole Original or Enhanced Image', async () => {
  await renderAt(400);
  await fireEvent.press(screen.getByRole('button', { name: 'Show before' }));
  expect(clipWidth()).toBe(400);
  await fireEvent.press(screen.getByRole('button', { name: 'Show after' }));
  expect(clipWidth()).toBe(0);
});

it('works as an adjustable control for screen readers', async () => {
  await renderAt(400);
  const frame = screen.getByTestId('before-after');
  await fireEvent(frame, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(clipWidth()).toBe(240);
  expect(frame.props.accessibilityValue).toMatchObject({ now: 60 });
});
