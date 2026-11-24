import * as Haptics from 'expo-haptics';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type AccessibilityRole, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShellTop, TOP_SPACE } from './float';
import { MAX_FONT_SCALE, TextSizeContext, motion, radius, size, space, textScale, type, useReducedMotion, usePalette, type Ink, type TypeName } from '../theme';

const keepAll = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as unknown as TextStyle;


export const tap = () => void Haptics.selectionAsync().catch(() => {});
export const success = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
export const warn = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

export function T({
  children, v = 'body', c = 'ink', style, testID, lines, center, role,
}: { children: ReactNode; v?: TypeName; c?: Ink; style?: StyleProp<TextStyle>; testID?: string; lines?: number; center?: boolean; role?: AccessibilityRole }) {
  const p = usePalette();
  const base = type[v];
  useContext(TextSizeContext);
  const k = textScale.web;
  return (
    <Text
      testID={testID}
      accessibilityRole={role}
      numberOfLines={lines}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      lineBreakStrategyIOS="hangul-word"
      style={[base, k !== 1 && { fontSize: base.fontSize * k, lineHeight: base.lineHeight * k }, { color: p[c] }, keepAll, center && { textAlign: 'center' }, style]}
    >
      {children}
    </Text>
  );
}

export function Screen({
  title, onBack, backLabel = '뒤로', right, children, footer, scroll = true, testID, style, shell,
}: {
  title?: string; onBack?: () => void; backLabel?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; testID?: string; style?: StyleProp<ViewStyle>;
  /** 맨 위 화면(더보기 메뉴로 오가는 화면): 머리 줄 대신 떠 있는 더보기, 제목, PC 상태를 두고 본문이 그 밑으로 지나간다. */
  shell?: boolean;
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const bottom = space.s6 + inset.bottom;
  const head = !shell && (title !== undefined || onBack || right);
  const top = shell ? { paddingTop: inset.top + TOP_SPACE } : null;
  return (
    <SafeAreaView edges={shell ? ['left', 'right'] : ['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: p.canvas }, style]} testID={testID}>
      {head && (
        <View style={st.header}>
          <View style={st.headerSide}>{onBack && <Back onPress={onBack} label={backLabel} />}</View>
          {title !== undefined && (
            <T v="title" lines={1} role="header" style={st.headerTitle}>
              {title}
            </T>
          )}
          <View style={[st.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
        </View>
      )}
      {}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={footer && Platform.OS === 'ios' ? 'padding' : undefined} enabled={!!footer}>
      {scroll ? (
        <ScrollView contentContainerStyle={[st.content, top, !footer && { paddingBottom: bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={!footer}>
          {children}
        </ScrollView>
      ) : (
        <View style={[st.content, top, { flex: 1 }, !footer && { paddingBottom: bottom }]}>{children}</View>
      )}
      {footer && <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4), backgroundColor: p.canvas, borderTopColor: p.line }]}>{footer}</View>}
      </KeyboardAvoidingView>
      {shell && (
        <ShellTop
          title={
            title !== undefined ? (
              <T v="title" lines={1} role="header">
                {title}
              </T>
            ) : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

function Back({ onPress, label }: { onPress: () => void; label: string }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={({ pressed }) => [st.back, pressed && { opacity: 0.5 }]} testID="back">
      <Chevron dir="left" color={p.ink} />
    </Pressable>
  );
}

export function Chevron({ dir = 'right', color, sizePx = 9 }: { dir?: 'left' | 'right' | 'down' | 'up'; color: string; sizePx?: number }) {
  const rot = dir === 'left' ? '-135deg' : dir === 'down' ? '135deg' : dir === 'up' ? '-45deg' : '45deg';
  return <View style={{ width: sizePx, height: sizePx, borderTopWidth: 2, borderRightWidth: 2, borderColor: color, transform: [{ rotate: rot }], marginHorizontal: 4 }} />;
}

export function Check({ color }: { color: string }) {
  return <View style={{ width: 12, height: 7, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '-45deg' }], marginTop: -3 }} />;
}

type Kind = 'primary' | 'secondary' | 'quiet' | 'approve';
export function Button({
  label, onPress, kind = 'primary', disabled, busy, testID, style, small, hint,
}: { label: string; onPress: () => void; kind?: Kind; disabled?: boolean; busy?: boolean; testID?: string; style?: StyleProp<ViewStyle>; small?: boolean; hint?: string }) {
  const p = usePalette();
  const bg = kind === 'primary' ? p.ink : kind === 'approve' ? p.accent : kind === 'secondary' ? p.tint : 'transparent';
  const pressedBg = kind === 'primary' ? p.ink2 : kind === 'approve' ? p.accent : kind === 'secondary' ? p.sunken : p.tint;
  const fg = kind === 'primary' ? p.onInk : kind === 'approve' ? p.onAccent : kind === 'quiet' ? p.ink2 : p.ink;
  const off = disabled && !busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off || busy}
      hitSlop={small ? (size.hit - size.buttonSm) / 2 + 2 : undefined}
      onPress={() => {
        if (kind === 'primary' || kind === 'approve') tap();
        onPress();
      }}
      style={({ pressed }) => [
        st.btn,
        small && st.btnSm,
        { backgroundColor: off ? p.tint : pressed ? pressedBg : bg },
        kind === 'approve' && pressed && !off && { opacity: 0.85 },
        kind === 'quiet' && { alignSelf: 'center', paddingHorizontal: space.s4 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <T v={small ? 'subStrong' : 'button'} style={{ color: off ? p.ink4 : fg }} lines={1}>{label}</T>}
    </Pressable>
  );
}

export function Group({ children, title, note, style, testID }: { children: ReactNode; title?: string; note?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const p = usePalette();
  const items = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <View style={[{ gap: space.s2 }, style]} testID={testID}>
      {title && (
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          {title}
        </T>
      )}
      <View style={[st.group, { backgroundColor: p.tint }]}>
        {items.map((c, i) => (
          <View key={i}>
            {i > 0 && <View style={[st.sep, { backgroundColor: p.line }]} />}
            {c}
          </View>
        ))}
      </View>
      {note && (
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          {note}
        </T>
      )}
    </View>
  );
}

export function Row({
  label, value, sub, onPress, chevron, testID, valueInk = 'ink2', strong, accessory, subInk = 'ink3', icon,
}: { label: string; value?: ReactNode; sub?: string; onPress?: () => void; chevron?: boolean; testID?: string; valueInk?: Ink; strong?: boolean; accessory?: ReactNode; subInk?: Ink; icon?: ReactNode }) {
  const p = usePalette();
  const body = (
    <>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T v={strong ? 'strong' : 'body'}>{label}</T>
        {sub && <T v="meta" c={subInk}>{sub}</T>}
      </View>
      {value !== undefined && (typeof value === 'string' ? <T v="value" c={valueInk} lines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</T> : value)}
      {accessory}
      {(chevron ?? !!onPress) && <Chevron color={p.ink4} />}
    </>
  );
  if (!onPress) return <View style={st.row} testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.row, pressed && { backgroundColor: p.sunken }]}>
      {body}
    </Pressable>
  );
}

/**
 * 알림 한 줄: 종류 아이콘, 제목, 내용, 시각 세 줄. 새 알림은 굵은 제목과 오른쪽 파란 점(제목 줄 가운데).
 * Group 안에 Row처럼 넣는다.
 */
export function NoteRow({
  icon, title, line, time, fresh, onPress, testID,
}: { icon: ReactNode; title: string; line: string; time: string; fresh?: boolean; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  const body = (
    <>
      <View style={st.noteHead}>
        {icon}
        <T v={fresh ? 'strong' : 'body'} style={{ flex: 1 }}>
          {title}
        </T>
        {fresh && <View style={[st.noteNew, { backgroundColor: p.accent }]} testID={testID ? `${testID}-new` : undefined} />}
      </View>
      <View style={st.noteBody}>
        <T v="sub" c="ink2">
          {line}
        </T>
        <T v="meta" c="ink3">
          {time}
        </T>
      </View>
    </>
  );
  const a11y = `${fresh ? '새 알림. ' : ''}${title}. ${line}. ${time}`;
  if (!onPress) {
    return (
      <View style={st.noteRow} testID={testID} accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [st.noteRow, pressed && { backgroundColor: p.sunken }]}>
      {body}
    </Pressable>
  );
}

export type Tone = 'accent' | 'attention' | 'quiet';
export function StatusDot({ tone = 'quiet', label, busy, testID, v = 'subStrong' }: { tone?: Tone; label: string; busy?: boolean; testID?: string; v?: TypeName }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy || reduce) {
      o.setValue(1);
      return;
    }
    const half = motion.pulse / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 0.45, duration: half, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: half, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reduce, o]);
  const color = tone === 'accent' ? p.accent : tone === 'attention' ? p.attention : p.ink3;
  return (
    <View style={st.status} testID={testID} accessible accessibilityLabel={label}>
      <Animated.View style={[st.dot, { backgroundColor: color, opacity: o }]} />
      <T v={v} c={tone === 'quiet' ? 'ink2' : tone}>
        {label}
      </T>
    </View>
  );
}

export function Notice({ children, tone = 'attention', testID, sub }: { children: ReactNode; tone?: 'attention' | 'quiet'; testID?: string; sub?: string }) {
  const p = usePalette();
  return (
    <View style={[st.notice, { backgroundColor: tone === 'attention' ? p.attentionSoft : p.tint, gap: space.s1 }]} testID={testID} accessibilityRole="alert">
      <T v="sub" c={tone === 'attention' ? 'attention' : 'ink2'}>
        {children}
      </T>
      {sub && (
        <T v="meta" c="ink2" testID={testID ? `${testID}-sub` : undefined}>
          {sub}
        </T>
      )}
    </View>
  );
}

export function Replies<K extends string>({
  options, chosen, onChoose, testID,
}: { options: Array<{ key: K; label: string; sub?: string }>; chosen?: K | null; onChoose: (k: K) => void; testID?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.s2 }} testID={testID} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = chosen === o.key;
        const dim = chosen != null && !on;
        return (
          <Pressable
            key={o.key}
            testID={`${testID ?? 'reply'}-${o.key}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChoose(o.key);
            }}
            style={({ pressed }) => [
              st.reply,
              { backgroundColor: pressed ? p.sunken : p.tint, borderColor: on ? p.ink : 'transparent', opacity: dim ? 0.45 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <T v="subStrong">{o.label}</T>
              {o.sub && <T v="meta" c="ink3">{o.sub}</T>}
            </View>
            {on && <Check color={p.ink} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Seg<K extends string>({ options, value, onChange, testID, style }: { options: Array<{ key: K; label: string }>; value: K | null; onChange: (k: K) => void; testID?: string; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[st.seg, { backgroundColor: p.tint }, style]} testID={testID} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            testID={`${testID ?? 'seg'}-${o.key}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.key);
            }}
            style={[st.segItem, on && { backgroundColor: p.overlay === p.tint ? p.sunken : p.overlay, ...shadowCard }]}
          >
            <T v="subStrong" c={on ? 'ink' : 'ink3'}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const shadowCard = { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 };

