import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, FlatList, Keyboard, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatItem } from '../chat';
import { findByBizNo, orderedCounterparties, searchCounterparties, type Counterparty } from '../issue';
import { counterpartiesOf } from '../net/pcCopy';
import { useQueue, type IssuePrefill } from '../queueStore';
import { useSession } from '../session';
import { MAX_FONT_SCALE, radius, space, type as typeScale, usePalette } from '../theme';
import { masked } from '../ui/mask';
import { Button, Chevron, T, tap } from '../ui/kit';

export type IssueStep = 'cp' | 'name' | 'bizNo';

export interface IssueSheetPreview {
  step?: IssueStep;
  query?: string;
  name?: string;
  bizNo?: string;
  kb?: number;
  focus?: boolean;
}

export type IssuePick = { cp: Counterparty } | { cp: null; name: string; bizNo: string };

export function issueCard(pick: IssuePick, pre: IssuePrefill | null = null, now = Date.now()): ChatItem {
  const name = pick.cp ? pick.cp.name : pick.name;
  const bizNo = pick.cp ? pick.cp.bizNo ?? '' : pick.bizNo;
  const amount = pre?.amount ?? pick.cp?.lastSupply ?? 0;
  const id = `issue-${now}`;
  return {
    kind: 'msg', id, from: 'pc', via: 'phone', at: now,
    card: {
      title: `${name} 세금계산서`, rows: [],
      draft: {
        id, counterpartyId: pick.cp?.id ?? '', amount, vat: pre?.vat ?? 'separate', item: pre ? pre.item : pick.cp?.lastItem ?? null,
        phone: { name, bizNo, edit: amount <= 0, draftId: pre?.draftId },
      },
    },
  };
}

const ASK: Record<IssueStep, string> = {
  cp: '어디에 발급할까요?',
  name: '상호를 알려 주세요',
  bizNo: '사업자등록번호를 알려 주세요',
};

const subOf = (c: Counterparty) => c.bizNo || '등록번호 없음';

