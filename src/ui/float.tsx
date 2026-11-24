import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, usePalette } from '../theme';

/**
 * 폰 틀: 아래 탭바 없이 왼쪽 위 더보기, 오른쪽 위 PC 상태, 아래에 떠 있는 입력창.
 * ChatGPT iOS 캡처(393pt)를 재서 맞춘 값을 따른다(2026-11-24 대표 승인, 기준판 폰 화면).
 * 위 단추: 44, 화면 끝에서 16, 상태 막대 바로 아래. 입력창: 양옆 38, 높이 46, 홈 인디케이터 위 4. 맨 아래로 단추: 34, 입력창 위 14.
 */
export const FLOAT_H = 44;
/** 위 단추 줄이 차지하는 높이(상태 막대 아래). 본문 맨 위 여백으로 쓴다. */
export const TOP_SPACE = space.s1 + FLOAT_H + space.s3;
export const CAPSULE_H = 46;
export const CAPSULE_SIDE = 38;
export const DOWN_SIZE = 34;
export const DOWN_GAP = 14;

/** 더보기 메뉴와 오른쪽 위 PC 상태. 맨 위 화면(대화, 돈, 발급 기록, 알림함, 설정)이 같이 쓴다. */
export interface ShellValue {
  onMenu: () => void;
  badge: boolean;
  right: ReactNode;
}
export const Shell = createContext<ShellValue | null>(null);
export const useShell = () => useContext(Shell);

/** 뒤 글이 비치는 유리 면(대표: 좀 투명한 단추). iOS 26은 애플 기본 유리 중 맑은 유리(clear), 그 전은 가장 얇은 흐림. */
function Glass({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="clear" isInteractive style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={40} tint={dark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'} style={style}>
      {children}
    </BlurView>
  );
}

function useFace() {
  const p = usePalette();
  return { borderColor: p.line, shadowColor: p.ink };
}

export function FloatPill({ children, onPress, warn, label, testID }: { children: ReactNode; onPress: () => void; warn?: boolean; label: string; testID?: string }) {
  const face = useFace();
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={onPress} style={({ pressed }) => [st.shadow, face, pressed && st.pressed]}>
      <Glass style={[st.face, st.pill, face, warn && { backgroundColor: p.attentionSoft }]}>{children}</Glass>
    </Pressable>
  );
}

export function FloatButton({ children, onPress, label, badge, testID }: { children: ReactNode; onPress: () => void; label: string; badge?: boolean; testID?: string }) {
  const face = useFace();
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, 새 알림 있음` : label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [st.shadow, face, pressed && st.pressed]}
    >
      <Glass style={[st.face, st.round, face]}>{children}</Glass>
      {badge && <View testID={testID ? `${testID}-badge` : undefined} style={[st.badge, { backgroundColor: p.accent }]} />}
    </Pressable>
  );
}

/** 더보기 그림: 긴 줄과 짧은 줄. */
export function MenuGlyph({ color }: { color: string }) {
  return (
    <View style={st.menuGlyph} aria-hidden>
      <View style={[st.menuLine, { width: 18, backgroundColor: color }]} />
      <View style={[st.menuLine, { width: 11, backgroundColor: color }]} />
    </View>
  );
}

const FADE = Array.from({ length: 10 }, (_, i) => Number(((1 - i / 10) ** 1.6).toFixed(2)));
/** 상태 막대 자리는 바탕색으로 채우고, 그 아래 20pt는 서서히 비춘다. */
export function TopFade() {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={st.fade}>
      <View style={{ height: inset.top, backgroundColor: p.canvas }} />
      {FADE.map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: p.canvas, opacity: o }} />
      ))}
    </View>
  );
}

/** 맨 위 화면의 위 줄: 왼쪽 더보기, 가운데 제목, 오른쪽 PC 상태. 본문은 그 밑으로 지나간다. */
export function ShellTop({ title }: { title?: ReactNode }) {
  const sh = useShell();
  const p = usePalette();
  const inset = useSafeAreaInsets();
  if (!sh) return null;
  return (
    <>
      <TopFade />
      <View pointerEvents="box-none" style={[st.top, { top: inset.top + space.s1 }]}>
        {title !== undefined && (
          <View pointerEvents="none" style={st.title}>
            {title}
          </View>
        )}
        <FloatButton testID="menu" label="더보기 메뉴" badge={sh.badge} onPress={sh.onMenu}>
          <MenuGlyph color={p.ink} />
        </FloatButton>
        {sh.right}
      </View>
    </>
  );
}

/** 떠 있는 입력창 면(높이 46 캡슐). 안의 [+], 글 칸, 보내기는 화면이 넣는다. */
export function Capsule({ children, testID }: { children: ReactNode; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={[st.capsule, st.shadow, { backgroundColor: p.overlay, borderColor: p.line, shadowColor: p.ink }]}>
      {children}
    </View>
  );
}

/** 대화 아래 맨 아래로 단추(34 동그라미). 새 답이 왔으면 글을 붙여 알약으로 넓어진다. */
export function DownButton({ onPress, label, children, wide, testID }: { onPress: () => void; label: string; children: ReactNode; wide?: boolean; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [st.down, wide && st.downWide, st.shadow, { backgroundColor: pressed ? p.sunken : p.overlay, borderColor: p.line, shadowColor: p.ink }]}
    >
      {children}
    </Pressable>
  );
}

export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const off = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      on.remove();
      off.remove();
    };
  }, []);
  return shown;
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: space.s4, right: space.s4, height: FLOAT_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { position: 'absolute', left: FLOAT_H + space.s4, right: FLOAT_H + space.s4, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  shadow: { borderRadius: radius.full, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  pressed: { opacity: 0.7 },
  face: { height: FLOAT_H, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: space.s4 },
  round: { width: FLOAT_H, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 7, right: 7, width: 8, height: 8, borderRadius: radius.full },
  menuGlyph: { width: 18, gap: 5, alignItems: 'flex-start' },
  menuLine: { height: 2, borderRadius: radius.full },
  downWide: { paddingLeft: space.s3, paddingRight: space.s4 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  capsule: { flexDirection: 'row', alignItems: 'flex-end', minHeight: CAPSULE_H, borderRadius: CAPSULE_H / 2, borderWidth: StyleSheet.hairlineWidth, paddingLeft: space.s1, paddingRight: 7, paddingVertical: (CAPSULE_H - 38) / 2, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  down: { minWidth: DOWN_SIZE, height: DOWN_SIZE, flexDirection: 'row', gap: space.s1, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
