// 대화 입력 줄 [+] → 세금계산서 발급(대표 요청 2026-11-19 "메뉴에서 발급할 경우 업체 리스트가 함께 표시되면 좋을듯함").
// 새 화면으로 넘어가지 않고 대화 위 바텀시트에서 한 번에 하나씩 묻는다(간편인증 시트와 같은 방식, 높이 고정):
//   거래처(찾기 칸 + 목록) → 금액 → 품목 → 확인.   목록에 없으면 [직접 입력] → 상호 → 등록번호 → 금액 → 품목 → 확인.
// 거래처 목록은 PC 거래처 장부에서 온다(PC가 라이브 세션마다 넘기는 사본 phone.copy). 순서는 최근 발급, 그다음 자주 발급한 곳.
// 키보드가 올라오면 시트가 키보드 위로 올라가고, 높이가 모자라면 목록이 줄어든다(찾기 칸과 단추는 가려지지 않는다).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, FlatList, Keyboard, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findByBizNo, orderedCounterparties, searchCounterparties, splitAmount, type Counterparty, type VatMode } from '../issue';
import { useIssueSubmit, useViaPc } from '../issueSubmit';
import { counterpartiesOf } from '../net/pcCopy';
import { kstDay } from '../phoneCmd';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { MAX_FONT_SCALE, radius, space, type as typeScale, usePalette } from '../theme';
import { masked } from '../ui/mask';
import { Button, Chevron, Seg, T, tap, won } from '../ui/kit';

export type IssueStep = 'cp' | 'name' | 'bizNo' | 'amount' | 'item' | 'confirm';

export interface IssueSheetPreview {
  step?: IssueStep;
  cpId?: string;
  query?: string;
  amount?: string;
  item?: string;
  /** 갤러리(웹): 키보드가 올라온 높이를 흉내 낸다 */
  kb?: number;
  /** 갤러리(시험용 iOS 빌드): 찾기 칸에 들어간 채로 연다(진짜 키보드) */
  focus?: boolean;
}

const ASK: Record<Exclude<IssueStep, 'confirm'>, string> = {
  cp: '어디에 발급할까요?',
  name: '상호를 알려 주세요',
  bizNo: '사업자등록번호를 알려 주세요',
  amount: '금액을 알려 주세요',
  item: '무엇을 팔았나요?',
};

/** 이 거래처의 목록 줄 둘째 줄: 등록번호 */
const subOf = (c: Counterparty) => c.bizNo || '등록번호 없음';

