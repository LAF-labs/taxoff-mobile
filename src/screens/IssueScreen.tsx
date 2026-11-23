import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { clock } from '../chat';
import { findDuplicate, recentCounterparties, searchCounterparties, splitAmount, type Counterparty, type IssuedToday, type VatMode } from '../issue';
import { counterpartiesOf } from '../net/pcCopy';
import { ISSUE_SUBMIT_ERRORS, useIssueSubmit, useViaPc } from '../issueSubmit';
import { kstDay } from '../phoneCmd';
import { fullDay } from '../money';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { MAX_FONT_SCALE, radius, size, space, textScale, type, usePalette } from '../theme';
import { Field, masked } from '../ui/field';
import { Button, Empty, Group, Notice, Pill, Row, Screen, Seg, StatusDot, T, josa, won } from '../ui/kit';
import { localDay } from './CashScreen';

const NB = ' ';
const LAST = '지난번 값';

export interface IssuePreview {
  phase: 'pick' | 'form';
  cpId?: string;
  manual?: boolean;
  amount?: string;
  vat?: VatMode;
  query?: string;
}

export function IssueScreen({
  counterparties: given, issuedToday = [], approvalsLeft = 5, onDone, onCapture, onSubmitted, preview,
}: {
  counterparties?: Counterparty[];
  issuedToday?: IssuedToday[];
  approvalsLeft?: number;
  onDone: () => void;
  onCapture: () => void;
  onSubmitted: () => void;
  preview?: IssuePreview;
}) {
  const s = useSession();
  const queue = useQueue();
  const submitIssue = useIssueSubmit();
  const isViaPc = useViaPc();
  const copy = s.data.pcCopy ?? null;
  const fromCopy = useMemo(() => (copy ? counterpartiesOf(copy) : null), [copy]);
  const counterparties = given ?? (queue.counterparties.length > 0 || !fromCopy ? queue.counterparties : fromCopy);
  const copyAt = !given && queue.counterparties.length === 0 && fromCopy ? copy?.asOf ?? null : null;
  const picked = queue.pickId ? counterparties.find((c) => c.id === queue.pickId) ?? null : null;
  const first = preview?.cpId ? counterparties.find((c) => c.id === preview.cpId) ?? null : picked;
  const [phase, setPhase] = useState<'pick' | 'form'>(preview?.phase ?? (picked ? 'form' : 'pick'));
  const [closedOk, setClosedOk] = useState(false);
  const [pre] = useState(picked ? queue.prefill : null);
  useEffect(() => {
    if (queue.pickId) queue.clearPick();
    if (queue.prefill) queue.setPrefill(null);
  }, []);
  const [cp, setCp] = useState<Counterparty | null>(first);
  const [manual, setManual] = useState(!!preview?.manual);
  const [name, setName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [item, setItem] = useState(pre?.item ?? first?.lastItem ?? '');
  const [day, setDay] = useState(localDay());
  const [vat, setVat] = useState<VatMode>(preview?.vat ?? (pre?.vat === 'included' ? 'incl' : 'excl'));
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [amount, setAmount] = useState(preview?.amount ?? (pre ? masked('won', String(pre.amount)) : first?.lastSupply ? masked('won', String(first.lastSupply)) : ''));
  const [dupOk, setDupOk] = useState(false);

  const pick = (c: Counterparty | null) => {
    setClosedOk(false);
    setCp(c);
    setManual(!c);
    setItem(c?.lastItem ?? '');
    setAmount(c?.lastSupply ? masked('won', String(c.lastSupply)) : '');
    setVat('excl');
    setDupOk(false);
    setSubmitError(null);
    setPhase('form');
  };

  if (phase === 'pick') return <Picker all={counterparties} copyAt={copyAt} initialQuery={preview?.query ?? ''} onPick={pick} onDone={onDone} onCapture={onCapture} />;

  const live = cp ? counterparties.find((c) => c.id === cp.id) ?? cp : null;
  const status = live?.status;
  const closed = status?.kind === 'closed' && !closedOk ? status : null;
  const a = splitAmount(Number(amount.replace(/\D/g, '')), vat);
  const lastAmount = cp?.lastSupply ? masked('won', String(cp.lastSupply)) : null;
  const who = cp?.name ?? name.trim();
  const dup = cp && !dupOk ? findDuplicate(issuedToday, cp.id, a.total) : null;
  const firstTime = manual || (cp?.issued ?? 0) === 0;
  const online = s.pc === 'online';
  const stale = s.pc === 'stale';
  const viaPc = !manual && isViaPc(cp);
  const ready = !!who && (cp ? true : bizNo.replace(/\D/g, '').length === 10) && a.supply > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day) && !dup && !closed;

  let notice = null;
  if (closed) {
    notice = (
      <ClosedWarning
        line={`${josa(who, '은', '는')} ${closed.on} ${closed.what}으로 조회돼요`}
        onGo={() => setClosedOk(true)}
        onBack={() => setPhase('pick')}
      />
    );
  } else if (dup) {
    notice = (
      <View style={{ gap: space.s2 }} testID="issue-dup">
        <Notice>
          오늘 {clock(dup.at).replace(' ', NB)}에 같은 금액으로 이미 발급했어요
        </Notice>
        <Button kind="secondary" small label="그래도 작성" onPress={() => setDupOk(true)} testID="issue-dup-ok" style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  } else if (viaPc) notice = null;
  else if (firstTime) notice = <Notice testID="issue-first">처음 거래하는 곳이라 폰으로는 승인할 수 없어요</Notice>;
  else if (approvalsLeft <= 1)
    notice = <Notice testID="issue-limit">{approvalsLeft === 0 ? '오늘 폰 승인을 다 썼어요. 내일 0시에 다시 생겨요' : `오늘 폰 승인은 ${approvalsLeft}건 남았어요`}</Notice>;

  const entered = Number(amount.replace(/\D/g, ''));
  const inexactLine = a.inexact && a.total > 0 ? `합계 ${won(entered)}은 정확히 맞출 수 없어 ${won(a.total)}으로 했어요` : null;
  const inexactAsNotice = !!inexactLine && !notice;
  if (inexactAsNotice) notice = <Notice testID="issue-inexact">{inexactLine}</Notice>;

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setSubmitError(null);
    const result = await submitIssue({ cp: manual ? null : cp, item, a, draftId: pre?.draftId });
    setSaving(false);
    if (result !== 'submitted') return setSubmitError(ISSUE_SUBMIT_ERRORS[result]);
    onSubmitted();
  };

  const footer = stale ? (
    <T v="sub" c="attention" center testID="issue-stale">
      PC를 켜면 다시 맡길 수 있어요
    </T>
  ) : (
    <>
      {closed && (
        <T v="meta" c="ink2" center testID="issue-submit-why">
          폐업 경고를 먼저 확인해 주세요
        </T>
      )}
      {submitError && (
        <T v="meta" c="attention" role="alert" center testID="issue-save-failed">
          {submitError}
        </T>
      )}
      <Button testID="issue-submit" label={viaPc ? (online ? '발급 맡기기' : 'PC 켜지면 맡기기') : '발급하기'} onPress={() => void submit()} disabled={!ready || saving} />
    </>
  );

  return (
    <Screen title="세금계산서 발급" onBack={() => setPhase('pick')} backLabel="거래처 다시 고르기" testID="issue-form">
      {notice}
      <View style={{ gap: space.s2 }}>
      <Group title="받는 곳">
        {cp ? (
          <Row label={cp.name} sub={cp.bizNo} value="바꾸기" valueInk="ink3" onPress={() => setPhase('pick')} testID="issue-cp" />
        ) : (
          <>
            <Field label="상호" value={name} onChange={setName} placeholder="상호" testID="issue-name" />
            <Field label="등록번호" value={bizNo} onChange={setBizNo} mask="bizNo" placeholder="000-00-00000" testID="issue-bizno" />
          </>
        )}
      </Group>
      {statusNote(status, firstTime && (!!closed || !!dup))}
      </View>
      <Group title="내용">
        <Field label="품목" value={item} onChange={setItem} placeholder="예: 식자재" tag={cp?.lastItem && item === cp.lastItem ? LAST : undefined} testID="issue-item" />
        {viaPc ? (
          <Row label="작성일자" value={`오늘(${fullDay(kstDay())})`} testID="issue-day-today" />
        ) : (
          <Field label="작성일자" value={day} onChange={setDay} mask="day" testID="issue-day" />
        )}
      </Group>
      <View style={{ gap: space.s2 }}>
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          금액
        </T>
        <Seg
          testID="issue-vat"
          options={[
            { key: 'excl', label: '부가세 별도' },
            { key: 'incl', label: '부가세 포함' },
          ]}
          value={vat}
          onChange={(v) => {
            setVat(v);
            setDupOk(false);
          }}
        />
        <Group>
          <Field
            label={vat === 'excl' ? '공급가액' : '합계'}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setDupOk(false);
            }}
            mask="won"
            unit="원"
            placeholder="0"
            tag={lastAmount && amount === lastAmount && vat === 'excl' ? LAST : undefined}
            testID="issue-amount"
          />
          <View style={st.sums} testID="issue-sum">
            <View style={st.sum}>
              <T v="sub" c="ink2">세액</T>
              <T v="value" c="ink2" style={st.sumValue}>{won(a.tax)}</T>
            </View>
            <View style={st.sum}>
              <T v="sub" c="ink2">합계</T>
              <T v="figure" style={st.sumValue}>{won(a.total)}</T>
            </View>
            {inexactLine && !inexactAsNotice && (
              <T v="meta" c="attention" style={{ textAlign: 'right' }} testID="issue-inexact">
                {inexactLine}
              </T>
            )}
          </View>
        </Group>
      </View>
      <View style={st.actions}>{footer}</View>
    </Screen>
  );
}

