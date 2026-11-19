// 첫 실행 단계 표시(온보딩 세 장 → 열쇠 만들기 → PC와 연결). 고른 점은 길게(ink), 나머지는 짧게(ink4).
// 온보딩 화면은 넘기는 위치를 따라 늘고 주는 같은 모양을 직접 그린다(OnboardingScreen Dots). 여기는 멈춘 단계용.
import { StyleSheet, View } from 'react-native';
import { space, usePalette } from '../theme';

/** 첫 실행 단계 수: 온보딩 3 + 열쇠 1 + PC 연결 1 */
export const FIRST_RUN_STEPS = 5;
export const STEP_KEY = 3;
export const STEP_PAIR = 4;

export function StepDots({ index, total = FIRST_RUN_STEPS, testID }: { index: number; total?: number; testID?: string }) {
  const p = usePalette();
  return (
    <View style={st.dots} accessible accessibilityRole="text" accessibilityLabel={`${total}단계 중 ${index + 1}단계`} testID={testID}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={st.slot}>
          <View style={[st.dot, i === index ? { width: 20, backgroundColor: p.ink } : { backgroundColor: p.ink4 }]} />
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.s1, height: 6 },
  slot: { width: 20, height: 6, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
