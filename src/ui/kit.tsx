// 폰 화면 공통 부품(design-system v2.0을 폰 크기로, src/theme.ts·docs/design.md).
// - 화면 틀: 머리(48, 뒤로 ‹ + 제목 17/600) · 내용 · 바닥 동작 줄(주요 단추 하나, 안전 영역 위).
// - 단추: primary(ink 채움 알약) 하나, secondary(tint 채움), quiet(글자만). 파랑 채움 없음.
// - 묶음(Group): tint 채움 16 모서리, 줄 사이는 안쪽 선(line) 한 줄. 카드 테두리·그림자 없음.
// - 상태는 점 + 글자(StatusDot). 색은 accent·attention뿐.
// - 답 후보(Reply): 점선 전폭 줄. 고르면 실선 + 체크로 굳고 나머지는 흐려진다(Muse 확인 UI).
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type AccessibilityRole, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_FONT_SCALE, motion, radius, size, space, textScale, type, useReducedMotion, usePalette, type Ink, type TypeName } from '../theme';

/** 한글은 낱말 단위로 줄을 바꾼다(숫자와 단위, 낱말이 쪼개지지 않게). iOS는 hangul-word, 웹(갤러리)은 keep-all. */
// overflowWrap anywhere: 띄어쓰기 없는 긴 값(이메일 등)은 넘칠 때만 아무 데서나 끊는다.
const keepAll = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as unknown as TextStyle;

/** 가운뎃점(·)이 줄 끝에 홀로 남지 않게: 점 뒤 칸을 붙은 칸으로 바꿔 점이 다음 낱말과 함께 넘어가게 한다. */
export const glueDots = (t: string) => t.replace(/ · /g, ' ·\u00A0');
const glue = (c: ReactNode): ReactNode => (typeof c === 'string' ? glueDots(c) : Array.isArray(c) ? c.map(glue) : c);

/** 누를 때 가벼운 진동. 실패해도 조용히 넘긴다(진동이 없는 기기·설정). */
export const tap = () => void Haptics.selectionAsync().catch(() => {});
export const success = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
export const warn = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

// ── 글자 ──
export function T({
  children, v = 'body', c = 'ink', style, testID, lines, center, role,
}: { children: ReactNode; v?: TypeName; c?: Ink; style?: StyleProp<TextStyle>; testID?: string; lines?: number; center?: boolean; role?: AccessibilityRole }) {
  const p = usePalette();
  const base = type[v];
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
      {glue(children)}
    </Text>
  );
}

// ── 화면 틀 ──
export function Screen({
  title, onBack, backLabel = '뒤로', right, children, footer, scroll = true, testID, style, tabbed,
}: {
  title?: string; onBack?: () => void; backLabel?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; testID?: string; style?: StyleProp<ViewStyle>;
  /** 아래 탭 줄 위에 놓이는 화면: 안전 영역은 탭 줄이 맡는다. */
  tabbed?: boolean;
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const head = title !== undefined || onBack || right;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: p.canvas }, style]} testID={testID}>
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
      {/* 바닥 동작 줄이 있으면 키보드 위로 함께 올린다(주요 단추가 키보드에 가리지 않게). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={footer && Platform.OS === 'ios' ? 'padding' : undefined} enabled={!!footer}>
      {scroll ? (
        <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={!footer}>
          {children}
        </ScrollView>
      ) : (
        <View style={[st.content, { flex: 1 }]}>{children}</View>
      )}
      {footer && <View style={[st.footer, { paddingBottom: tabbed ? space.s3 : Math.max(inset.bottom, space.s4), backgroundColor: p.canvas, borderTopColor: p.line }]}>{footer}</View>}
      </KeyboardAvoidingView>
      {!footer && !tabbed && <View style={{ height: inset.bottom }} />}
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

/** 글꼴 없이 그리는 꺾쇠(10×10 두 변). 아이콘 묶음을 들이지 않는다. */
export function Chevron({ dir = 'right', color, sizePx = 9 }: { dir?: 'left' | 'right' | 'down'; color: string; sizePx?: number }) {
  const rot = dir === 'left' ? '-135deg' : dir === 'down' ? '135deg' : '45deg';
  return <View style={{ width: sizePx, height: sizePx, borderTopWidth: 2, borderRightWidth: 2, borderColor: color, transform: [{ rotate: rot }], marginHorizontal: 4 }} />;
}

export function Check({ color }: { color: string }) {
  return <View style={{ width: 12, height: 7, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '-45deg' }], marginTop: -3 }} />;
}

