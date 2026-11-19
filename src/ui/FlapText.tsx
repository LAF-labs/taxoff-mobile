// 글자가 바뀔 때 공항 출발 안내판처럼 한 글자씩 차르륵 바뀐다: 새 글자는 위에서 내려오고, 옛 글자는 아래로 빠지며 사라진다.
// 줄 높이 안에서만 움직인다(위아래 줄을 넘지 않게 잘라 낸다). 동작 줄이기 설정이면 바로 바꾼다.
import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { TextSizeContext, textScale, type, useReducedMotion, type Ink, type TypeName } from '../theme';
import { T } from './kit';

/** 한 글자가 내려오는 시간과 글자 사이 늦춤(ms) */
const STEP = 240;
const STAGGER = 34;

export function FlapText({ text, v = 'sub', c = 'ink2', testID }: { text: string; v?: TypeName; c?: Ink; testID?: string }) {
  useContext(TextSizeContext);
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(text);
  const [old, setOld] = useState<string | null>(null);
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (text === shown) return;
    if (reduce) {
      setShown(text);
      return;
    }
    setOld(shown);
    setShown(text);
    t.setValue(0);
    const n = Math.max(shown.length, text.length);
    const anim = Animated.timing(t, { toValue: 1, duration: STEP + STAGGER * (n - 1), easing: Easing.linear, useNativeDriver: true });
    anim.start(({ finished }) => finished && setOld(null));
    return () => anim.stop();
    // shown은 이 효과 안에서 바꾸므로 text만 본다
  }, [text]);
  const h = type[v].lineHeight * textScale.web;
  const n = Math.max(shown.length, old?.length ?? 0);
  const total = STEP + STAGGER * Math.max(0, n - 1);
  const ease = Easing.out(Easing.cubic);
  const chars = (s: string, enter: boolean) =>
    [...s].map((ch, i) => {
      const a = (STAGGER * i) / total;
      const b = Math.min(1, (STAGGER * i + STEP) / total);
      const range = [0, a, b, 1];
      const y = t.interpolate({ inputRange: range, outputRange: enter ? [-h, -h, 0, 0] : [0, 0, h * 0.6, h * 0.6], easing: ease });
      const o = t.interpolate({ inputRange: range, outputRange: enter ? [0, 0, 1, 1] : [1, 1, 0, 0] });
      return (
        <Animated.View key={`${enter ? 'n' : 'o'}${i}`} style={{ opacity: old === null ? 1 : o, transform: [{ translateY: old === null ? 0 : y }] }}>
          <T v={v} c={c}>
            {ch === ' ' ? ' ' : ch}
          </T>
        </Animated.View>
      );
    });
  // 자리는 둘 중 긴 글자가 잡고(옛 글자가 옆으로 잘리지 않게), 두 층은 그 위에 겹친다
  const longer = old !== null && old.length > shown.length ? old : shown;
  return (
    <View style={[st.clip, { height: h }]} testID={testID} accessible accessibilityLabel={shown}>
      <View style={{ opacity: 0 }}>
        <T v={v} c={c}>
          {longer}
        </T>
      </View>
      {old !== null && <View style={st.layer}>{chars(old, false)}</View>}
      <View style={st.layer}>{chars(shown, true)}</View>
    </View>
  );
}

const st = StyleSheet.create({
  clip: { overflow: 'hidden', alignSelf: 'center' },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
});
