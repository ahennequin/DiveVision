import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, ErrorMessage, colors } from '@/components/ui';
import { signIn, signUp } from '@/lib/auth';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
      } else if ((await signUp(email.trim(), password)) === 'confirm-email') {
        setNotice('Check your inbox to confirm your email, then sign in.');
        setMode('sign-in');
      }
      // Once signed in, the root layout swaps this screen for the gallery.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
    setError(null);
    setNotice(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</Text>
        <Text style={styles.subtitle}>Enhance your underwater photos.</Text>
        <TextInput
          accessibilityLabel="Email"
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Password"
          placeholder="Password"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          style={styles.input}
        />
        <ErrorMessage message={error} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Button
          label={mode === 'sign-in' ? 'Sign in' : 'Sign up'}
          onPress={submit}
          busy={busy}
        />
        <Button
          label={mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          variant="secondary"
          onPress={switchMode}
          disabled={busy}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: colors.background },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 12,
    padding: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted, marginBottom: 8 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
  },
  notice: { color: colors.primary },
});
