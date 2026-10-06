import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';

import { Centered, colors } from '@/components/ui';
import { AuthProvider, useSession } from '@/lib/auth';
import { configResult } from '@/lib/config';

export default function RootLayout() {
  if (configResult.error !== null) {
    return (
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>
          DiveVision is not configured
        </Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>{configResult.error}</Text>
      </Centered>
    );
  }
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" options={{ title: 'DiveVision' }} />
      </Stack.Protected>
    </Stack>
  );
}
