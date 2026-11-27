import { forwardRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { MAX_FONT_SCALE, radius, space, type, usePalette } from '../theme';
import { Glyph } from './glyph';
import { T } from './kit';

/**
 * 거래처 화면에서 더한 입력 부품(2026-11-24 대표 승인 캔버스). 누른 칸은 어디서나 같다:
 * 파란 테두리 없이 흰 면, 옅은 회색 선, 뒤 그림자, 커서(docs/design.md v3.0).
 */
const noOutline = { outlineStyle: 'none' } as object;

export function useFocusFace() {
  const p = usePalette();
  return { backgroundColor: p.overlay, borderColor: p.ink4, shadowColor: p.ink, shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 3 };
}

type Input = ComponentRef<typeof TextInput>;

/** 찾기 칸(기준판 ph-search, 문서함과 같은 부품): 높이 44, 모서리 12, 돋보기, 글이 있으면 지우기 단추. */
export const SearchField = forwardRef<Input, { value: string; onChange: (v: string) => void; placeholder: string; label: string; testID?: string; autoFocus?: boolean }>(function SearchField(
  { value, onChange, placeholder, label, testID, autoFocus },
  ref,
) {
  const p = usePalette();
  const focusFace = useFocusFace();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[st.search, { backgroundColor: p.tint, borderColor: 'transparent' }, focus && focusFace]}>
      <Glyph kind="search" color={p.ink3} />
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={p.ink3}
        accessibilityLabel={label}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        returnKeyType="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        selectionColor={p.accent}
        style={[type.body, st.searchText, { color: p.ink }, noOutline]}
      />
      {value !== '' && (
        <Pressable testID={testID ? `${testID}-clear` : undefined} onPress={() => onChange('')} hitSlop={11} accessibilityRole="button" accessibilityLabel="지우기" style={[st.clear, { backgroundColor: p.ink4 }]}>
          <Glyph kind="close" color={p.canvas} size={10} />
        </Pressable>
      )}
    </View>
  );
});

/** 고치기 화면의 칸: 라벨 위, 테두리 없는 채움 칸(높이 52). 바꿀 수 없는 칸은 흐린 글과 자물쇠. */
export function FormField({
  label, value, onChange, placeholder, locked, keyboardType, autoCapitalize = 'none', maxLength, testID, returnKeyType, onSubmit,
}: {
  label: string; value: string; onChange?: (v: string) => void; placeholder?: string; locked?: boolean; keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize']; maxLength?: number; testID?: string; returnKeyType?: TextInputProps['returnKeyType']; onSubmit?: () => void;
}) {
  const p = usePalette();
  const focusFace = useFocusFace();
  const [focus, setFocus] = useState(false);
  return (
    <View style={st.field}>
      <T v="label" c="ink3">
        {label}
      </T>
      {locked ? (
        <View testID={testID} style={[st.box, { backgroundColor: p.tint, borderColor: 'transparent' }]} accessible accessibilityLabel={`${label} ${value}, 바꿀 수 없어요`}>
          <T v="value" c="ink3" lines={1} style={{ flex: 1 }}>
            {value}
          </T>
          <Glyph kind="lock" color={p.ink4} size={16} />
        </View>
      ) : (
        <View style={[st.box, { backgroundColor: p.tint, borderColor: 'transparent' }, focus && focusFace]}>
          <TextInput
            testID={testID}
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={p.ink3}
            accessibilityLabel={label}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            maxLength={maxLength}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmit}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            selectionColor={p.accent}
            style={[type.body, st.boxText, { color: p.ink }, noOutline]}
          />
        </View>
      )}
    </View>
  );
}

/** 시트 안 한 단계 입력: 묻는 말(22/700), 밑줄 하나에 크게 쓴 값, 틀리면 황토 밑줄과 한 줄. */
export const BigInput = forwardRef<
  Input,
  {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; bad?: string | null; pad?: boolean; maxLength?: number; onSubmit?: () => void; testID?: string;
    /** pad보다 앞선다(전화번호 phone-pad 등). */
    keyboardType?: KeyboardTypeOptions;
    autoComplete?: TextInputProps['autoComplete'];
    /** 다음 단계가 있으면 'next'. */
    returnKey?: 'done' | 'next';
  }
>(function BigInput({ label, value, onChange, placeholder, bad, pad, maxLength, onSubmit, testID, keyboardType, autoComplete, returnKey }, ref) {
  const p = usePalette();
  return (
    <View style={st.big}>
      <T v="ask" role="header">
        {label}
      </T>
      <View style={[st.under, { borderColor: bad ? p.attention : p.ink }]}>
        <TextInput
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={p.ink4}
          accessibilityLabel={label}
          accessibilityHint={bad ?? undefined}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          keyboardType={keyboardType ?? (pad ? 'number-pad' : 'default')}
          returnKeyType={returnKey ?? (pad ? undefined : 'done')}
          autoComplete={autoComplete}
          autoCorrect={false}
          maxLength={maxLength}
          onSubmitEditing={onSubmit}
          selectionColor={p.accent}
          style={[type.askValue, st.underText, { color: p.ink }, noOutline]}
        />
      </View>
      {bad ? (
        <T v="sub" c="attention" testID={testID ? `${testID}-bad` : undefined}>
          {bad}
        </T>
      ) : null}
    </View>
  );
});

const st = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.s2, height: 44, paddingHorizontal: space.s3 + 2, borderRadius: radius.md, borderWidth: 1 },
  searchText: { flex: 1, minWidth: 0, paddingVertical: 0, height: 42 },
  clear: { width: 22, height: 22, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  field: { gap: space.s1 + 2 },
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.s4, borderRadius: radius.md, borderWidth: 1 },
  boxText: { flex: 1, minHeight: 50, paddingVertical: 0 },
  big: { gap: space.s2 },
  under: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.5 },
  underText: { flex: 1, paddingVertical: space.s3 },
});
