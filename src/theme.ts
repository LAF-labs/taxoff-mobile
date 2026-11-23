import { createContext, useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

const light = {
  canvas: '#FCFCFC',
  tint: '#F3F4F5',
  sunken: '#E9EAEB',
  overlay: '#FFFFFF',
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
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 9999 } as const;
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
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, fontVariant: tnum },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
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
