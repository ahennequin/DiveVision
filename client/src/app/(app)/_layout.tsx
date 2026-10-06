import { Link, Stack } from 'expo-router';
import { Text } from 'react-native';

import { colors } from '@/components/ui';

/** Screens for a signed-in User; the root layout only mounts them with a session. */
export default function SignedInLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'My photos',
          headerRight: () => (
            <Link href="/account" accessibilityRole="link" style={{ paddingHorizontal: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Account</Text>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="photos/[id]" options={{ title: 'Photo' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
    </Stack>
  );
}
