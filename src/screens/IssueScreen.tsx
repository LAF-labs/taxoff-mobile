// 발급 작성(P-10)과 거래처 고르기(P-11), 기획 v2 PR 2. 화면만 있고 프로토콜은 아직 없다.
// - 열면 거래처 고르기부터: 최근 거래처 다섯 곳(지난번 금액·품목), 아래에 찾기. 없으면 [등록증 찍기] [직접 입력].
// - 고르면 지난번 값을 채우고 "지난번 값" 꼬리표. 칸은 누르면 그 자리에서 고친다(Field).
// - 금액: [부가세 별도|포함] 아래 숫자 칸, 그 밑 한 줄에 공급가액·세액·합계(세액 = 공급가액 10% 버림).
// - 바닥 주요 단추는 PC 상태를 따른다: 켜짐 [홈택스에서 준비] · 꺼짐 [PC 켜지면 준비하기] · 오래 꺼짐 단추 없이 황토 한 줄.
// - 경고는 한 번에 하나(Notice): 오늘 같은 곳 같은 금액 > 처음 거래하는 곳 > 폰 승인 남은 건수.
// - PC 사본에서 고른 거래처는 폰 발급 명령(cmd.run)으로 맡긴다: [발급 맡기기], 승인은 PC 승인 바, 작성일자는 오늘(src/phoneCmd.ts).
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { clock } from '../chat';
import { findDuplicate, recentCounterparties, searchCounterparties, splitAmount, type Counterparty, type IssuedToday, type VatMode } from '../issue';
import type { Job } from '../queue';
import { ulid } from '@sax/remote';
import { chatCopyOf, counterpartiesOf } from '../net/pcCopy';
import { offlineChat } from '../offline/device';
import { issueRequest, kstDay, type PhoneCmd } from '../phoneCmd';
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
  /** 없으면 저장소의 거래처 */
  counterparties?: Counterparty[];
  issuedToday?: IssuedToday[];
  /** 오늘 폰으로 승인할 수 있는 남은 건수 */
  approvalsLeft?: number;
  onDone: () => void;
  /** 사업자등록증 찍기 */
  onCapture: () => void;
  /** 맡긴 뒤(밀린 일에 넣고 대화에 확인 한 줄을 남긴 뒤) 홈으로 */
  onSubmitted: () => void;
  preview?: IssuePreview;
}) {
  const s = useSession();
  const queue = useQueue();
  // 저장소에 거래처가 없으면 PC가 넘긴 사본(AppData.pcCopy)의 거래처를 쓴다. 사본도 없으면 지금처럼 빈 목록.
  const copy = s.data.pcCopy ?? null;
  const fromCopy = useMemo(() => (copy ? counterpartiesOf(copy) : null), [copy]);
  const counterparties = given ?? (queue.counterparties.length > 0 || !fromCopy ? queue.counterparties : fromCopy);
  const copyAt = !given && queue.counterparties.length === 0 && fromCopy ? copy?.asOf ?? null : null;
  // 등록증으로 막 만든 거래처가 있으면 그것을 골라 둔 채로 연다(기획 v2 PR 7)
  const picked = queue.pickId ? counterparties.find((c) => c.id === queue.pickId) ?? null : null;
  const first = preview?.cpId ? counterparties.find((c) => c.id === preview.cpId) ?? null : picked;
  const [phase, setPhase] = useState<'pick' | 'form'>(preview?.phase ?? (picked ? 'form' : 'pick'));
  const [closedOk, setClosedOk] = useState(false);
  // 대화 카드에서 연 경우: 카드의 금액·부가세·품목을 채워 둔다(거래처가 골라졌을 때만). 한 번 읽고 지운다.
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
  /** PC에 맡길 명령을 폰에 저장하는 중 · 저장 실패 */
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
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
  // PC 사본에서 고른 거래처면 폰 발급 명령(cmd.run)으로 맡긴다: 거래처는 ref만, 승인은 PC 승인 바, 작성일자는 오늘(한국 시간)
  const viaPc = !!cp && !manual && !!fromCopy?.some((c) => c.id === cp.id) && !!s.data.pair;
  const ready = !!who && (cp ? true : bizNo.replace(/\D/g, '').length === 10) && a.supply > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day) && !dup && !closed;

  let notice = null;
  if (closed) {
    // 08 §11 "거래처 휴·폐업": 초안 단계 경고 줄 + [그래도 진행] [취소]
    // 경고와 두 단추를 한 황토 면 안에. [다시 고르기]는 거래처 고르기로 돌아간다.
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
  else if (firstTime) notice = <Notice testID="issue-first">처음 거래하는 곳이라 발급 승인은 PC에서 해요</Notice>;
  else if (approvalsLeft <= 1)
    notice = <Notice testID="issue-limit">{approvalsLeft === 0 ? '오늘 폰 승인을 다 썼어요. 발급 승인은 PC에서 해요' : `오늘 폰 승인은 ${approvalsLeft}건 남았어요`}</Notice>;

  // 부가세 포함 합계를 세액 규칙(10% 버림)으로 정확히 못 만드는 값이면 아래로 맞추고 알린다.
  const entered = Number(amount.replace(/\D/g, ''));
  const inexactLine = a.inexact && a.total > 0 ? `합계 ${won(entered)}은 정확히 맞출 수 없어 ${won(a.total)}으로 했어요` : null;
  const inexactAsNotice = !!inexactLine && !notice;
  if (inexactAsNotice) notice = <Notice testID="issue-inexact">{inexactLine}</Notice>;

  const submitToPc = async () => {
    if (!cp || saving) return;
    const cmd: PhoneCmd = { cmdId: ulid(), req: issueRequest({ ref: cp.id, supply: a.supply, item }), cpName: cp.name, total: a.total, createdAt: Date.now() };
    setSaving(true);
    setSaveFailed(false);
    // 보내기 전에 봉인 상태에 저장한다(다시 보낼 때 같은 cmdId). 저장하지 못하면 맡기지 않고 이 화면에 남는다.
    try {
      await s.update((d) => ({ ...d, cmds: [...(d.cmds ?? []), cmd] }));
    } catch {
      // 메모리에 먼저 들어간 명령을 빼서, 다음 저장이 맡기지 않은 명령을 적지 않게 한다
      await s.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmd.cmdId) })).catch(() => undefined);
      setSaving(false);
      setSaveFailed(true);
      return;
    }
    setSaving(false);
    // 대화 카드에서 왔으면 그 카드를 맡김으로(폰 대화가 같은 카드를 다시 고치지 않게)
    if (pre?.draftId && s.data.pair) void offlineChat(s.data.pair, s.keys, () => chatCopyOf(s.data.pcCopy))?.entrust(pre.draftId).catch(() => undefined);
    queue.noteCmd(`cmd-${cmd.cmdId}`, online ? null : `${cp.name} 세금계산서 ${won(a.total)}을 맡겼어요. PC 켜지면 보내요`);
    void s.sync();
    onSubmitted();
  };

  const submit = () => {
    if (viaPc) return void submitToPc();
    const job: Job = { id: `job-${Date.now()}`, title: `${who} 세금계산서`, amount: a.total, createdAt: Date.now(), state: online ? 'running' : 'entrusted' };
    // PC가 되읽을 값(시연 저장소가 승인 요청을 만들 때만 쓴다). 금액은 원 단위 숫자 글자.
    const readback = {
      counterpartBizNo: cp?.bizNo ?? bizNo, counterpartName: who, counterpartEmail: '', itemName: item, itemCount: '1',
      supplyAmount: String(a.supply), taxAmount: String(a.tax), totalAmount: String(a.total), issueDate: day, remark: '', receiptType: '청구',
    };
    queue.add({ ...job }, online ? `${job.title} ${won(a.total)}을 홈택스에서 준비하고 있어요` : `${job.title} ${won(a.total)}을 맡겼어요. PC 켜지면 준비해요`, online ? { supplierBizNo: '', supplierName: '', ...readback } : undefined);
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
      {viaPc && saveFailed && (
        <T v="meta" c="attention" center testID="issue-save-failed">
          폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요
        </T>
      )}
      {viaPc && (
        <T v="meta" c="ink3" center testID="issue-pc-approve">
          승인은 PC 승인 바에서 해요
        </T>
      )}
      <Button testID="issue-submit" label={viaPc ? (online ? '발급 맡기기' : 'PC 켜지면 맡기기') : online ? '홈택스에서 준비' : 'PC 켜지면 준비하기'} onPress={submit} disabled={!ready || saving} />
    </>
  );

  return (
    <Screen title="세금계산서 발급" onBack={() => setPhase('pick')} backLabel="거래처 다시 고르기" testID="issue-form" footer={footer}>
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
          <Row label="작성일자" value={`${kstDay()} 오늘`} testID="issue-day-today" />
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
    </Screen>
  );
}