export function Pill({ label, onPress, testID, quiet }: { label: string; onPress: () => void; testID?: string; quiet?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [st.pill, { backgroundColor: pressed ? p.sunken : quiet ? 'transparent' : p.canvas }]}
    >
      <T v="label" c={quiet ? 'ink2' : 'ink'} lines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function Empty({ title, sub, action, testID }: { title: string; sub?: string; action?: ReactNode; testID?: string }) {
  return (
    <View style={st.empty} testID={testID}>
      <View style={{ gap: space.s2, alignItems: 'center' }}>
        <T v="strong" center>
          {title}
        </T>
        {sub && (
          <T v="sub" c="ink2" center>
            {sub}
          </T>
        )}
      </View>
      {action && <View style={{ alignSelf: 'stretch' }}>{action}</View>}
    </View>
  );
}

export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return '접속 기록 없음';
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export { josa } from './josa';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const st = StyleSheet.create({
  header: { height: size.header, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s2 },
  headerSide: { width: 72, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  back: { width: size.hit, height: size.hit, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s6, gap: space.s6 },
  footer: { paddingHorizontal: space.s5, paddingTop: space.s3, gap: space.s2, borderTopWidth: StyleSheet.hairlineWidth },
  btn: { minHeight: size.button, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s5 },
  btnSm: { minHeight: size.buttonSm, paddingHorizontal: space.s4 },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.s4 },
  row: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s3 },
  noteRow: { gap: 2, paddingHorizontal: space.s4, paddingVertical: space.s3 + 2 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  noteBody: { gap: 2, paddingLeft: 18 + space.s3 },
  noteNew: { width: 8, height: 8, borderRadius: radius.full },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pill: { minHeight: 36, minWidth: 52, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.s5, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  notice: { borderRadius: radius.md, paddingVertical: space.s3, paddingHorizontal: space.s4 },
  reply: { minHeight: size.row, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s4, paddingVertical: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  seg: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, minHeight: 38, borderRadius: radius.sm + 1, alignItems: 'center', justifyContent: 'center' },
});

export function ConfirmSheet({ title, body, yes, no, onYes, onNo }: { title: string; body?: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onNo}>
      <View style={StyleSheet.absoluteFill} testID="confirm-sheet">
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onNo} accessibilityLabel={no} accessibilityRole="button" />
        <View style={[sheetSt.sheet, { backgroundColor: p.canvas, paddingBottom: Math.max(inset.bottom, space.s4) }]} accessibilityViewIsModal>
          <View style={[sheetSt.grabber, { backgroundColor: p.sunken }]} />
          <View style={sheetSt.body}>
            <T v="title" role="header">
              {title}
            </T>
            {body ? (
              <T v="sub" c="ink2">
                {body}
              </T>
            ) : null}
          </View>
          <View style={sheetSt.footer}>
            <Button label={yes} onPress={onYes} testID="confirm-yes" />
            <Button kind="quiet" label={no} onPress={onNo} testID="confirm-no" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const sheetSt = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  body: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s3 },
  footer: { paddingHorizontal: space.s5, paddingTop: space.s2, gap: space.s2 },
});
