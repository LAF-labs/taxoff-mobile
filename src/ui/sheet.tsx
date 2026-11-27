import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Modal, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, radius, space, usePalette, useReducedMotion } from '../theme';
import { Actions, CardIcon, type CardKind } from './card';
import { Glyph } from './glyph';
import { Button, Check, Chevron, Raised, T } from './kit';

/** 높이 고정 시트(한 단계씩 묻는 입력). 기준판 is-tall: 393x852 화면에서 위 300을 남긴다. */
export const SHEET_TALL = 544;

/**
 * 공용 시트(docs/design.md v3.0 "시트는 하나다", 기준판 .ph-sheet): 바닥에서 올라오는 overlay 면, 위 모서리 22, 손잡이,
 * 머리 줄(이전 단계, 아이콘, 제목과 단계 수, 닫기). 닫기 단추, 바깥 누르기, 아래로 끌기, 뒤로(안드로이드), Esc(웹)로 닫힌다.
 * 바닥 단추 줄(footer)은 키보드 위에 붙는다. 앱의 바닥 시트는 모두 이것 하나로 그린다(Modal을 화면에서 직접 쓰지 않는다).
 * height: 숫자면 그 높이로 고정(한 단계씩 묻는 입력), 'fit'이면 내용 높이(확인, 고르기).
 */
export function Sheet({
  title, kind, step, onBack, onClose, children, footer, testID, height = SHEET_TALL, preview, inline, a11yClose = '닫기',
}: {
  title: string; kind?: CardKind; step?: string; onBack?: () => void; onClose: () => void; children?: ReactNode; footer?: ReactNode; testID?: string; height?: number | 'fit';
  /** 갤러리: Modal 없이 그 자리에 그리고 올라오는 움직임도 없다. */
  preview?: boolean;
  /** 이미 앱 맨 위 층에 그리는 곳(알림 승인, 간편인증 같은 Host): Modal 없이 그 자리에 그린다. */
  inline?: boolean;
  a11yClose?: string;
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
  const max = winH - kb - inset.top - space.s2;
  const fit = height === 'fit';
  const h = fit ? max : Math.min(height, max);
  const body = (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Pressable testID={testID ? `${testID}-scrim` : undefined} style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={a11yClose} />
      <Animated.View
        accessibilityViewIsModal
        style={[
          st.sheet,
          { backgroundColor: p.overlay, bottom: kb, paddingBottom: bottomPad },
          fit ? { maxHeight: h } : { height: h },
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
            {kind && <CardIcon kind={kind} />}
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
          {children !== undefined && children !== null && children !== false && <View style={fit ? st.bodyFit : st.body}>{children}</View>}
          {footer && <View style={st.footer}>{footer}</View>}
        </Raised.Provider>
      </Animated.View>
    </View>
  );
  if (preview || inline) return body;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {body}
    </Modal>
  );
}

/** 단계 시트에서 칸 하나 고르기(인증 앱, 통신사): 세 칸씩, 고른 칸은 진한 테두리와 체크만. */
export function ChoiceGrid({ choices, value, onPick, testID }: { choices: ReadonlyArray<{ code: string; name: string }>; value: string; onPick: (code: string) => void; testID?: string }) {
  const p = usePalette();
  return (
    <View style={st.grid} accessibilityRole="radiogroup">
      {choices.map((c) => {
        const on = value === c.code;
        return (
          <Pressable
            key={c.code}
            onPress={() => onPick(c.code)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={c.name}
            testID={testID ? `${testID}-${c.code}` : undefined}
            style={({ pressed }) => [st.choice, { borderColor: on ? p.ink : p.line, borderWidth: on ? 1.5 : 1, backgroundColor: p.overlay }, pressed && { opacity: 0.6 }]}
          >
            <T v={on ? 'subStrong' : 'sub'} lines={1}>
              {c.name}
            </T>
            {on && (
              <View style={st.choiceCheck}>
                <Check color={p.ink} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  choice: { minHeight: 48, width: '31.5%', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: space.s2 },
  choiceCheck: { position: 'absolute', top: 6, right: 8 },
  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2, paddingHorizontal: space.s5, gap: space.s4 },
  grip: { gap: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: radius.full },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: 32 },
  title: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space.s1 + 2 },
  round: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minHeight: 0, gap: space.s4 },
  bodyFit: { flexShrink: 1, minHeight: 0, gap: space.s4 },
  footer: { gap: space.s2 },
  rows: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: 10, minHeight: 52 },
});

/**
 * 한 번 묻는 확인(기준판 Phone-Confirm): 시트 머리에 묻는 말, 아래 짧은 설명 한 줄, 큰 단추 반씩(주 단추가 앞).
 * 가운데 큰 아이콘이나 회색 설명 줄을 더하지 않는다.
 */
export function ConfirmSheet({ title, body, yes, no, onYes, onNo, onClose, kind, busy, testID = 'confirm-sheet', inline, preview }: {
  title: string;
  body?: string;
  yes: string;
  no?: string;
  onYes: () => void;
  onNo?: () => void;
  onClose?: () => void;
  kind?: CardKind;
  busy?: boolean;
  testID?: string;
  inline?: boolean;
  preview?: boolean;
}) {
  const close = onClose ?? onNo ?? onYes;
  return (
    <Sheet
      title={title}
      kind={kind}
      onClose={close}
      height="fit"
      testID={testID}
      inline={inline}
      preview={preview}
      footer={
        <Actions>
          <Button label={yes} onPress={onYes} busy={busy} testID="confirm-yes" />
          {no && onNo ? <Button kind="secondary" label={no} onPress={onNo} disabled={busy} testID="confirm-no" /> : null}
        </Actions>
      }
    >
      {body ? (
        <T v="sub" c="ink2">
          {body}
        </T>
      ) : null}
    </Sheet>
  );
}

/** 시트 안에서 하나 고르기(기준판 Phone-Reason): 묶음 이름, 줄 52, 고른 줄은 오른쪽 체크만. */
export function PickRows<V extends string>({ groups, value, onPick, testID }: { groups: ReadonlyArray<{ label?: string; items: ReadonlyArray<{ value: V; label: string; hint?: string }> }>; value: V | null; onPick: (v: V) => void; testID?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.s5 }} testID={testID}>
      {groups.map((g, gi) => (
        <View key={gi} style={{ gap: space.s2 }}>
          {g.label && (
            <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              {g.label}
            </T>
          )}
          <View style={[st.rows, { backgroundColor: p.raisedTint }]} accessibilityRole="radiogroup">
            {g.items.map((x, i) => (
              <Pressable
                key={x.value}
                onPress={() => onPick(x.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: x.value === value }}
                accessibilityLabel={x.hint ? `${x.label}, ${x.hint}` : x.label}
                style={({ pressed }) => [st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }, pressed && { backgroundColor: p.sunken }]}
                testID={testID ? `${testID}-${x.value}` : undefined}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <T>{x.label}</T>
                  {x.hint && (
                    <T v="meta" c="ink3">
                      {x.hint}
                    </T>
                  )}
                </View>
                {x.value === value && <Check color={p.ink} />}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