/** 휴·폐업 경고: 황토 면 하나에 한 줄과 두 단추(08 §11 [그래도 진행] [취소], 취소는 거래처 다시 고르기). */
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

/** 받는 곳 아래 한 줄: 휴·폐업 확인 진행, 그리고 다른 경고가 Notice를 차지했을 때의 처음 거래처 안내 */
function statusNote(status: Counterparty['status'], firstAsLine: boolean) {
  const parts: React.ReactNode[] = [];
  if (status?.kind === 'checking') parts.push(<StatusDot key="s" busy tone="quiet" v="meta" label="PC가 휴·폐업 여부를 확인해요" testID="issue-status-checking" />);
  if (status?.kind === 'waitPc') parts.push(<T key="s" v="meta" c="ink3" testID="issue-status-wait">PC가 켜지면 휴·폐업을 확인해요</T>);
  if (status?.kind === 'ok') parts.push(<T key="s" v="meta" c="ink3" testID="issue-status-ok">휴·폐업 조회 정상</T>);
  if (firstAsLine) parts.push(<T key="f" v="meta" c="ink3">처음 거래하는 곳이라 승인은 PC에서 해요</T>);
  return parts.length ? <View style={{ gap: 2, paddingHorizontal: space.s1 }}>{parts}</View> : null;
}

