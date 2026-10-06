import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { colors } from './ui';

type Props = {
  /** The Original's URL. */
  before: string;
  /** The Enhanced Image's URL. */
  after: string;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const STEP = 0.1;

/**
 * The Original (left of the divider) over the Enhanced Image (right). Drag
 * anywhere on the image, use the Before/Split/After shortcuts, or (screen
 * readers) adjust it like a slider.
 */
export function BeforeAfter({ before, after }: Props) {
  const [width, setWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [position, setPosition] = useState(0.5);

  useEffect(() => {
    let active = true;
    // Both images share the same size: the model resizes back to the Original's.
    // (Callback form: react-native-web has no promise-returning getSize.)
    Image.getSize(
      after,
      (w, h) => {
        if (active && w > 0 && h > 0) setAspectRatio(w / h);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [after]);

  // Every child ignores touches, so `locationX` is relative to the frame.
  const followTouch = (event: GestureResponderEvent) => {
    if (width > 0) setPosition(clamp(event.nativeEvent.locationX / width));
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const delta = event.nativeEvent.actionName === 'increment' ? STEP : -STEP;
    setPosition((p) => clamp(p + delta));
  };

  const percent = Math.round(position * 100);

  return (
    <View style={styles.wrapper}>
      <View
        testID="before-after"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Before and after comparison"
        accessibilityHint="Shows more of the original photo as the value increases"
        accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}% original` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={followTouch}
        onResponderMove={followTouch}
        style={[styles.frame, { aspectRatio }]}>
        <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
          <Image
            testID="after-image"
            source={{ uri: after }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        </View>
        <View style={[styles.clip, { width: position * width }]} testID="before-clip">
          <Image
            testID="before-image"
            source={{ uri: before }}
            style={{ width, height: '100%' }}
            resizeMode="cover"
          />
        </View>
        <View style={[styles.divider, { left: position * width - 1 }]} />
        <Text style={[styles.tag, styles.tagLeft]}>
          Before
        </Text>
        <Text style={[styles.tag, styles.tagRight]}>
          After
        </Text>
      </View>
      <View style={styles.shortcuts}>
        {(
          [
            ['Before', 1],
            ['Split', 0.5],
            ['After', 0],
          ] as const
        ).map(([label, value]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`Show ${label.toLowerCase()}`}
            accessibilityState={{ selected: position === value }}
            onPress={() => setPosition(value)}
            style={[styles.shortcut, position === value && styles.shortcutSelected]}>
            <Text style={[styles.shortcutLabel, position === value && styles.shortcutLabelSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 12 },
  frame: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#0B1F2E',
    cursor: 'pointer',
    userSelect: 'none',
  },
  passThrough: { pointerEvents: 'none' },
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  divider: {
    position: 'absolute',
    pointerEvents: 'none',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
  },
  tag: {
    position: 'absolute',
    pointerEvents: 'none',
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(11, 31, 46, 0.7)',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  tagLeft: { left: 8 },
  tagRight: { right: 8 },
  shortcuts: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  shortcut: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  shortcutSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  shortcutLabel: { color: colors.text, fontWeight: '600' },
  shortcutLabelSelected: { color: colors.onPrimary },
});