export function IssueSheet({ onClose, onPick, onCapture, counterparties: given, preview }: {
  onClose: () => void;
  onPick: (pick: IssuePick) => void;
  onCapture: () => void;
  counterparties?: Counterparty[];
  preview?: IssueSheetPreview;
}) {
  const p = usePalette();
  const s = useSession();
  const queue = useQueue();
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const copy = s.data.pcCopy ?? null;
  const fromCopy = useMemo(() => (copy ? counterpartiesOf(copy) : []), [copy]);
  const all = useMemo(() => orderedCounterparties(given ?? [
    ...fromCopy,
    ...queue.counterparties.filter((c) => !findByBizNo(fromCopy, c.bizNo)),
  ]), [given, queue.counterparties, fromCopy]);

  const [step, setStep] = useState<IssueStep>(preview?.step ?? 'cp');
  const [q, setQ] = useState(preview?.query ?? '');
  const [name, setName] = useState(preview?.name ?? '');
  const [bizNo, setBizNo] = useState(preview?.bizNo ?? '');

  const [kb, setKb] = useState(preview?.kb ?? 0);
  useEffect(() => {
    if (preview?.kb !== undefined) return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [preview?.kb]);

  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const dir = useRef(1);
  const go = (to: IssueStep, back = false) => {
    dir.current = back ? -1 : 1;
    setStep(to);
  };
  const opened = useRef(false);
  useEffect(() => {
    const first = !opened.current;
    opened.current = true;
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    if (step === 'cp') {
      if (first && preview?.focus) setTimeout(() => search.current?.focus(), 400);
      else if (!first && preview?.kb === undefined) Keyboard.dismiss();
    } else if (preview?.kb === undefined || preview.kb > 0) setTimeout(() => input.current?.focus(), first ? 400 : 230);
  }, [step, slide]);

  const pick = (x: IssuePick) => {
    tap();
    Keyboard.dismiss();
    onPick(x);
  };
  const manual = () => {
    tap();
    const t = q.trim();
    if (t && !/^[\d-\s]+$/.test(t)) setName(t);
    else if (t.replace(/\D/g, '').length >= 3) setBizNo(masked('bizNo', t));
    go('name');
  };
  const done = () => {
    const known = findByBizNo(all, bizNo);
    pick(known ? { cp: known } : { cp: null, name: name.trim(), bizNo });
  };
  const back = () => (step === 'bizNo' ? go('name', true) : step === 'name' ? go('cp', true) : onClose());

  const underline = (key: 'name' | 'bizNo', value: string, set: (v: string) => void, opts: { placeholder: string; pad?: boolean; max: number; onDone: () => void }) => (
    <View style={[st.input, { borderColor: p.ink }]}>
      <TextInput
        ref={input}
        testID={`issue-sheet-${key}`}
        value={value}
        onChangeText={set}
        placeholder={opts.placeholder}
        placeholderTextColor={p.ink4}
        keyboardType={opts.pad ? 'number-pad' : 'default'}
        maxLength={opts.max}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        returnKeyType={opts.pad ? undefined : 'next'}
        autoCorrect={false}
        onSubmitEditing={opts.onDone}
        accessibilityLabel={ASK[key]}
        style={[typeScale.title, st.inputText, { color: p.ink }, { outlineStyle: 'none' } as object]}
      />
    </View>
  );

  let body: React.ReactNode;
  let primary: { label: string; on: boolean; go: () => void } | null = null;
  if (step === 'cp') {
    const found = q.trim() ? searchCounterparties(all, q) : all;
    body = (
      <>
        <T v="title" role="header">
          {ASK.cp}
        </T>
        {all.length === 0 ? (
          <View style={[st.empty, { backgroundColor: p.tint }]} testID="issue-sheet-empty">
            <T v="subStrong">아직 거래처가 없어요</T>
            <T v="sub" c="ink2">
              상호와 등록번호를 적으면 바로 쓸 수 있어요
            </T>
          </View>
        ) : (
          <>
            <TextInput
              testID="issue-sheet-search"
              ref={search}
              value={q}
              onChangeText={setQ}
              placeholder="상호나 등록번호로 찾기"
              placeholderTextColor={p.ink3}
              accessibilityLabel="거래처 찾기"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              returnKeyType="search"
              autoCorrect={false}
              style={[typeScale.body, st.search, { backgroundColor: p.tint, color: p.ink }, { outlineStyle: 'none' } as object]}
            />
            <View style={[st.list, { borderColor: p.line }]}>
              <FlatList
                data={found}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                testID="issue-sheet-list"
                ItemSeparatorComponent={() => <View style={[st.sep, { backgroundColor: p.line }]} />}
                ListEmptyComponent={
                  <View style={st.none} testID="issue-sheet-none">
                    <T v="sub" c="ink2">
                      찾는 거래처가 없어요. 직접 입력해 주세요
                    </T>
                  </View>
                }
                renderItem={({ item: c }) => (
                  <Pressable
                    onPress={() => pick({ cp: c })}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.name}, ${subOf(c)}`}
                    testID={`issue-sheet-cp-${c.id}`}
                    style={({ pressed }) => [st.row, pressed && { backgroundColor: p.tint }]}
                  >
                    <View style={{ flex: 1, gap: 1 }}>
                      <T v="sub" lines={1}>
                        {c.name}
                      </T>
                      <T v="meta" c="ink3" lines={1}>
                        {subOf(c)}
                      </T>
                    </View>
                    <Chevron color={p.ink4} sizePx={7} />
                  </Pressable>
                )}
              />
            </View>
          </>
        )}
      </>
    );
  } else if (step === 'name') {
    const on = name.trim().length > 0;
    body = (
      <>
        <T v="title" role="header">
          {ASK.name}
        </T>
        {underline('name', name, setName, { placeholder: '예: 동네마트', max: 60, onDone: () => on && go('bizNo') })}
      </>
    );
    primary = { label: '다음', on, go: () => go('bizNo') };
  } else {
    const on = bizNo.replace(/\D/g, '').length === 10;
    body = (
      <>
        <T v="title" role="header">
          {ASK.bizNo}
        </T>
        {underline('bizNo', bizNo, (v) => setBizNo(masked('bizNo', v)), { placeholder: '000-00-00000', pad: true, max: 12, onDone: () => on && done() })}
        <T v="meta" c="ink3">
          사업자등록증에 있는 10자리예요
        </T>
      </>
    );
    primary = { label: '확인', on, go: done };
  }

  const bottomPad = Math.max(kb > 0 ? 0 : inset.bottom, space.s4);
  const h = Math.min(SHEET_H + bottomPad, height - kb - inset.top - space.s2);

  return (
    <View style={StyleSheet.absoluteFill} testID="issue-sheet">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="세금계산서 발급 닫기" accessibilityRole="button" />
      <View style={[st.sheet, { backgroundColor: p.canvas, height: h, bottom: kb, paddingBottom: bottomPad }]} accessibilityViewIsModal>
        <View style={[st.grabber, { backgroundColor: p.sunken }]} />
        <View style={st.head}>
          <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={step !== 'cp' ? '이전 단계' : '닫기'} style={st.headBtn} testID="issue-sheet-back">
            {step !== 'cp' ? <Chevron dir="left" color={p.ink2} sizePx={9} /> : <T v="meta" c="ink3">닫기</T>}
          </Pressable>
          <T v="meta" c="ink3" style={{ flex: 1, textAlign: 'center' }}>
            {step === 'cp' ? '세금계산서 발급' : '직접 입력'}
          </T>
          <View style={[st.headBtn, { alignItems: 'flex-end' }]}>
            {step !== 'cp' && (
              <T v="meta" c="ink3" testID="issue-sheet-progress">
                {step === 'name' ? '1/2' : '2/2'}
              </T>
            )}
          </View>
        </View>
        <Animated.View
          key={step}
          style={[
            st.body,
            { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 28 * dir.current] }) }] },
          ]}
        >
          {body}
        </Animated.View>
        <View style={st.foot}>
          {step === 'cp' ? (
            <View style={st.twin}>
              <Button kind={all.length === 0 ? 'primary' : 'secondary'} label="직접 입력" onPress={manual} testID="issue-sheet-manual" style={{ flex: 1 }} />
              <Button kind="secondary" label="등록증 찍기" onPress={onCapture} testID="issue-sheet-capture" style={{ flex: 1 }} />
            </View>
          ) : (
            primary && <Button label={primary.label} onPress={primary.go} disabled={!primary.on} testID="issue-sheet-next" />
          )}
        </View>
      </View>
    </View>
  );
}

const SHEET_H = 480;

const st = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, minHeight: 44 },
  headBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  body: { flex: 1, minHeight: 0, paddingHorizontal: space.s5, paddingTop: space.s2, paddingBottom: space.s3, gap: space.s3 },
  foot: { paddingHorizontal: space.s5, gap: space.s2 },
  twin: { flexDirection: 'row', gap: space.s2 },
  search: { minHeight: 44, borderRadius: radius.full, paddingHorizontal: space.s4 },
  list: { flex: 1, minHeight: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.s4, paddingVertical: space.s2, gap: space.s3 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.s4 },
  none: { padding: space.s4 },
  empty: { borderRadius: radius.lg, padding: space.s4, gap: space.s1 },
  input: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.5, gap: space.s2 },
  inputText: { flex: 1, paddingVertical: space.s3 },
});
