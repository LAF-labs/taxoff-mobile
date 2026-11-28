import * as Haptics from 'expo-haptics';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type AccessibilityRole, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShellTop, TOP_SPACE } from './float';
import { Glyph } from './glyph';
import { MAX_FONT_SCALE, TextSizeContext, motion, radius, size, space, textScale, type, useReducedMotion, usePalette, type Ink, type TypeName } from '../theme';

const keepAll = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as unknown as TextStyle;


/** 시트 안처럼 overlay 면 위에 있으면 묶음 면을 한 단계 밝힌다(어두운 모드). */
export const Raised = createContext(false);

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
  title, onBack, backLabel = '뒤로', backText, right, children, footer, cta, scroll = true, testID, style, shell, gap,
}: {
  title?: string; onBack?: () => void; backLabel?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; testID?: string; style?: StyleProp<ViewStyle>;
  /** 뒤로 단추에 글을 붙인다(iOS 기본 뒤로: ‹ 거래처). 글은 backLabel이 아니라 이 값이다. */
  backText?: string;
  /** 바닥에 뜬 주 단추 줄(선 없이 위로 본문이 흐려지며 지나간다). footer와 함께 쓰지 않는다. */
  cta?: ReactNode;
  /** 본문 줄 사이 간격. 목록 화면은 space.s2. */
  gap?: number;
  /** 맨 위 화면(더보기 메뉴로 오가는 화면): 머리 줄 대신 떠 있는 더보기, 제목, PC 상태를 두고 본문이 그 밑으로 지나간다. */
  shell?: boolean;
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const bottom = space.s6 + inset.bottom + (cta ? CTA_SPACE : 0);
  const head = !shell && (title !== undefined || onBack || right);
  const top = [shell ? { paddingTop: inset.top + TOP_SPACE } : null, gap !== undefined ? { gap } : null];
  return (
    <SafeAreaView edges={shell ? ['left', 'right'] : ['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: p.canvas }, style]} testID={testID}>
      {head && (
        <View style={st.header}>
          <View style={[st.headerSide, backText !== undefined && st.headerWide]}>{onBack && <Back onPress={onBack} label={backLabel} text={backText} />}</View>
          {title !== undefined ? (
            <T v="title" lines={1} role="header" style={st.headerTitle}>
              {title}
            </T>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <View style={[st.headerSide, backText !== undefined && st.headerWide, { alignItems: 'flex-end' }]}>{right}</View>
        </View>
      )}
      {}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={(footer || cta) && Platform.OS === 'ios' ? 'padding' : undefined} enabled={!!(footer || cta)}>
      {scroll ? (
        <ScrollView contentContainerStyle={[st.content, top, !footer && { paddingBottom: bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={!footer && !cta}>
          {children}
        </ScrollView>
      ) : (
        <View style={[st.content, top, { flex: 1 }, !footer && { paddingBottom: bottom }]}>{children}</View>
      )}
      {footer && <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4), backgroundColor: p.canvas, borderTopColor: p.line }]}>{footer}</View>}
      {cta && <FloatCta>{cta}</FloatCta>}
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

function Back({ onPress, label, text }: { onPress: () => void; label: string; text?: string }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={({ pressed }) => [text !== undefined ? st.backText : st.back, pressed && { opacity: 0.5 }]} testID="back">
      <Chevron dir="left" color={p.ink} />
      {text !== undefined && (
        <T lines={1} style={{ flexShrink: 1 }}>
          {text}
        </T>
      )}
    </Pressable>
  );
}

/** 머리 줄 오른쪽 글 단추(수정 등). */
export function TextButton({ label, onPress, testID, disabled }: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} hitSlop={6} onPress={onPress} style={({ pressed }) => [st.textBtn, pressed && { opacity: 0.5 }]}>
      <T c={disabled ? 'ink4' : 'ink'}>{label}</T>
    </Pressable>
  );
}

const CTA_SPACE = size.button + space.s6;
const CTA_FADE = Array.from({ length: 12 }, (_, i) => Number((((i + 1) / 12) ** 1.4).toFixed(2)));

/** 바닥에 뜬 주 단추 줄: 화면 폭을 다 쓰는 단추. 위 24는 바탕색으로 서서히 덮어 본문이 흐려지며 지나간다. */
function FloatCta({ children }: { children: ReactNode }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={st.cta}>
      <View pointerEvents="none">
        {CTA_FADE.map((o, i) => (
          <View key={i} style={{ height: 2, backgroundColor: p.canvas, opacity: o }} />
        ))}
      </View>
      <View style={[st.ctaRow, { backgroundColor: p.canvas, paddingBottom: Math.max(inset.bottom, space.s4) }]}>{children}</View>
    </View>
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
/** 카드 안인지 알리는 값. Card(src/ui/card.tsx)만 켠다. */
export const OnCard = createContext(false);

export function Button({
  label, onPress, kind = 'primary', disabled, busy, testID, style, small: smallProp, hint,
}: { label: string; onPress: () => void; kind?: Kind; disabled?: boolean; busy?: boolean; testID?: string; style?: StyleProp<ViewStyle>; small?: boolean; hint?: string }) {
  const p = usePalette();
  // 카드 안 단추는 언제나 40이고 보조 단추 면이 바탕색이다(기준판 .ph .sx-card .sx-btn). 화면이 따로 정하지 않는다.
  const onCard = useContext(OnCard);
  const raised = useContext(Raised);
  const small = smallProp ?? onCard;
  const bg = kind === 'primary' ? p.ink : kind === 'approve' ? p.accent : kind === 'secondary' ? (onCard ? p.canvas : raised ? p.raisedTint : p.tint) : 'transparent';
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
      {busy ? <ActivityIndicator color={fg} /> : <T v={small ? (kind === 'primary' || kind === 'approve' ? 'buttonSm' : 'subStrong') : 'button'} style={{ color: off ? p.ink4 : fg }} lines={1}>{label}</T>}
    </Pressable>
  );
}

export function Group({ children, title, note, style, testID }: { children: ReactNode; title?: string; note?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const p = usePalette();
  const raised = useContext(Raised);
  const items = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <View style={[{ gap: space.s2 }, style]} testID={testID}>
      {title && (
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          {title}
        </T>
      )}
      <View style={[st.group, { backgroundColor: raised ? p.raisedTint : p.tint }]}>
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
  label, value, sub, onPress, chevron, testID, valueInk = 'ink2', strong, accessory, subInk = 'ink3', icon, mark, a11y, active, lines,
}: {
  label: string; value?: ReactNode; sub?: string; onPress?: () => void; chevron?: boolean; testID?: string; valueInk?: Ink; strong?: boolean; accessory?: ReactNode; subInk?: Ink; icon?: ReactNode;
  /** 찾은 글자: 이름 안에서 굵게 보인다. */
  mark?: string;
  a11y?: string;
  /** 누른 뒤 일이 끝날 때까지(문서 받는 중) 줄에 눌린 면을 남긴다. */
  active?: boolean;
  /** 이름이 길면 줄 수를 묶는다. */
  lines?: number;
}) {
  const p = usePalette();
  const at = mark ? label.toLowerCase().indexOf(mark.trim().toLowerCase()) : -1;
  const n = mark?.trim().length ?? 0;
  const body = (
    <>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T v={strong ? 'strong' : 'body'} lines={lines ?? (sub ? 1 : undefined)}>
          {at >= 0 && n > 0 ? (
            <>
              {label.slice(0, at)}
              <T v="strong">{label.slice(at, at + n)}</T>
              {label.slice(at + n)}
            </>
          ) : (
            label
          )}
        </T>
        {sub && <T v="meta" c={subInk}>{sub}</T>}
      </View>
      {value !== undefined && (typeof value === 'string' ? <T v="value" c={valueInk} lines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</T> : value)}
      {accessory}
      {(chevron ?? !!onPress) && <Chevron color={p.ink4} />}
    </>
  );
  if (!onPress) return <View style={st.row} testID={testID} accessible={!!a11y} accessibilityLabel={a11y}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ busy: !!active }} onPress={onPress} style={({ pressed }) => [st.row, (pressed || active) && { backgroundColor: p.sunken }]}>
      {body}
    </Pressable>
  );
}

