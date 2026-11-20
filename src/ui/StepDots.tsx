import { StyleSheet, View } from 'react-native';
import { space, usePalette } from '../theme';

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
