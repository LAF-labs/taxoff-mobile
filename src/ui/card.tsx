import { Children, forwardRef, isValidElement, useContext, useState, type ComponentRef, type ReactNode } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';
import { MAX_FONT_SCALE, radius, size, space, type, usePalette } from '../theme';
import { useFocusFace } from './form';
import { Chevron, OnCard, T } from './kit';
import type { Ink } from '../theme';

/**
 * 대화 카드 부품(기준판 kit.css의 sx-card, sx-card-hd, sx-kv, sx-amt, sx-actions is-fill을 그대로 옮김).
 * 대화에 뜨는 카드는 종류와 상관없이 이 부품만 써서 만든다. 화면 파일에서 면, 머리 줄, 값 줄, 단추 줄을 따로 조립하지 않는다.
 * 값: 면 tint, 모서리 16, 안쪽 16, 줄 사이 12. 제목 17/600. 값 줄 15/22(라벨 ink3, 값 ink, 합계 600). 카드 단추 40, 15.
 */
export type CardKind = 'doc' | 'amend' | 'cancel' | 'done' | 'failed' | 'check';
/** wait: 내 승인을 기다림(accent). attention: 확인이 필요함. */
export type CardTone = 'quiet' | 'wait' | 'attention';


const ICON = 18;
const LINE = 1.5;