// ── 단추 ──
/** approve: 파랑 채움. 폰 앱에서 승인 시트의 [승인하고 발급] 하나에만 쓴다(ADR-046 결정 6, docs/design.md). */
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

// ── 묶음과 줄 ──
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

/** 목록 줄: 왼쪽 라벨, 오른쪽 값(또는 꺾쇠). 누를 수 있으면 누름 면이 생긴다. */
export function Row({
  label, value, sub, onPress, chevron, testID, valueInk = 'ink2', strong, accessory,
}: { label: string; value?: ReactNode; sub?: string; onPress?: () => void; chevron?: boolean; testID?: string; valueInk?: Ink; strong?: boolean; accessory?: ReactNode }) {
  const p = usePalette();
  const body = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <T v={strong ? 'strong' : 'body'}>{label}</T>
        {sub && <T v="meta" c="ink3">{sub}</T>}
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

// ── 상태 ──
export type Tone = 'accent' | 'attention' | 'quiet';
/** 점 + 글자. busy면 점이 숨 쉬듯 흐려졌다 돌아온다(motion-pulse, 동작 줄이기면 멈춤). */
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

/** 확인이 필요한 한 줄(attention-soft 면). 사라지는 토스트 대신 그 자리에 남긴다. */
export function Notice({ children, tone = 'attention', testID }: { children: ReactNode; tone?: 'attention' | 'quiet'; testID?: string }) {
  const p = usePalette();
  return (
    <View style={[st.notice, { backgroundColor: tone === 'attention' ? p.attentionSoft : p.tint }]} testID={testID} accessibilityRole="alert">
      <T v="sub" c={tone === 'attention' ? 'attention' : 'ink2'}>
        {children}
      </T>
    </View>
  );
}

// ── 답 후보 ──
/** 점선 전폭 줄. chosen이 있으면 그 줄은 실선 + 체크, 나머지는 흐려진다. */
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
              { borderColor: on ? p.ink : p.lineStrong, borderStyle: on ? 'solid' : 'dashed', opacity: dim ? 0.45 : 1 },
              pressed && { backgroundColor: p.tint },
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

/** 둘 중 하나(두 칸 전환). */
export function Seg<K extends string>({ options, value, onChange, testID }: { options: Array<{ key: K; label: string }>; value: K | null; onChange: (k: K) => void; testID?: string }) {
  const p = usePalette();
  return (
    <View style={[st.seg, { backgroundColor: p.tint }]} testID={testID} accessibilityRole="radiogroup">
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
            // 다크에서는 overlay가 tint와 같아 고른 칸이 사라진다: 한 단 밝은 sunken으로 올린다.
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

/** 묶음(tint) 안 줄에 붙는 작은 동작: 바탕색 알약 36, 누름 영역 44. */
export function Pill({ label, onPress, testID, quiet }: { label: string; onPress: () => void; testID?: string; /** 글자만(덜 중요한 동작, 예: 건별 빼기) */ quiet?: boolean }) {
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

/** 빈 화면: 무엇이 비었는지 한 줄, 왜인지 한 줄, 다음 할 일 하나(막다른 화면을 만들지 않는다). */
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

// ── 표기 ──
export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return '접속 기록 없음';
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

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
  status: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pill: { minHeight: 36, minWidth: 52, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.s5, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  notice: { borderRadius: radius.md, paddingVertical: space.s3, paddingHorizontal: space.s4 },
  reply: { minHeight: size.row, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s4, paddingVertical: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  seg: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, minHeight: 38, borderRadius: radius.sm + 1, alignItems: 'center', justifyContent: 'center' },
});