/** 거래처 고르기(P-11): 최근 다섯 곳 → 찾기 → 직접 입력. */
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
                <Row key={c.id} label={c.name} sub={[c.bizNo, c.lastAt ? lastLine(c) : ''].filter(Boolean).join(' · ') || undefined} onPress={() => onPick(c)} testID={`cp-${c.id}`} />
              ))}
            </Group>
          ) : (
            <T v="sub" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              찾는 거래처가 없어요
            </T>
          ))}
      </View>
      <Group>
        <Row label="새 거래처 · 사업자등록증 찍기" onPress={onCapture} testID="picker-capture" />
        <Row label="새 거래처 직접 입력" onPress={() => onPick(null)} testID="picker-manual" />
      </Group>
    </Screen>
  );
}

function lastLine(c: Counterparty): string {
  const parts = [c.lastSupply ? `지난번${NB}${won(c.lastSupply)}` : null, c.lastItem ?? null].filter(Boolean);
  return parts.join(' · ') || c.bizNo;
}

const st = StyleSheet.create({
  warn: { borderRadius: radius.md, paddingVertical: space.s3, paddingHorizontal: space.s4, gap: space.s3 },
  warnActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  sums: { paddingHorizontal: space.s4, paddingTop: space.s1, paddingBottom: space.s3, gap: space.s1 },
  sum: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', gap: space.s3 },
  sumValue: { minWidth: 120, textAlign: 'right' },
  search: { minHeight: size.hit + 4, borderRadius: radius.full, paddingHorizontal: space.s4 },
});

/** 사본 시각 "11월 17일 오전 10:00" */
export function copyWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월${NB}${d.getDate()}일 ${clock(ts)}`;
}