/** 제목 앞 18px 선 아이콘. 취소는 늘 danger, 그 밖은 기본 ink2, 승인 대기 accent, 확인 필요 attention. 완료와 실패에는 색을 쓰지 않는다. */
export function CardIcon({ kind, tone = 'quiet' }: { kind: CardKind; tone?: CardTone }) {
  const p = usePalette();
  const color = kind === 'cancel' ? p.danger : kind === 'done' || kind === 'failed' ? p.ink2 : tone === 'wait' ? p.accent : tone === 'attention' ? p.attention : p.ink2;
  const ring = { width: ICON - 2, height: ICON - 2, borderRadius: radius.full, borderWidth: LINE, borderColor: color, alignItems: 'center' as const, justifyContent: 'center' as const };
  const bar = (rot: string, w = 8) => <View style={{ position: 'absolute', width: w, height: LINE, backgroundColor: color, transform: [{ rotate: rot }] }} />;
  let body: ReactNode;
  if (kind === 'amend') {
    body = <View style={{ width: 5, height: 15, borderWidth: LINE, borderColor: color, borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs, transform: [{ rotate: '45deg' }] }} />;
  } else if (kind === 'doc') {
    body = (
      <View style={{ width: 12, height: 15, borderWidth: LINE, borderColor: color, borderRadius: radius.xs, gap: 2.5, paddingTop: 4, alignItems: 'center' }}>
        <View style={{ width: 6, height: LINE, backgroundColor: color }} />
        <View style={{ width: 6, height: LINE, backgroundColor: color }} />
      </View>
    );
  } else if (kind === 'cancel') {
    body = <View style={ring}>{bar('45deg')}{bar('-45deg')}</View>;
  } else if (kind === 'done') {
    body = (
      <View style={ring}>
        <View style={{ width: 7, height: 4, borderLeftWidth: LINE, borderBottomWidth: LINE, borderColor: color, transform: [{ rotate: '-45deg' }], marginTop: -2 }} />
      </View>
    );
  } else if (kind === 'check') {
    // 세모 느낌표(확인 필요)
    body = (
      <View style={{ width: ICON, height: ICON, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 }}>
        <View style={{ position: 'absolute', top: 1, width: 0, height: 0, borderLeftWidth: 8.5, borderRightWidth: 8.5, borderBottomWidth: 15, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
        <View style={{ position: 'absolute', top: 3.6, width: 0, height: 0, borderLeftWidth: 6.4, borderRightWidth: 6.4, borderBottomWidth: 11.2, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: p.tint }} />
        <View style={{ width: LINE, height: 4, backgroundColor: color, marginBottom: 1.2 }} />
        <View style={{ width: LINE, height: LINE, backgroundColor: color }} />
      </View>
    );
  } else {
    // 동그라미 느낌표(발급 실패)
    body = (
      <View style={ring}>
        <View style={{ width: LINE, height: 5, backgroundColor: color, marginBottom: 1.5 }} />
        <View style={{ width: LINE, height: LINE, backgroundColor: color }} />
      </View>
    );
  }
  return (
    <View style={{ width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
    </View>
  );
}

/** 카드: tint 채움 면 하나. 어떤 상태에서도 테두리, 띠, 그림자를 더하지 않는다. 대화 폭을 다 쓴다. */
export function Card({ kind, tone, title, children, testID, style }: { kind?: CardKind; tone?: CardTone; title: string; children?: ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <OnCard.Provider value={true}>
      <View style={[st.card, { backgroundColor: p.tint }, style]} testID={testID}>
        <View style={st.head}>
          {kind && <CardIcon kind={kind} tone={tone} />}
          <T v="strong" style={{ flex: 1 }} role="header">
            {title}
          </T>
        </View>
        {children}
      </View>
    </OnCard.Provider>
  );
}

/** 라벨과 값 줄 묶음(sx-kv): 줄 사이 6. */
export function Kv({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={st.kv} testID={testID}>
      {children}
    </View>
  );
}

/**
 * 라벨과 값 한 줄. total은 합계(굵게). onPress가 있으면 고를 수 있는 값(값 뒤 꺾쇠), edit이면 눌러서 그 자리에서 고치는 값(꺾쇠 없음).
 * children은 값 자리에 다른 것을 둘 때.
 */
export function KvRow({ label, value, total, onPress, edit, children, quiet, warn, testID }: {
  label: string; value?: string; total?: boolean; onPress?: () => void; edit?: boolean; children?: ReactNode; quiet?: boolean;
  /** 확인 못 한 값, 기간 일부만 받은 값(attention 글자, 리포트) */
  warn?: boolean;
  testID?: string;
}) {
  const p = usePalette();
  const v = children ?? (
    <T v={total ? 'subFigure' : 'subValue'} c={warn ? 'attention' : quiet ? 'ink4' : 'ink'} style={st.kvV} testID={testID}>
      {value}
    </T>
  );
  return (
    <View style={st.kvRow}>
      <T v="sub" c="ink3" style={st.kvK}>
        {label}
      </T>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value ?? ''}, ${edit ? '고치기' : '바꾸기'}`} hitSlop={8} style={({ pressed }) => [st.pick, pressed && { opacity: 0.5 }]} testID={testID ? `${testID}-press` : undefined}>
          {v}
          {!edit && <Chevron color={p.ink4} sizePx={7} />}
        </Pressable>
      ) : (
        v
      )}
    </View>
  );
}

type Input = ComponentRef<typeof TextInput>;

/** 카드 안 입력 칸(sx-amt-in): 높이 44, 모서리 12, 바탕색 면, 오른쪽 정렬 굵은 숫자. 누르면 어디서나 같은 누른 칸 모양. */
export const CardInput = forwardRef<
  Input,
  {
    value: string; onChange: (v: string) => void; label: string; placeholder?: string; keyboardType?: KeyboardTypeOptions; autoFocus?: boolean; onDone?: () => void; testID?: string;
    /** 숫자가 아닌 값(날짜, 번호, 품목): 굵지 않게. */
    plain?: boolean;
    /** 값 뒤에 붙는 단위(원). */
    suffix?: string;
    editable?: boolean;
    onFocus?: () => void;
  }
>(function CardInput({ value, onChange, label, placeholder, keyboardType, autoFocus, onDone, testID, plain, suffix, editable = true, onFocus }, ref) {
  const p = usePalette();
  const focusFace = useFocusFace();
  const [focus, setFocus] = useState(!!autoFocus);
  return (
    <View style={[st.in, { backgroundColor: p.canvas, borderColor: 'transparent' }, focus && focusFace]}>
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={p.ink4}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        returnKeyType="done"
        blurOnSubmit
        onFocus={() => {
          setFocus(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocus(false);
          onDone?.();
        }}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        selectionColor={p.accent}
        editable={editable}
        inputAccessoryViewID={keyboardType === 'number-pad' || keyboardType === 'phone-pad' ? KEYBOARD_DONE_ID : undefined}
        style={[plain ? type.subValue : type.subFigure, st.inText, { color: p.ink }, noOutline]}
      />
      {suffix && value !== '' && <T v={plain ? 'subValue' : 'subFigure'}>{suffix}</T>}
    </View>
  );
});
const noOutline = { outlineStyle: 'none' } as object;

/** 금액 고치기(sx-amt): 윗줄 이름과 기존 금액, 아랫줄 카드 폭을 다 쓰는 고칠 금액 칸. */
export function AmountEdit({ label, before, children }: { label: string; before?: string; children: ReactNode }) {
  return (
    <View style={st.amt}>
      <View style={st.kvRow}>
        <T v="sub" c="ink3" style={st.kvK}>
          {label}
        </T>
        {before !== undefined && (
          <T v="subValue" c="ink3" style={st.kvV}>
            {before}
          </T>
        )}
      </View>
      {children}
    </View>
  );
}

/**
 * 목록의 카드(기준판 ph-item, 밀린 일): 한 일에 카드 하나. 윗줄 이름과 금액, 아랫줄 상태 한 줄, 그 아래 단추 줄.
 * 누르면 자세히 여는 카드면 onPress를 준다(단추가 있으면 카드는 누를 수 없다).
 */
export function ListCard({ title, amount, line, lineInk = 'ink2', dim, strike, side, children, onPress, a11y, a11yHint, testID, lineTestID }: {
  title: string;
  amount?: string | null;
  line?: string;
  lineInk?: Ink;
  dim?: boolean;
  /** 금액에 취소선(시간이 지나 취소된 일). */
  strike?: boolean;
  /** 상태 줄 오른쪽의 글자 단추(취소 등). */
  side?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  a11y?: string;
  a11yHint?: string;
  testID?: string;
  lineTestID?: string;
}) {
  const p = usePalette();
  const body = (
    <OnCard.Provider value={true}>
      <View style={st.itemTop}>
        <T v="strong" c={dim ? 'ink2' : 'ink'} lines={1} style={{ flex: 1 }}>
          {title}
        </T>
        {amount && (
          <T v="figure" c={dim ? 'ink3' : 'ink'} style={[{ flexShrink: 0 }, strike && { textDecorationLine: 'line-through' }]}>
            {amount}
          </T>
        )}
      </View>
      {(line || side) && (
        <View style={st.itemLine}>
          <T v="sub" c={lineInk} style={{ flex: 1 }} testID={lineTestID}>
            {line}
          </T>
          {side}
        </View>
      )}
      {children}
    </OnCard.Provider>
  );
  if (!onPress) return <View style={[st.item, { backgroundColor: p.tint }]} testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={a11yHint} onPress={onPress} style={({ pressed }) => [st.item, { backgroundColor: pressed ? p.sunken : p.tint }]}>
      {body}
    </Pressable>
  );
}

/**
 * 단추 한 줄: 폰 단추는 줄을 꽉 채운다. 하나면 가득, 둘이면 반씩, 셋 이상이면 한 줄에 하나씩(주 단추가 맨 위).
 * 가장 중요한 단추가 맨 앞. 폭이 덜 찬 단추를 두지 않는다.
 */
export function Actions({ children, style, testID, fit }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; fit?: boolean }) {
  const items = Children.toArray(children).filter(isValidElement);
  // fit: 목록 카드의 단추 줄(기준판 ph-item .sx-actions). 오른쪽에 글 폭만큼.
  if (fit) {
    return (
      <View style={[st.fit, style]} testID={testID}>
        {items}
      </View>
    );
  }
  const stack = items.length >= 3;
  return (
    <View style={[stack ? st.stack : st.row, style]} testID={testID}>
      {items.map((c, i) => (
        <View key={i} style={stack ? undefined : st.cell}>
          {c}
        </View>
      ))}
    </View>
  );
}

/** 카드 안에서 여럿 중 하나 고르기(어느 계산서인지 등): 바탕색 면 한 줄 52, 오른쪽 꺾쇠. */
export function CardChoice({ children, onPress, a11y, testID }: { children: ReactNode; onPress?: () => void; a11y?: string; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [st.choice, { backgroundColor: pressed ? p.sunken : p.canvas }]} testID={testID}>
      <View style={st.choiceBody}>{children}</View>
      {onPress && <Chevron color={p.ink4} sizePx={7} />}
    </Pressable>
  );
}

/** 숫자 자판 위 [완료] 줄(iOS 숫자 자판에는 완료 키가 없다). 숫자 CardInput은 저절로 붙는다. 입력 칸이 열린 카드 안에 한 번 둔다. */
export const KEYBOARD_DONE_ID = 'keyboard-done';
export function KeyboardDone() {
  const p = usePalette();
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID} backgroundColor={p.tint}>
      <View style={st.doneBar}>
        <Pressable onPress={() => Keyboard.dismiss()} accessibilityRole="button" hitSlop={8} style={st.doneBtn} testID="keyboard-done">
          <T v="subStrong" c="accent">
            완료
          </T>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** 카드 안 단추 높이(카드 밖 주 단추는 size.button). */
export const CARD_BUTTON = size.buttonSm;

/** 카드 안인지: 단추가 크기와 면을 정할 때 쓴다. */
export const useOnCard = () => useContext(OnCard);

const st = StyleSheet.create({
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.s4, gap: space.s3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: 22 },
  kv: { gap: 6 },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s4 },
  kvK: { flexShrink: 0 },
  kvV: { flexShrink: 1, textAlign: 'right' },
  pick: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 0 },
  amt: { gap: 6 },
  in: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s3, borderRadius: radius.md, borderWidth: 1 },
  inText: { flex: 1, minHeight: 42, paddingVertical: 0, textAlign: 'right' },
  row: { flexDirection: 'row', gap: space.s2 },
  cell: { flex: 1, minWidth: 0 },
  stack: { gap: space.s2 },
  fit: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.s2, paddingTop: space.s2 },
  item: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.s4, gap: space.s1 },
  itemTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s3 },
  itemLine: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  doneBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.s4, minHeight: 44, alignItems: 'center' },
  doneBtn: { paddingHorizontal: space.s2, minHeight: 44, justifyContent: 'center' },
  choice: { minHeight: size.row, borderRadius: radius.md, paddingHorizontal: space.s4, flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  choiceBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3 },
});
