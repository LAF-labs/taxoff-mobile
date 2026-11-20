import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { MAX_FONT_SCALE, radius, space, textScale, type, usePalette } from '../theme';
import { T } from './kit';

export { masked, type Mask } from './mask.ts';
import { masked, type Mask } from './mask.ts';

const KB: Record<Mask, KeyboardTypeOptions> = { won: 'number-pad', bizNo: 'number-pad', day: 'number-pad', text: 'default', email: 'email-address', phone: 'phone-pad' };
const KEEP_ALL = { wordBreak: 'keep-all', overflowWrap: 'anywhere' };
const MAXLEN: Record<Mask, number> = { won: 16, bizNo: 12, day: 10, text: 80, email: 120, phone: 13 };

export function Field({
  label, value, onChange, mask = 'text', placeholder, unsure, error, testID, unit, maxLength, fix, tag, multiline, format,
}: {
  format?: (v: string) => string;
  multiline?: boolean;
  tag?: string;
  label: string; value: string; onChange: (v: string) => void; mask?: Mask; placeholder?: string;
  unsure?: boolean; error?: string | null; testID?: string; unit?: string; maxLength?: number;
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
        <View
          style={[
            s.box,
            { borderColor: border, backgroundColor: boxed ? p.canvas : 'transparent', paddingHorizontal: boxed ? space.s3 : 0 },
            unsure && !boxed && { borderBottomColor: p.attention, borderRadius: 0 },
          ]}
        >
          <TextInput
            ref={ref}
            testID={testID}
            accessibilityLabel={label}
            accessibilityHint={unsure ? '읽은 값이 확실하지 않아요. 종이와 맞는지 봐 주세요.' : undefined}
            value={format && !focus ? format(value) : value}
            onChangeText={(t) => onChange(masked(mask, t.replace(/\u00A0/g, ' ')))}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            keyboardType={KB[mask]}
            maxLength={maxLength ?? (multiline ? 200 : MAXLEN[mask])}
            multiline={multiline}
            scrollEnabled={!multiline}
            numberOfLines={multiline ? Math.max(1, Math.ceil(value.length / 20)) : undefined}
            placeholder={placeholder}
            placeholderTextColor={p.ink4}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            returnKeyType={KB[mask] === 'number-pad' ? undefined : 'done'}
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete={mask === 'email' ? 'email' : undefined}
            selectTextOnFocus={mask !== 'text' && mask !== 'email'}
            style={[mask === 'text' ? type.body : type.value, multiline && (KEEP_ALL as object), textScale.web !== 1 && { fontSize: 17 * textScale.web, lineHeight: 24 * textScale.web }, s.input, { color: p.ink }]}
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
