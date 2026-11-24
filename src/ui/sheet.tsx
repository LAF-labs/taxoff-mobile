import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Modal, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, radius, space, usePalette, useReducedMotion } from '../theme';
import { Glyph } from './glyph';
import { Chevron, Raised, T } from './kit';

/** 높이 고정 시트(한 단계씩 묻는 입력). 기준판 is-tall: 393x852 화면에서 위 300을 남긴다. */
export const SHEET_TALL = 544;

/**
 * 공용 시트(docs/design.md v3.0 "시트는 하나다"): 바닥에서 올라오는 overlay 면, 위 모서리 22, 손잡이,
 * 머리 줄(이전 단계, 제목과 단계 수, 닫기). 닫기 단추, 바깥 누르기, 아래로 끌기, 뒤로(안드로이드), Esc(웹)로 닫힌다.
 * 바닥 단추 줄(footer)은 키보드 위에 붙는다.
 */
export function Sheet({
  title, step, onBack, onClose, children, footer, testID, height = SHEET_TALL, preview,
}: {
  title: string; step?: string; onBack?: () => void; onClose: () => void; children: ReactNode; footer?: ReactNode; testID?: string; height?: number;
  /** 갤러리: Modal 없이 그 자리에 그린다. */
  preview?: boolean;
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const still = useReducedMotion();
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const rise = useRef(new Animated.Value(still || preview ? 0 : 1)).current;
  useEffect(() => {
    if (still || preview) return;
    Animated.timing(rise, { toValue: 0, duration: motion.slow + 60, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, []);
  const drag = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.6) closeRef.current();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
      },
    }),
  ).current;

  const bottomPad = Math.max(kb > 0 ? space.s4 : inset.bottom, space.s4);
  const h = Math.min(height, winH - kb - inset.top - space.s2);
  const body = (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Pressable testID={testID ? `${testID}-scrim` : undefined} style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" />
      <Animated.View
        accessibilityViewIsModal
        style={[
          st.sheet,
          { backgroundColor: p.overlay, height: h, bottom: kb, paddingBottom: bottomPad },
          { transform: [{ translateY: Animated.add(drag, rise.interpolate({ inputRange: [0, 1], outputRange: [0, h] })) }] },
        ]}
      >
        <View {...pan.panHandlers} style={st.grip}>
          <View style={[st.grabber, { backgroundColor: p.sunken }]} />
          <View style={st.head}>
            {onBack && (
              <Pressable testID={testID ? `${testID}-back` : undefined} onPress={onBack} hitSlop={6} accessibilityRole="button" accessibilityLabel="이전 단계" style={[st.round, { backgroundColor: p.raisedTint }]}>
                <Chevron dir="left" color={p.ink2} sizePx={8} />
              </Pressable>
            )}
            <View style={st.title}>
              <T v="title" role="header" lines={1}>
                {title}
              </T>
              {step && (
                <T v="sub" c="ink3" testID={testID ? `${testID}-step` : undefined}>
                  {step}
                </T>
              )}
            </View>
            <Pressable testID={testID ? `${testID}-close` : undefined} onPress={onClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="닫기" style={[st.round, { backgroundColor: p.raisedTint }]}>
              <Glyph kind="close" color={p.ink2} size={14} />
            </Pressable>
          </View>
        </View>
        <Raised.Provider value={true}>
          <View style={st.body}>{children}</View>
          {footer && <View style={st.footer}>{footer}</View>}
        </Raised.Provider>
      </Animated.View>
    </View>
  );
  if (preview) return body;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {body}
    </Modal>
  );
}

const st = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2, paddingHorizontal: space.s5, gap: space.s4 },
  grip: { gap: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: radius.full },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: 32 },
  title: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space.s1 + 2 },
  round: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minHeight: 0, gap: space.s4 },
  footer: { gap: space.s2 },
});
