// 대화 입력 줄 [+] → 세금계산서 발급(대표 요청 2026-11-19 "메뉴에서 발급할 경우 업체 리스트가 함께 표시되면 좋을듯함").
// 시트는 거래처 고르기 한 단계만 한다: 찾기 칸 + 목록 + [직접 입력] [등록증 찍기].
// 고르면 시트가 닫히고 대화에 그 거래처의 세금계산서 카드가 뜬다(모델이 만드는 카드와 같은 모양, 지난번 금액과 품목을 채운다).
// 금액과 품목은 카드 [수정]으로 그 자리에서 고치고 [발급하기]로 맡긴다(대표 결정 2026-11-19 "카드에서 바로 수정하는 그거 그대로").
// [직접 입력]은 시트 안에서 상호 → 등록번호만 받는다. 등록번호가 장부에 있으면 그 거래처로 잇는다.
// 거래처 목록은 PC 거래처 장부에서 온다(PC가 라이브 세션마다 넘기는 사본 phone.copy). 순서는 최근 발급, 그다음 자주 발급한 곳.
// 키보드가 올라오면 시트가 키보드 위로 올라가고, 높이가 모자라면 목록이 줄어든다(찾기 칸과 단추는 가려지지 않는다).
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
  /** 갤러리(웹): 키보드가 올라온 높이를 흉내 낸다 */
  kb?: number;
  /** 갤러리(시험용 iOS 빌드): 찾기 칸에 들어간 채로 연다(진짜 키보드) */
  focus?: boolean;
}

/** 시트에서 고른 받는 곳: 장부의 거래처, 또는 직접 적은 상호와 등록번호 */
export type IssuePick = { cp: Counterparty } | { cp: null; name: string; bizNo: string };

/** 고른 받는 곳의 세금계산서 카드(대화 줄). 지난번 금액과 품목을 채우고(모델 카드에서 왔으면 그 값), 금액이 없으면 수정 상태로 연다. */
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

/** 이 거래처의 목록 줄 둘째 줄: 등록번호 */
const subOf = (c: Counterparty) => c.bizNo || '등록번호 없음';

export function IssueSheet({ onClose, onPick, onCapture, counterparties: given, preview }: {
  onClose: () => void;
  /** 받는 곳을 골랐다(시트를 닫고 대화에 카드를 띄운다) */
  onPick: (pick: IssuePick) => void;
  /** 새 거래처: 사업자등록증 찍기 */
  onCapture: () => void;
  /** 갤러리: 거래처 목록 */
  counterparties?: Counterparty[];
  preview?: IssueSheetPreview;
}) {
  const p = usePalette();
  const s = useSession();
  const queue = useQueue();
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const copy = s.data.pcCopy ?? null;
  const fromCopy = useMemo(() => (copy ? counterpartiesOf(copy) : null), [copy]);
  const all = useMemo(() => orderedCounterparties(given ?? (queue.counterparties.length > 0 || !fromCopy ? queue.counterparties : fromCopy)), [given, queue.counterparties, fromCopy]);

  const [step, setStep] = useState<IssueStep>(preview?.step ?? 'cp');
  const [q, setQ] = useState(preview?.query ?? '');
  const [name, setName] = useState(preview?.name ?? '');
  const [bizNo, setBizNo] = useState(preview?.bizNo ?? '');

  // ---- 키보드: 시트를 키보드 위로 올린다(높이가 모자라면 시트가 줄고, 줄어드는 것은 목록뿐) ----
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

  // 단계가 바뀌면 같은 시트 안에서 내용만 옆으로 넘어간다(간편인증 시트와 같다)
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
    // 처음 열 때는 키보드를 건드리지 않는다(단계를 옮길 때만 내리거나 올린다)
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
    // 찾던 글이 상호처럼 보이면 상호 칸에, 숫자면 등록번호 칸에 채워 둔다
    const t = q.trim();
    if (t && !/^[\d-\s]+$/.test(t)) setName(t);
    else if (t.replace(/\D/g, '').length >= 3) setBizNo(masked('bizNo', t));
    go('name');
  };
  const done = () => {
    // 이미 있는 거래처의 등록번호면 그 거래처로 잇는다(지난번 금액과 품목도 채운다)
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
        // 숫자 키보드에는 리턴 키를 붙이지 않는다(iOS 26은 키보드 위에 떠 있는 단추로 그린다)
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

  // 시트 높이는 단계마다 같다. 키보드가 뜨면 키보드 위로 올라가고, 위로 넘치면 그만큼만 줄인다.
  const bottomPad = kb > 0 ? space.s3 : Math.max(inset.bottom, space.s4);
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
            // 목록 단계만 시트를 채운다. 입력 단계는 단추가 내용 바로 아래 제자리에 있다(키보드에 붙어 떠다니지 않는다).
            step !== 'cp' && st.bodyFit,
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
        {step !== 'cp' && <View style={{ flex: 1 }} />}
      </View>
    </View>
  );
}

/** 시트 높이(바닥 안전 영역 빼고). 거래처 목록이 다섯 줄쯤 보이는 높이. 간편인증 시트(452)와 비슷하게 둔다. */
const SHEET_H = 480;

const st = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, minHeight: 44 },
  headBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  body: { flex: 1, minHeight: 0, paddingHorizontal: space.s5, paddingTop: space.s2, paddingBottom: space.s3, gap: space.s3 },
  bodyFit: { flex: 0, flexGrow: 0, flexShrink: 0 },
  foot: { paddingHorizontal: space.s5, gap: space.s1 },
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