export function IssueSheet({ onClose, onSubmitted, onCapture, counterparties: given, preview }: {
  onClose: () => void;
  /** 맡긴 뒤(대화에 확인 한 줄이 남는다) */
  onSubmitted: () => void;
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
  const submitIssue = useIssueSubmit();
  const isViaPc = useViaPc();
  const copy = s.data.pcCopy ?? null;
  const fromCopy = useMemo(() => (copy ? counterpartiesOf(copy) : null), [copy]);
  const all = useMemo(() => orderedCounterparties(given ?? (queue.counterparties.length > 0 || !fromCopy ? queue.counterparties : fromCopy)), [given, queue.counterparties, fromCopy]);

  const first = preview?.cpId ? all.find((c) => c.id === preview.cpId) ?? null : null;
  const [step, setStep] = useState<IssueStep>(preview?.step ?? 'cp');
  const [q, setQ] = useState(preview?.query ?? '');
  const [cp, setCp] = useState<Counterparty | null>(first);
  const [name, setName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [vat, setVat] = useState<VatMode>('excl');
  const [amount, setAmount] = useState(preview?.amount ?? (first?.lastSupply ? masked('won', String(first.lastSupply)) : ''));
  const [item, setItem] = useState(preview?.item ?? first?.lastItem ?? '');
  const [closedOk, setClosedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

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
    setFailed(false);
    setStep(to);
  };
  const opened = useRef(false);
  useEffect(() => {
    // 처음 열 때는 키보드를 건드리지 않는다(단계를 옮길 때만 내리거나 올린다)
    const first = !opened.current;
    opened.current = true;
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    if (step === 'cp' || step === 'confirm') {
      if (first && preview?.focus) setTimeout(() => search.current?.focus(), 400);
      else if (!first && preview?.kb === undefined) Keyboard.dismiss();
    } else if (preview?.kb === undefined || preview.kb > 0) setTimeout(() => input.current?.focus(), 230);
  }, [step, slide]);

  // 직접 입력은 [직접 입력]을 눌렀을 때만(고르기 전 첫 단계는 고르는 길로 센다)
  const [manualMode, setManualMode] = useState(preview?.step === 'name' || preview?.step === 'bizNo');
  const manual = !cp && (manualMode || all.length === 0);
  const order: IssueStep[] = manual ? ['cp', 'name', 'bizNo', 'amount', 'item', 'confirm'] : ['cp', 'amount', 'item', 'confirm'];
  const idx = order.indexOf(step);
  const next = () => {
    if (step === 'bizNo') {
      // 이미 있는 거래처의 등록번호면 그 거래처로 잇는다(지난번 금액·품목도 채운다)
      const known = findByBizNo(all, bizNo);
      if (known) return choose(known);
    }
    if (idx >= 0 && idx < order.length - 1) go(order[idx + 1]!);
  };
  const back = () => (idx > 0 ? go(order[idx - 1]!, true) : onClose());

  const choose = (c: Counterparty | null) => {
    tap();
    setCp(c);
    setManualMode(!c);
    setClosedOk(false);
    if (c) {
      setAmount(c.lastSupply ? masked('won', String(c.lastSupply)) : '');
      setItem(c.lastItem ?? '');
      setVat('excl');
      go('amount');
    } else {
      // 찾던 글이 상호처럼 보이면 상호 칸에 채워 둔다
      if (q.trim() && !/^[\d-\s]+$/.test(q.trim())) setName(q.trim());
      else if (q.replace(/\D/g, '').length >= 3) setBizNo(masked('bizNo', q));
      go('name');
    }
  };

  const a = splitAmount(Number(amount.replace(/\D/g, '')), vat);
  const who = cp?.name ?? name.trim();
  const viaPc = isViaPc(cp);
  const online = s.pc === 'online';
  const stale = s.pc === 'stale';
  const closed = cp?.status?.kind === 'closed' && !closedOk ? cp.status : null;
  const firstTime = !cp || cp.issued === 0;

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    const ok = await submitIssue({ cp, name, bizNo, item, day: kstDay(), a });
    setSaving(false);
    if (!ok) return setFailed(true);
    onSubmitted();
  };

  const underline = (key: 'name' | 'bizNo' | 'amount' | 'item', value: string, set: (v: string) => void, opts: { placeholder: string; pad?: boolean; unit?: string; max: number }) => (
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
        returnKeyType="next"
        autoCorrect={false}
        onSubmitEditing={() => primary?.on && primary.go()}
        accessibilityLabel={ASK[key]}
        style={[typeScale.title, st.inputText, { color: p.ink }, { outlineStyle: 'none' } as object]}
      />
      {opts.unit && (
        <T v="sub" c="ink3">
          {opts.unit}
        </T>
      )}
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
              상호와 등록번호를 적으면 바로 발급할 수 있어요
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
                    onPress={() => choose(c)}
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
    body = (
      <>
        <T v="title" role="header">
          {ASK.name}
        </T>
        {underline('name', name, setName, { placeholder: '예: 동네마트', max: 60 })}
      </>
    );
    primary = { label: '다음', on: name.trim().length > 0, go: next };
  } else if (step === 'bizNo') {
    body = (
      <>
        <T v="title" role="header">
          {ASK.bizNo}
        </T>
        {underline('bizNo', bizNo, (v) => setBizNo(masked('bizNo', v)), { placeholder: '000-00-00000', pad: true, max: 12 })}
        <T v="meta" c="ink3">
          사업자등록증에 있는 10자리예요
        </T>
      </>
    );
    primary = { label: '다음', on: bizNo.replace(/\D/g, '').length === 10, go: next };
  } else if (step === 'amount') {
    body = (
      <>
        <T v="title" role="header">
          {ASK.amount}
        </T>
        <Seg
          testID="issue-sheet-vat"
          options={[
            { key: 'excl', label: '부가세 별도' },
            { key: 'incl', label: '부가세 포함' },
          ]}
          value={vat}
          onChange={setVat}
        />
        {underline('amount', amount, (v) => setAmount(masked('won', v)), { placeholder: '0', pad: true, unit: '원', max: 16 })}
        <T v="meta" c="ink3" testID="issue-sheet-sum">
          {a.total > 0 ? `공급가액 ${won(a.supply)}, 세액 ${won(a.tax)}, 합계 ${won(a.total)}` : cp?.lastSupply ? `지난번에는 ${won(cp.lastSupply)}이었어요` : '부가세는 공급가액의 10%예요'}
        </T>
      </>
    );
    primary = { label: '다음', on: a.supply > 0, go: next };
  } else if (step === 'item') {
    body = (
      <>
        <T v="title" role="header">
          {ASK.item}
        </T>
        {underline('item', item, setItem, { placeholder: '예: 식자재', max: 60 })}
        {!!cp?.lastItem && item === cp.lastItem && (
          <T v="meta" c="ink3">
            지난번과 같은 품목이에요
          </T>
        )}
      </>
    );
    primary = { label: '다음', on: true, go: next };
  } else {
    // 확인: 한 면에 받는 곳과 금액. 경고는 하나만(휴·폐업 > 처음 거래하는 곳).
    body = (
      <>
        <T v="title" role="header">
          {`${who}에 발급할까요?`}
        </T>
        <View style={[st.summary, { backgroundColor: p.tint }]} testID="issue-sheet-summary">
          <Line k="받는 곳" v={who} sub={cp?.bizNo ?? bizNo} />
          <Line k="품목" v={item.trim() || '적지 않음'} />
          <Line k="작성일자" v="오늘" />
          <View style={[st.sep, { backgroundColor: p.line, marginVertical: space.s1 }]} />
          <Line k="공급가액" v={won(a.supply)} />
          <Line k="세액" v={won(a.tax)} />
          <Line k="합계" v={won(a.total)} strong />
        </View>
        {closed ? (
          <View style={[st.warn, { backgroundColor: p.attentionSoft }]} testID="issue-sheet-closed" accessibilityRole="alert">
            <T v="sub" c="attention">
              {`${closed.on}에 ${closed.what}한 곳으로 조회돼요`}
            </T>
            <Button kind="quiet" small label="그래도 진행" onPress={() => setClosedOk(true)} testID="issue-sheet-closed-ok" style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : firstTime && !viaPc ? (
          <T v="meta" c="ink3">
            처음 거래하는 곳이라 승인은 PC가 받아요
          </T>
        ) : (
          <T v="meta" c="ink3">
            발급 승인은 PC가 받아요
          </T>
        )}
        {failed && (
          <T v="meta" c="attention" testID="issue-sheet-failed">
            폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요
          </T>
        )}
      </>
    );
    primary = stale ? null : { label: viaPc ? (online ? '발급 맡기기' : 'PC 켜지면 맡기기') : online ? '홈택스에서 준비' : 'PC 켜지면 준비하기', on: !closed && !saving && a.supply > 0, go: () => void submit() };
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
          <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={idx > 0 ? '이전 단계' : '닫기'} style={st.headBtn} testID="issue-sheet-back">
            {idx > 0 ? <Chevron dir="left" color={p.ink2} sizePx={9} /> : <T v="meta" c="ink3">닫기</T>}
          </Pressable>
          <T v="meta" c="ink3" style={{ flex: 1, textAlign: 'center' }}>
            세금계산서 발급
          </T>
          <View style={[st.headBtn, { alignItems: 'flex-end' }]}>
            <T v="meta" c="ink3" testID="issue-sheet-progress">
              {`${idx + 1}/${order.length}`}
            </T>
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
              <Button kind={all.length === 0 ? 'primary' : 'secondary'} label="직접 입력" onPress={() => choose(null)} testID="issue-sheet-manual" style={{ flex: 1 }} />
              <Button kind="secondary" label="등록증 찍기" onPress={onCapture} testID="issue-sheet-capture" style={{ flex: 1 }} />
            </View>
          ) : primary ? (
            <Button label={primary.label} onPress={primary.go} disabled={!primary.on} busy={saving && step === 'confirm'} testID="issue-sheet-next" />
          ) : (
            <T v="sub" c="attention" center testID="issue-sheet-stale">
              PC를 켜면 다시 맡길 수 있어요
            </T>
          )}
        </View>
      </View>
    </View>
  );
}

function Line({ k, v, sub, strong }: { k: string; v: string; sub?: string; strong?: boolean }) {
  return (
    <View style={st.line}>
      <T v="sub" c="ink2">
        {k}
      </T>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <T v={strong ? 'figure' : 'sub'} lines={1}>
          {v}
        </T>
        {!!sub && (
          <T v="meta" c="ink3">
            {sub}
          </T>
        )}
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
  summary: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s1 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3 },
  warn: { borderRadius: radius.md, paddingVertical: space.s3, paddingHorizontal: space.s4, gap: space.s2 },
});
