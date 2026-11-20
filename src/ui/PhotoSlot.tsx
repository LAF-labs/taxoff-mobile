import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import type { Thumb } from '../capture/thumb';
import { radius, usePalette, useReducedMotion } from '../theme';

const MAX_H = 180;

export function PhotoSlot({ thumb, load, label }: { thumb: Thumb; load?: () => Promise<string | null>; label: string }) {
  const p = usePalette();
  const still = useReducedMotion();
  const [uri, setUri] = useState<string | null>(null);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    void load?.().then((u) => live && u && setUri(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [load]);
  const ratio = thumb.w / thumb.h;
  return (
    <View style={[st.slot, { aspectRatio: ratio, maxHeight: MAX_H, backgroundColor: p.sunken }, ratio < 1 && { alignSelf: 'flex-start', height: MAX_H, width: undefined }]} accessible accessibilityRole="image" accessibilityLabel={label} testID="chat-photo">
      <Image source={{ uri: thumb.data }} style={StyleSheet.absoluteFill} blurRadius={6} resizeMode="cover" testID="chat-photo-thumb" />
      {uri && (
        <Animated.Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { opacity: still ? 1 : a }]}
          resizeMode="cover"
          onLoad={() => !still && Animated.timing(a, { toValue: 1, duration: 200, useNativeDriver: true }).start()}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  slot: { width: '100%', borderRadius: radius.md, overflow: 'hidden' },
});