/** 도는 고리: 줄 끝 꺾쇠 자리에서 받는 중을 보인다. 움직임 줄이기를 켜면 멈춘 고리다. */
export function Ring({ label, testID }: { label: string; testID?: string }) {
  const p = usePalette();
  const still = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [still]);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} testID={testID} style={st.ringBox}>
      <View style={[st.ring, { borderColor: p.sunken }]} />
      <Animated.View style={[st.ring, StyleSheet.absoluteFill, { borderColor: 'transparent', borderTopColor: p.ink2, borderRightColor: p.ink2, transform: [{ rotate }] }]} />
    </View>
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

export function Notice({ children, tone = 'attention', testID, sub, icon }: { children: ReactNode; tone?: 'attention' | 'quiet'; testID?: string; sub?: string; icon?: boolean }) {
  const p = usePalette();
  if (icon) {
    // 기준판 sx-note: 세모 느낌표 + 본문 글씨(확인 필요 면).
    return (
      <View style={[st.notice, st.noticeRow, { backgroundColor: tone === 'attention' ? p.attentionSoft : p.tint }]} testID={testID} accessibilityRole="alert">
        <Glyph kind="attention" color={tone === 'attention' ? p.attention : p.ink3} size={16} />
        <T v="sub" style={{ flex: 1 }}>
          {children}
        </T>
      </View>
    );
  }
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

/**
 * 고르기 줄(기준판 .ph .sx-seg): 알약 모양, 내용 폭만큼 왼쪽에. 고른 칸은 바탕색 면에 굵은 글씨.
 * fill이면 줄 폭을 나눠 쓴다(설정의 글자 크기처럼 두세 칸을 고르는 곳). 카드 안에서는 면이 바탕색이 된다.
 * tint: 카드 안에서도 기준판 sx-seg 그대로(틀은 tint, 고른 칸은 바탕색). 리포트 카드의 [매출] [매입](기준판 Phone-Report).
 */
export function Seg<K extends string>({ options, value, onChange, testID, style, fill, tint }: { options: Array<{ key: K; label: string }>; value: K | null; onChange: (k: K) => void; testID?: string; style?: StyleProp<ViewStyle>; fill?: boolean; tint?: boolean }) {
  const p = usePalette();
  const onCard = useContext(OnCard) && !tint;
  const raised = useContext(Raised);
  const face = onCard ? p.canvas : raised ? p.raisedTint : p.tint;
  const on = onCard ? p.sunken : p.overlay === p.tint ? p.sunken : p.canvas;
  return (
    <View style={[st.seg, fill ? st.segFill : st.segInline, { backgroundColor: face }, style]} testID={testID} accessibilityRole="radiogroup">
      {options.map((o) => {
        const sel = value === o.key;
        return (
          <Pressable
            key={o.key}
            testID={`${testID ?? 'seg'}-${o.key}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            onPress={() => {
              tap();
              onChange(o.key);
            }}
            style={[st.segItem, fill && { flex: 1 }, sel && { backgroundColor: on }]}
          >
            <T v={sel ? 'buttonSm' : 'sub'} c={sel ? 'ink' : 'ink2'} lines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}


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

/**
 * 빈 화면(기준판 ph-empty, ph-blank): 단추가 있으면 굵은 한 줄과 꽉 찬 주 단추, 없으면 아이콘과 보통 굵기 한 줄.
 */
export function Empty({ title, sub, action, testID, icon }: { title: string; sub?: string; action?: ReactNode; testID?: string; icon?: ReactNode }) {
  return (
    <View style={[st.empty, !action && { gap: space.s3 }]} testID={testID}>
      <View style={{ gap: space.s2, alignItems: 'center' }}>
        {icon}
        <T v={action ? 'strong' : 'sub'} c={action ? 'ink' : 'ink2'} center>
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

/** 금액 글. 수정세금계산서의 음수는 빼기 기호(−)로 쓴다. */
/** 금액 글. 숫자가 아니면 빈 글이라 그 줄이 빠진다(src/ui/text.ts shown). */
export const won = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}원` : '');
const WON_UNITS: Array<[number, string]> = [[1e12, '조'], [1e8, '억'], [1e4, '만']];
/** 큰 금액은 조, 억, 만으로 나눠 쓴다(886억 5,627만 3,113원). */
export const bigWon = (n: number | null | undefined) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  let rest = Math.abs(Math.round(n));
  const parts: string[] = [];
  for (const [u, name] of WON_UNITS) {
    const q = Math.floor(rest / u);
    if (q) parts.push(`${q.toLocaleString('ko-KR')}${name}`);
    rest -= q * u;
  }
  if (rest || !parts.length) parts.push(rest.toLocaleString('ko-KR'));
  return `${n < 0 ? '−' : ''}${parts.join(' ')}원`;
};
export const st = StyleSheet.create({
  header: { height: size.header, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s2 },
  headerSide: { width: 72, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerWide: { width: 120 },
  back: { width: size.hit, height: size.hit, alignItems: 'center', justifyContent: 'center' },
  backText: { height: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s1, paddingLeft: space.s2 + 2, paddingRight: space.s2 },
  textBtn: { height: size.hit, paddingHorizontal: space.s3, justifyContent: 'center' },
  cta: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  ctaRow: { paddingHorizontal: space.s5, gap: space.s2 },
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
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 - 2, padding: space.s3 },
  reply: { minHeight: size.row, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s4, paddingVertical: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  ringBox: { width: 18, height: 18 },
  ring: { width: 18, height: 18, borderRadius: radius.full, borderWidth: 2.2 },
  seg: { flexDirection: 'row', borderRadius: radius.full, padding: 3 },
  segInline: { alignSelf: 'flex-start' },
  segFill: { alignSelf: 'stretch' },
  segItem: { height: 32, paddingHorizontal: 14, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});


