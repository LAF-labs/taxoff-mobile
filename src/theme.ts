// 폰 디자인 토큰. 원본은 tex sovereign-ax/design-system/tokens.json v2.0(2026-11-14, "Muse처럼 미니멀하게").
// 색 값과 뜻은 PC와 같다. 크기만 폰 기준으로 옮겼다(docs/design.md):
//   PC 14·13·12 → 폰 17·15·13 (iOS 본문 17pt, Android 본문 16sp를 앱 안에서 17로 맞춘다).
// 규칙(PC와 같음):
//   - 선 대신 면. 바탕 canvas 하나, 묶음·입력은 tint 채움. 테두리는 포커스·확인 필요·빈 입력 칸에만.
//   - 큰 글씨로 강조하지 않는다. 중요한 값은 ink + 600으로만 올린다. 숫자는 고정폭.
//   - 색은 두 뜻뿐: accent(파랑) = 내 차례·승인, attention(황토) = 확인 필요. 완료·실패에 초록·빨강 없음.
//   - 주요 단추는 ink 채움 하나. 파랑 채움은 승인에만(폰 Phase 1에는 승인이 없어 쓰지 않는다).
import { useEffect, useState } from 'react';
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
  /** 카메라 화면 전용(테마와 무관하게 검정 위 흰 글자) */
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
  camera: '#000000',
  onCamera: '#FFFFFF',
  cameraVeil: '#00000099',
};
export type Palette = typeof light;
export type Ink = 'ink' | 'ink2' | 'ink3' | 'ink4' | 'onInk' | 'accent' | 'attention' | 'onCamera';
export const palettes = { light, dark } as const;

/** 4의 배수. 화면 옆 여백은 s5(20), 묶음 사이는 s6(28). */
export const space = { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 28, s7: 40 } as const;
/** 누르는 것은 덜, 담는 것은 더 둥글게(PC radius-md 10 · lg 16 · xl 22를 폰에 그대로). */
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 9999 } as const;
/** 컨트롤 높이. 누름 영역은 44 미만이 없다(HIG 44pt, WCAG 2.5.8). */
export const size = { hit: 44, row: 52, button: 52, buttonSm: 40, header: 48 } as const;

const tnum = ['tabular-nums' as const];
/**
 * 글자 단계는 셋(17·15·13)과 머리 하나(17/600). 굵기는 400·500·600.
 * 한글 라벨에 자간을 넣지 않는다. 숫자가 들어가는 값은 figure 계열(고정폭).
 */
export const type = {
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  strong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  figure: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const, fontVariant: tnum },
  value: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const, fontVariant: tnum },
  sub: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  subStrong: { fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, fontVariant: tnum },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  /** 페어링 6자리만 크게 쓴다(사람이 PC 화면과 한 글자씩 대조하는 값) */
  sas: { fontSize: 40, lineHeight: 48, fontWeight: '600' as const, fontVariant: tnum, letterSpacing: 8 },
};
export type TypeName = keyof typeof type;

/** 글자 크기 설정은 따르되 화면이 깨지지 않게 상한을 둔다. */
export const MAX_FONT_SCALE = 1.6;
/** 화면 갤러리(웹)에서 글자 크기 설정을 흉내 낼 때만 바꾼다(?fs=1.6). 앱에서는 늘 1이고 OS 설정을 따른다. */
export const textScale = { web: 1 };

export const motion = { fast: 120, base: 160, slow: 220, pulse: 2400 } as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 동작 줄이기 설정이면 움직임을 0으로 한다(tokens.json motion 규칙). */
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
