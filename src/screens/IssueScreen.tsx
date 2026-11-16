// 발급 작성(P-10)과 거래처 고르기(P-11), 기획 v2 PR 2. 화면만 있고 프로토콜은 아직 없다.
// - 열면 거래처 고르기부터: 최근 거래처 다섯 곳(지난번 금액·품목), 아래에 찾기. 없으면 [등록증 찍기] [직접 입력].
// - 고르면 지난번 값을 채우고 "지난번 값" 꼬리표. 칸은 누르면 그 자리에서 고친다(Field).
// - 금액: [부가세 별도|포함] 아래 숫자 칸, 그 밑 한 줄에 공급가액·세액·합계(세액 = 공급가액 10% 버림).
// - 바닥 주요 단추는 PC 상태를 따른다: 켜짐 [홈택스에서 준비] · 꺼짐 [PC 켜지면 준비하기] · 오래 꺼짐 단추 없이 황토 한 줄.
// - 경고는 한 번에 하나(Notice): 오늘 같은 곳 같은 금액 > 처음 거래하는 곳 > 폰 승인 남은 건수.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { clock } from '../chat';
import { findDuplicate, recentCounterparties, searchCounterparties, splitAmount, type Counterparty, type IssuedToday, type VatMode } from '../issue';
import type { Job } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { MAX_FONT_SCALE, radius, size, space, textScale, type, usePalette } from '../theme';
import { Field, masked } from '../ui/field';
import { Button, Empty, Group, Notice, Row, Screen, Seg, T, won } from '../ui/kit';
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
  counterparties, issuedToday = [], approvalsLeft = 5, onDone, onCapture, onSubmitted, preview,
}: {
  counterparties: Counterparty[];
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
  const first = preview?.cpId ? counterparties.find((c) => c.id === preview.cpId) ?? null : null;
  const [phase, setPhase] = useState<'pick' | 'form'>(preview?.phase ?? 'pick');
  const [cp, setCp] = useState<Counterparty | null>(first);
  const [manual, setManual] = useState(!!preview?.manual);
  const [name, setName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [item, setItem] = useState(first?.lastItem ?? '');
  const [day, setDay] = useState(localDay());
  const [vat, setVat] = useState<VatMode>(preview?.vat ?? 'excl');
  const [amount, setAmount] = useState(preview?.amount ?? (first?.lastSupply ? masked('won', String(first.lastSupply)) : ''));
  const [dupOk, setDupOk] = useState(false);

  const pick = (c: Counterparty | null) => {
    setCp(c);
    setManual(!c);
    setItem(c?.lastItem ?? '');
    setAmount(c?.lastSupply ? masked('won', String(c.lastSupply)) : '');
    setVat('excl');
    setDupOk(false);
    setPhase('form');
  };

  if (phase === 'pick') return <Picker all={counterparties} initialQuery={preview?.query ?? ''} onPick={pick} onDone={onDone} onCapture={onCapture} />;

  const a = splitAmount(Number(amount.replace(/\D/g, '')), vat);
  const lastAmount = cp?.lastSupply ? masked('won', String(cp.lastSupply)) : null;
  const who = cp?.name ?? name.trim();
  const dup = cp && !dupOk ? findDuplicate(issuedToday, cp.id, a.total) : null;
  const firstTime = manual || (cp?.issued ?? 0) === 0;
  const online = s.pc === 'online';
  const stale = s.pc === 'stale';
  const ready = !!who && (cp ? true : bizNo.replace(/\D/g, '').length === 10) && a.supply > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day) && !dup;

  let notice = null;
  if (dup) {
    notice = (
      <View style={{ gap: space.s2 }} testID="issue-dup">
        <Notice>
          오늘 {clock(dup.at).replace(' ', NB)}에 같은 금액으로 이미 발급했어요
        </Notice>
        <Button kind="secondary" small label="그래도 작성" onPress={() => setDupOk(true)} testID="issue-dup-ok" style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  } else if (firstTime) notice = <Notice testID="issue-first">처음 거래하는 곳이라 발급 승인은 PC에서 해요</Notice>;
  else if (approvalsLeft <= 1)
    notice = <Notice testID="issue-limit">{approvalsLeft === 0 ? '오늘 폰 승인을 다 썼어요. 발급 승인은 PC에서 해요' : `오늘 폰 승인은 ${approvalsLeft}건 남았어요`}</Notice>;

  // 부가세 포함 합계를 세액 규칙(10% 버림)으로 정확히 못 만드는 값이면 아래로 맞추고 알린다.
  const entered = Number(amount.replace(/\D/g, ''));
  const inexactLine = a.inexact && a.total > 0 ? `합계 ${won(entered)}은 정확히 맞출 수 없어 ${won(a.total)}으로 했어요` : null;
  const inexactAsNotice = !!inexactLine && !notice;
  if (inexactAsNotice) notice = <Notice testID="issue-inexact">{inexactLine}</Notice>;

  const submit = () => {
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
    <Button testID="issue-submit" label={online ? '홈택스에서 준비' : 'PC 켜지면 준비하기'} onPress={submit} disabled={!ready} />
  );

  return (
    <Screen title="세금계산서 발급" onBack={() => setPhase('pick')} backLabel="거래처 다시 고르기" testID="issue-form" footer={footer}>
      {notice}
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
      <Group title="내용">
        <Field label="품목" value={item} onChange={setItem} placeholder="예: 식자재" tag={cp?.lastItem && item === cp.lastItem ? LAST : undefined} testID="issue-item" />
        <Field label="작성일자" value={day} onChange={setDay} mask="day" testID="issue-day" />
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

/** 거래처 고르기(P-11): 최근 다섯 곳 → 찾기 → 직접 입력. */
function Picker({
  all, initialQuery, onPick, onDone, onCapture,
}: { all: Counterparty[]; initialQuery: string; onPick: (c: Counterparty | null) => void; onDone: () => void; onCapture: () => void }) {
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
        <Group title="최근 거래처" testID="picker-recent">
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
                <Row key={c.id} label={c.name} sub={`${c.bizNo}${c.lastAt ? ` · ${lastLine(c)}` : ''}`} onPress={() => onPick(c)} testID={`cp-${c.id}`} />
              ))}
            </Group>
          ) : (
            <T v="sub" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              찾는 거래처가 없어요
            </T>
          ))}
      </View>
      <Group>
        <Row label="새 거래처 직접 입력" onPress={() => onPick(null)} testID="picker-manual" />
        <Row label="사업자등록증 찍기" onPress={onCapture} testID="picker-capture" />
      </Group>
    </Screen>
  );
}

function lastLine(c: Counterparty): string {
  const parts = [c.lastSupply ? `지난번${NB}${won(c.lastSupply)}` : null, c.lastItem ?? null].filter(Boolean);
  return parts.join(' · ') || c.bizNo;
}

const st = StyleSheet.create({
  sums: { paddingHorizontal: space.s4, paddingTop: space.s1, paddingBottom: space.s3, gap: space.s1 },
  sum: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', gap: space.s3 },
  sumValue: { minWidth: 120, textAlign: 'right' },
  search: { minHeight: size.hit + 4, borderRadius: radius.full, paddingHorizontal: space.s4 },
});