function ClosedWarning({ line, onGo, onBack }: { line: string; onGo: () => void; onBack: () => void }) {
  const p = usePalette();
  return (
    <View style={[st.warn, { backgroundColor: p.attentionSoft }]} testID="issue-closed" accessibilityRole="alert">
      <T v="sub" c="attention">
        {line}
      </T>
      <View style={st.warnActions}>
        <Pill label="그래도 진행" onPress={onGo} testID="issue-closed-ok" />
        <Pill quiet label="거래처 다시 고르기" onPress={onBack} testID="issue-closed-cancel" />
      </View>
    </View>
  );
}

function statusNote(status: Counterparty['status'], firstAsLine: boolean) {
  const parts: React.ReactNode[] = [];
  if (status?.kind === 'checking') parts.push(<StatusDot key="s" busy tone="quiet" v="meta" label="PC가 휴폐업 여부를 확인해요" testID="issue-status-checking" />);
  if (status?.kind === 'waitPc') parts.push(<T key="s" v="meta" c="ink3" testID="issue-status-wait">PC가 켜지면 휴폐업을 확인해요</T>);
  if (status?.kind === 'ok') parts.push(<T key="s" v="meta" c="ink3" testID="issue-status-ok">휴폐업 조회 정상</T>);
  if (firstAsLine) parts.push(<T key="f" v="meta" c="ink3">처음 거래하는 곳이라 폰으로는 승인할 수 없어요</T>);
  return parts.length ? <View style={{ gap: 2, paddingHorizontal: space.s1 }}>{parts}</View> : null;
}

