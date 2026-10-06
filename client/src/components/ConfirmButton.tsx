import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, colors } from './ui';

type Props = {
  label: string;
  /** Explains what confirming does, shown with the confirm/cancel choice. */
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
};

/**
 * A destructive action that asks for confirmation in place, the same way on
 * web and native (no blocking browser dialog or platform alert).
 */
export function ConfirmButton({ label, prompt, confirmLabel, onConfirm, busy }: Props) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return <Button label={label} variant="danger" onPress={() => setAsking(true)} />;
  }
  return (
    <View style={styles.box}>
      <Text style={styles.prompt}>{prompt}</Text>
      <View style={styles.row}>
        <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => setAsking(false)} />
        <Button label={confirmLabel} variant="danger" busy={busy} onPress={onConfirm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
  },
  prompt: { color: colors.text, fontSize: 15 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
