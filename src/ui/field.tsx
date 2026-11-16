// 확인 화면의 값 칸: "값은 글자, 누르면 칸"(design-system v2.0)을 폰 한 줄로.
// 읽은 값의 확신이 낮으면 '확인해 주세요'(attention)를 붙인다. 사장님이 고치면 사라진다. 오류는 칸 아래에 남긴다(사라지는 토스트 없음).
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { MAX_FONT_SCALE, radius, space, textScale, type, usePalette } from '../theme';
import { T } from './kit';

export { masked, type Mask } from './mask.ts';
import { masked, type Mask } from './mask.ts';

const KB: Record<Mask, KeyboardTypeOptions> = { won: 'number-pad', bizNo: 'number-pad', day: 'number-pad', text: 'default' };
const MAXLEN: Record<Mask, number> = { won: 16, bizNo: 12, day: 10, text: 80 };

/**
 * 한 줄 칸(묶음 안 줄): 왼쪽 라벨(15 ink2), 오른쪽 값(17, 오른쪽 맞춤) + 단위.
 * 평소에는 글자처럼 보이고 누르면 그 자리에서 칸이 된다. 빈 칸은 테두리(line-strong)가 유일한 표시라 늘 보인다(WCAG 1.4.11).
 * 확신이 낮은 값은 라벨 아래 '확인해 주세요'(attention). 오류는 줄 아래에 남긴다.
 */
export function Field({
  label, value, onChange, mask = 'text', placeholder, unsure, error, testID, unit, maxLength, fix, tag,
}: {
  /** 라벨 아래 회색 꼬리표(예: "지난번 값"). 확인 필요가 있으면 그것이 먼저다. */
  tag?: string;
  label: string; value: string; onChange: (v: string) => void; mask?: Mask; placeholder?: string;
  /** 읽은 값의 확신이 낮다(사장님이 보고 고칠 칸) */
  unsure?: boolean; error?: string | null; testID?: string; unit?: string; maxLength?: number;
  /** 오류를 한 번에 고치는 제안(예: 합계를 공급가액 + 세액으로) */
  fix?: { label: string; value: string };
}) {
  const p = usePalette();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focus, setFocus] = useState(false);
  const empty = value === '';
  const boxed = focus || empty || !!error;
  const border = error ? p.attention : focus ? p.ink : empty ? p.lineStrong : 'transparent';
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityRole="none" style={s.row}>
      <View style={s.line}>
        <View style={s.label}>
          <T v="sub" c="ink2">
            {label}
          </T>
          {unsure && !focus && !error && (
            <T v="meta" c="attention" testID={testID ? `${testID}-unsure` : undefined}>
              확인해 주세요
            </T>
          )}
          {tag && !unsure && !focus && !error && (
            <T v="meta" c="ink3" testID={testID ? `${testID}-tag` : undefined}>
              {tag}
            </T>
          )}
        </View>
        <View style={[s.box, { borderColor: border, backgroundColor: boxed ? p.canvas : 'transparent', paddingHorizontal: boxed ? space.s3 : 0 }]}>
          <TextInput
            ref={ref}
            testID={testID}
            accessibilityLabel={label}
            accessibilityHint={unsure ? '읽은 값이 확실하지 않아요. 종이와 맞는지 봐 주세요.' : undefined}
            value={value}
            onChangeText={(t) => onChange(masked(mask, t))}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            keyboardType={KB[mask]}
            maxLength={maxLength ?? MAXLEN[mask]}
            placeholder={placeholder}
            placeholderTextColor={p.ink4}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            returnKeyType="done"
            autoCorrect={false}
            autoCapitalize="none"
            selectTextOnFocus={mask !== 'text'}
            style={[mask === 'text' ? type.body : type.value, textScale.web !== 1 && { fontSize: 17 * textScale.web, lineHeight: 24 * textScale.web }, s.input, { color: p.ink }]}
          />
          {unit && (
            <T v="value" c={empty ? 'ink4' : 'ink'}>
              {unit}
            </T>
          )}
        </View>
      </View>
      {error && (
        <T v="meta" c="attention" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </T>
      )}
      {error && fix && (
        <Pressable
          testID={testID ? `${testID}-fix` : undefined}
          accessibilityRole="button"
          onPress={() => onChange(fix.value)}
          hitSlop={6}
          style={({ pressed }) => [s.fix, { backgroundColor: pressed ? p.sunken : p.canvas }]}
        >
          <T v="label">{fix.label}</T>
        </Pressable>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { paddingHorizontal: space.s4, paddingVertical: space.s2, gap: space.s1, minHeight: 56, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  label: { minWidth: 76, gap: 1 },
  box: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  input: { flex: 1, textAlign: 'right', paddingVertical: space.s1, paddingRight: 0 },
  fix: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', paddingHorizontal: space.s3, borderRadius: radius.full, marginTop: space.s1 },
});
