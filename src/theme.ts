import { createContext, useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

const light = {
  canvas: '#FCFCFC',
  tint: '#F3F4F5',
  sunken: '#E9EAEB',
  overlay: '#FFFFFF',
  /** 시트(overlay) 위의 채움 면. 어두운 모드에서는 시트 면과 같은 색이라 한 단계 밝힌다. */
  raisedTint: '#F3F4F5',
  line: '#ECEDEE',
  lineStrong: '#8F9296',
  ink: '#111112',
  ink2: '#4B4D4F',
  ink3: '#686A6E',
  ink4: '#A1A4A8',
  onInk: '#FFFFFF',
  accent: '#0064D4',
  accentSoft: '#EBF3FD',
  onAccent: '#FFFFFF',
  attention: '#8A5A0B',
  attentionSoft: '#FBF3E4',
  /** 취소 아이콘(동그라미 X)에만 쓴다(v3.0 확정 기준). 글자, 면, 단추에는 쓰지 않는다. */
  danger: '#D92D20',
  scrim: '#11111233',
  dim: '#11111280',
  bubbleMe: '#CBE5FF',
  onBubbleMe: '#111112',
  bubbleThem: '#E9EAEB',
  stamp: '#00040996',
  typingDot: '#0007115E',
  typingDotDim: '#00071118',
  camera: '#000000',
  onCamera: '#FFFFFF',
  cameraVeil: '#00000099',
};
const dark: typeof light = {
  canvas: '#181819',
  tint: '#232425',
  sunken: '#2E2F31',
  overlay: '#232425',
  raisedTint: '#2E2F31',
  line: '#2A2B2D',
  lineStrong: '#76797D',
  ink: '#F3F4F5',
  ink2: '#C4C6C9',
  ink3: '#989B9E',
  ink4: '#5C5E61',
  onInk: '#111112',
  accent: '#4B93FF',
  accentSoft: '#17263D',
  onAccent: '#0B1226',
  attention: '#E0AE55',
  attentionSoft: '#2E2410',
  danger: '#FF6B5E',
  scrim: '#00000080',
  dim: '#000000B8',
  bubbleMe: '#0074E8',
  onBubbleMe: '#FFFFFF',
  bubbleThem: '#1F1F20',
  stamp: '#F2F7FF87',
  typingDot: '#F2F7FF5E',
  typingDotDim: '#F2F7FF18',
  camera: '#000000',
  onCamera: '#FFFFFF',
  cameraVeil: '#00000099',
};
export type Palette = typeof light;
export type Ink = 'ink' | 'ink2' | 'ink3' | 'ink4' | 'onInk' | 'accent' | 'attention' | 'onCamera';

export const space = { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 28, s7: 40 } as const;
/** tip = 말풍선(기준판 sx-tip, 리포트 막대를 누르고 있을 때) */
export const radius = { xs: 3, sm: 8, md: 12, tip: 14, lg: 16, xl: 22, full: 9999 } as const;
export const size = { hit: 44, row: 52, button: 52, buttonSm: 40, header: 48 } as const;

const tnum = ['tabular-nums' as const];
export const type = {
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  strong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  figure: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const, fontVariant: tnum },
  value: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const, fontVariant: tnum },
  sub: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  subStrong: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  /** 카드 값 줄의 값(15, 숫자 폭 고정)과 합계(굵게). */
  subValue: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const, fontVariant: tnum },
  subFigure: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const, fontVariant: tnum },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, fontVariant: tnum },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  /** 카드 안 작은 단추(40)의 주 단추 글. 보조 단추는 subStrong. */
  buttonSm: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  /** 자세히 화면 맨 위 이름(거래처 이름 등). 큰 글씨는 이것과 리포트의 달, 시트의 묻는 말, 페어링 6자리뿐이다. */
  heading: { fontSize: 24, lineHeight: 32, fontWeight: '700' as const },
  /** 리포트 맨 위 달(‹ 11월 ›, 기준판 .ph .rp-month > .t). */
  month: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const, fontVariant: tnum },
  /** 시트에서 한 단계씩 묻는 말과 그 답(밑줄 칸). */
  ask: { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  askValue: { fontSize: 22, lineHeight: 30, fontWeight: '600' as const, fontVariant: tnum },
  sas: { fontSize: 40, lineHeight: 48, fontWeight: '600' as const, fontVariant: tnum, letterSpacing: 8 },
};
export type TypeName = keyof typeof type;

export const MAX_FONT_SCALE = 1.6;
export const textScale = { web: 1 };
export type TextSize = 'small' | 'medium' | 'large';
export const TEXT_SIZE_FACTOR: Record<TextSize, number> = { small: 0.88, medium: 1, large: 1.15 };
export const TextSizeContext = createContext<number>(1);

export const motion = { fast: 120, base: 160, slow: 220, pulse: 2400 } as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setR(v), () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setR);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return r;
}
