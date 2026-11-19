// 사진 자리(11-19): 사진이 오기 전에 원본 비율만큼 자리를 먼저 잡고 흐린 미리보기(16px)를 깔아 둔다.
// 원본이 오면 그 위에 서서히 겹친다(움직임 줄이기면 바로). 자리 크기가 처음부터 같아 대화가 밀리지 않는다.
// Mattermost 모바일을 따랐다: 자리 크기는 사진이 오기 전에 저장해 둔 폭·높이로 정하고(post/body/content/image_preview/image_preview.tsx calculateDimensions),
// 작은 썸네일을 먼저 깔고 원본을 그 위에 그린다(components/progressive_image/index.tsx placeholder).
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import type { Thumb } from '../capture/thumb';
import { radius, usePalette, useReducedMotion } from '../theme';

/** 대화 카드 안 사진 줄 높이 상한(가로 사진은 폭이 정하고, 세로로 긴 영수증은 여기서 멈춘다) */
const MAX_H = 180;

export function PhotoSlot({ thumb, load, label }: { thumb: Thumb; /** 원본을 가져온다(없으면 흐린 미리보기만) */ load?: () => Promise<string | null>; label: string }) {
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
