import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConfirmButton } from '@/components/ConfirmButton';
import { Button, ErrorMessage, colors } from '@/components/ui';
import { getApi } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth';

export default function AccountScreen() {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await getApi().deleteAccount();
      // The root layout returns to sign-in once the session is gone.
      await signOut();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <View style={styles.content}>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{session?.user.email}</Text>
      <Button label="Sign out" variant="secondary" onPress={signOut} disabled={busy} />

      <View style={styles.danger}>
        <Text style={styles.heading}>Delete account</Text>
        <Text style={styles.muted}>
          Permanently deletes your account and every photo you uploaded, original and enhanced.
        </Text>
        <ErrorMessage message={error} />
        <ConfirmButton
          label="Delete my account"
          prompt="Delete your account and all your photos? This cannot be undone."
          confirmLabel="Delete everything"
          onConfirm={deleteAccount}
          busy={busy}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { color: colors.muted },
  email: { color: colors.text, fontSize: 18, fontWeight: '600' },
  danger: { marginTop: 24, gap: 8 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted },
});