function Picker({
  all, copyAt, initialQuery, onPick, onDone, onCapture,
}: { all: Counterparty[]; copyAt: number | null; initialQuery: string; onPick: (c: Counterparty | null) => void; onDone: () => void; onCapture: () => void }) {
  const p = usePalette();
  const [q, setQ] = useState(initialQuery);
  if (all.length === 0) {
    return (
      <Screen title="거래처 고르기" onBack={onDone} scroll={false} testID="issue-picker">
        <Empty
          testID="issue-picker-empty"
          title="거래처가 아직 없어요"
          sub="사업자등록증을 찍거나, 상호와 등록번호를 직접 적어 주세요."
          action={
            <View style={{ gap: space.s2 }}>
              <Button label="등록증 찍기" onPress={onCapture} testID="picker-capture" />
              <Button kind="secondary" label="직접 입력" onPress={() => onPick(null)} testID="picker-manual" />
            </View>
          }
        />
      </Screen>
    );
  }
  const recent = recentCounterparties(all);
  const found = searchCounterparties(all, q);
  const k = textScale.web;
  return (
    <Screen title="거래처 고르기" onBack={onDone} testID="issue-picker">
      {!q && (
        <Group title="최근 거래처" testID="picker-recent" note={copyAt ? `PC 기준 ${copyWhen(copyAt)}` : undefined}>
          {recent.map((c) => (
            <Row key={c.id} label={c.name} sub={lastLine(c)} onPress={() => onPick(c)} testID={`cp-${c.id}`} />
          ))}
        </Group>
      )}
      <View style={{ gap: space.s2 }}>
        <TextInput
          testID="picker-search"
          value={q}
          onChangeText={setQ}
          placeholder="상호나 등록번호로 찾기"
          placeholderTextColor={p.ink3}
          accessibilityLabel="거래처 찾기"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          returnKeyType="search"
          autoCorrect={false}
          style={[type.body, k !== 1 && { fontSize: type.body.fontSize * k, lineHeight: type.body.lineHeight * k }, st.search, { backgroundColor: p.tint, color: p.ink }]}
        />
        {q.trim() !== '' &&
          (found.length > 0 ? (
            <Group title="찾은 거래처">
              {found.map((c) => (
                <Row key={c.id} label={c.name} sub={[c.bizNo, c.lastAt ? lastLine(c) : ''].filter(Boolean).join(', ') || undefined} onPress={() => onPick(c)} testID={`cp-${c.id}`} />
              ))}
            </Group>
          ) : (
            <T v="sub" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              찾는 거래처가 없어요
            </T>
          ))}
      </View>
      <Group>
        <Row label="사업자등록증 찍어서 추가" onPress={onCapture} testID="picker-capture" />
        <Row label="새 거래처 직접 입력" onPress={() => onPick(null)} testID="picker-manual" />
      </Group>
    </Screen>
  );
}

function lastLine(c: Counterparty): string {
  const parts = [c.lastSupply ? `지난번${NB}${won(c.lastSupply)}` : null, c.lastItem ?? null].filter(Boolean);
  return parts.join(', ') || c.bizNo;
}

const st = StyleSheet.create({
  warn: { borderRadius: radius.md, paddingVertical: space.s3, paddingHorizontal: space.s4, gap: space.s3 },
  warnActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  actions: { gap: space.s2, paddingTop: space.s2 },
  sums: { paddingHorizontal: space.s4, paddingTop: space.s1, paddingBottom: space.s3, gap: space.s1 },
  sum: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', gap: space.s3 },
  sumValue: { minWidth: 120, textAlign: 'right' },
  search: { minHeight: size.hit + 4, borderRadius: radius.full, paddingHorizontal: space.s4 },
});

export function copyWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월${NB}${d.getDate()}일 ${clock(ts)}`;
}
