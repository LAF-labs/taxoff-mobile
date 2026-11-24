import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, radius, size, space, usePalette, useReducedMotion } from '../theme';
import { T, tap } from './kit';

/** 서랍 폭: ChatGPT iOS처럼 320, 좁은 폰에서는 뒤 화면이 64만큼 보이게 줄인다. */
const DRAWER_W = 320;
const PEEK = 64;

/**
 * 더보기 메뉴: 왼쪽에서 밀려 나오는 서랍. 뒤 화면은 서랍 폭만큼 오른쪽으로 밀리고 딤이 덮는다.
 * 바깥(밀린 화면) 누르기, 왼쪽으로 끌기, 안드로이드 뒤로, 웹 Esc로 닫힌다.
 */
export function Drawer({ open, onClose, menu, children }: { open: boolean; onClose: () => void; menu: ReactNode; children: ReactNode }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const w = Math.min(DRAWER_W, width - PEEK);
  const still = useReducedMotion();
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) setShown(true);
    const done = () => {
      if (!open) setShown(false);
    };
    if (still) {
      v.setValue(open ? 1 : 0);
      done();
      return;
    }
    Animated.timing(v, { toValue: open ? 1 : 0, duration: motion.slow + 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && done());
  }, [open, still]);
  useEffect(() => {
    if (!open) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (Platform.OS === 'web') document.addEventListener('keydown', esc);
    return () => {
      back.remove();
      if (Platform.OS === 'web') document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40 || g.vx < -0.4) closeRef.current();
      },
    }),
  ).current;
  const shift = v.interpolate({ inputRange: [0, 1], outputRange: [0, w] });
  return (
    <View style={st.fill} {...(shown ? pan.panHandlers : {})}>
      <Animated.View
        style={[st.fill, { transform: [{ translateX: shift }] }]}
        importantForAccessibility={shown ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={shown}
      >
        {children}
        {shown && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: v }]}>
            <Pressable testID="drawer-scrim" style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="메뉴 닫기" />
          </Animated.View>
        )}
      </Animated.View>
      {shown && (
        <Animated.View
          testID="drawer"
          accessibilityViewIsModal
          style={[st.drawer, { width: w, paddingTop: inset.top + space.s2, paddingBottom: inset.bottom + space.s2, backgroundColor: p.canvas, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }] }]}
        >
          {menu}
        </Animated.View>
      )}
    </View>
  );
}

/** 서랍의 한 줄: 아이콘, 이름, 셀 것이 있으면 오른쪽 파란 숫자. 지금 화면은 옅은 면과 굵은 글. */
export function NavRow({ icon, label, on, count, onPress, testID }: { icon: ReactNode; label: string; on?: boolean; count?: number; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, 새 알림 ${count}건` : label}
      accessibilityState={{ selected: !!on }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [st.row, (on || pressed) && { backgroundColor: p.tint }]}
    >
      {icon}
      <T v={on ? 'strong' : 'body'} style={st.label} lines={1}>
        {label}
      </T>
      {!!count && (
        <View style={[st.count, { backgroundColor: p.accent }]}>
          <T v="label" style={[st.countText, { color: p.onAccent }]}>
            {count > 99 ? '99+' : String(count)}
          </T>
        </View>
      )}
    </Pressable>
  );
}

/** 서랍 안 줄 묶음 사이 틈과, 맨 아래로 미는 빈칸. */
export const NavGap = () => <View style={st.gap} />;
export const NavPush = () => <View style={st.fill} />;

const st = StyleSheet.create({
  fill: { flex: 1 },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: space.s3, gap: space.s0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: size.header, paddingHorizontal: space.s3, borderRadius: radius.md },
  label: { flex: 1 },
  count: { minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  countText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  gap: { height: 14 },
});
