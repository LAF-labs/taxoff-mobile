import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { CopyReport } from '@sax/remote';
import { useSession } from '../session';
import { space } from '../theme';
import { Actions, Card, Kv, KvRow } from '../ui/card';
import { Button, Empty, Group, Notice, Row, Screen, Seg, T, won } from '../ui/kit';
import { BarChart, Legend, MonthStep, RankRows, Tip, type BarCol, type RankItem } from '../ui/report';
import { Sheet } from '../ui/sheet';
import { clampMonth, partnerMonths, reportView, reportWait, shiftMonth, spanText, topOf, WINDOWS, type ChartCol, type Line, type Months, type Rank, type RankRow, type ReportWait } from '../report';
import { canReportPdf, shareReportPdf } from '../reportPdf';
import type { HomeRoute } from './HomeScreen';

/**
 * 월 리포트(tex ADR-068, 기준판 Phone-Report 2026-11-25 대표 승인). PC가 보낸 사본만으로 그린다.
 * PC가 꺼져 있으면 마지막 사본을 그대로 보인다(따로 안내 글을 두지 않는다).
 */

type Side = 'sale' | 'purchase';
type Open = { kind: 'partner'; side: Side; row: RankRow } | { kind: 'all'; what: 'partners' | 'items'; side: Side } | null;

/** 갤러리: 고른 기간과 달, 연 시트(거래처는 몇째 줄), 누르고 있는 막대 */
export interface ReportPreview {
  months?: Months;
  month?: string;
  partner?: number;
  all?: 'partners' | 'items';
  hold?: string;
}

const SIDES: Array<{ key: Side; label: string }> = [
  { key: 'sale', label: '매출' },
  { key: 'purchase', label: '매입' },
];
const amountText = (l: Line) => (l.amount === null ? '확인 못 함' : won(l.amount));
const unsure = (l: Line) => l.amount === null || l.partial;
const pctText = (share: number) => `${Math.round(share * 100)}%`;
const monthNo = (m: string) => Number(m.slice(5, 7));
const WAIT_TEXT: Record<ReportWait, string> = {
  off: 'PC가 켜지면 리포트를 받아 와요',
  loading: '리포트를 받아 오는 중이에요',
  pc_old: 'PC 앱이 업데이트되면 리포트가 보여요',
  not_made: 'PC가 리포트를 아직 만들지 못했어요',
};

export function ReportScreen({ go, onMoney, preview }: { go: (to: HomeRoute) => void; onMoney: () => void; preview?: ReportPreview }) {
  const s = useSession();
  const copy = s.data.pcCopy?.report ?? null;
  if (!s.data.pair) {
    return (
      <Screen title="리포트" shell scroll={false} testID="report">
        <Empty testID="report-unpaired" title="PC와 연결하면 리포트가 보여요" action={<Button label="PC 연결하기" onPress={() => go('pair')} />} />
      </Screen>
    );
  }
  if (!copy) {
    const wait = reportWait(s.pc, s.data.pcCopy);
    return (
      <Screen title="리포트" shell scroll={false} testID="report">
        <Empty
          testID={`report-none-${wait}`}
          title={WAIT_TEXT[wait]}
          action={wait === 'off' ? <Button kind="secondary" label="연결한 PC 보기" onPress={() => go('connection')} /> : undefined}
        />
      </Screen>
    );
  }
  return <Report copy={copy} onMoney={onMoney} preview={preview} />;
}

function Report({ copy, onMoney, preview }: { copy: CopyReport; onMoney: () => void; preview?: ReportPreview }) {
  const [months, setMonths] = useState<Months>(preview?.months ?? 1);
  const [picked, setPicked] = useState<string | null>(preview?.month ?? null);
  const [partnerSide, setPartnerSide] = useState<Side>('sale');
  const [itemSide, setItemSide] = useState<Side>('sale');
  const [open, setOpen] = useState<Open>(() => {
    if (!preview) return null;
    const w = copy.windows.find((x) => x.months === (preview.months ?? 1));
    if (preview.all) return { kind: 'all', what: preview.all, side: 'sale' };
    if (preview.partner === undefined || !w) return null;
    const v0 = reportView(copy, copy.month, preview.months ?? 1);
    const row = v0.ranks?.ps.rows[preview.partner];
    return row ? { kind: 'partner', side: 'sale', row } : null;
  });
  const [pdf, setPdf] = useState<'idle' | 'busy' | 'failed'>('idle');
  // 새 사본이 오면(달이 바뀌었거나 PC가 다시 계산) 고른 달이 사본 밖이면 가장 가까운 달로
  const month = clampMonth(copy, picked ?? copy.month, months);
  const v = useMemo(() => reportView(copy, month, months), [copy, month, months]);
  useEffect(() => {
    if (pdf === 'failed') setPdf('idle');
  }, [month, months]);

  const year = copy.today.slice(0, 4);
  const label = month.slice(0, 4) === year ? `${monthNo(month)}월` : `${month.slice(0, 4)}년 ${monthNo(month)}월`;
  const span = spanText(month, months);
  const hasPurchase = [v.purchase.inv, v.purchase.card, v.purchase.cr].some(known) || !!v.purchase.rcpt.amount || v.purchase.pay.amount !== null;
  const chartPurchase = v.chart.some((c) => !!c.purchase.total.amount);
  const rankPurchase = !!v.ranks && v.ranks.pp.rows.length > 0;
  const missing = [!hasPurchase ? '매입' : null, !known(v.sales.card) ? '카드 매출' : null, !v.bank ? '통장' : null].filter((x): x is string => !!x);
  const count = v.ranks ? v.ranks.ps.rows.reduce((n, x) => n + x.n, 0) + (v.ranks.ps.rest?.n ?? 0) : undefined;
  const saleParts = knownParts([
    ['세금계산서', v.sales.inv, count],
    ['카드 매출', v.sales.card],
    ['현금영수증', v.sales.cr],
    ['현금 매출', v.sales.cash],
  ]);
  const vatDue = v.vat && v.vat.s !== null && v.vat.p !== null ? v.vat.s - v.vat.p : null;
  const savePdf = async () => {
    setPdf('busy');
    setPdf((await shareReportPdf(copy, v)) === 'shared' ? 'idle' : 'failed');
  };

  return (
    <Screen title="리포트" shell gap={space.s3} testID="report">
      <MonthStep
        label={label}
        prev={{ a11y: v.first ? '앞 달 없음' : `${monthNo(shiftMonth(month, -1))}월 보기`, onPress: v.first ? null : () => setPicked(shiftMonth(month, -1)) }}
        next={{ a11y: v.latest ? '다음 달 없음' : `${monthNo(shiftMonth(month, 1))}월 보기`, onPress: v.latest ? null : () => setPicked(shiftMonth(month, 1)) }}
        onPdf={canReportPdf() ? () => void savePdf() : undefined}
        pdfBusy={pdf === 'busy'}
      />
      {pdf === 'failed' && (
        <T v="sub" c="attention" testID="report-pdf-failed">
          PDF를 만들지 못했어요. 다시 눌러 주세요.
        </T>
      )}
      <Seg options={WINDOWS.map((w) => ({ key: String(w.key) as `${Months}`, label: w.label }))} value={String(months) as `${Months}`} onChange={(k) => setMonths(Number(k) as Months)} fill testID="report-window" />

      {missing.length > 0 && (
        <Notice icon testID="report-missing">
          {`${missing.join(', ')}${missing.at(-1) === '통장' ? '은' : '는'} 아직 몰라요`}
        </Notice>
      )}

      <Card title="매출" testID="report-sales">
        <Kv>
          <KvRow label={span} value={amountText(v.sales.total)} total testID="report-sales-total" />
          {saleParts.length === 1 && saleParts[0]![2] !== undefined ? (
            <KvRow label={saleParts[0]![0]} value={`${saleParts[0]![2].toLocaleString('ko-KR')}건`} />
          ) : (
            saleParts.map(([label, l, n]) => <KvRow key={label} label={n === undefined ? label : `${label} ${n.toLocaleString('ko-KR')}건`} value={won(l.amount)} />)
          )}
          {v.prev && change(v.sales.total, v.prev.sales) && <KvRow label={prevLabel(months)} value={change(v.sales.total, v.prev.sales)!} />}
        </Kv>
      </Card>
      {hasPurchase && (
        <Card title="매입" testID="report-purchase">
          <Kv>
            <KvRow label={span} value={amountText(v.purchase.total)} total testID="report-purchase-total" />
            {knownParts([
              ['세금계산서', v.purchase.inv],
              ['사업용 카드', v.purchase.card],
              ['현금영수증', v.purchase.cr],
              ['영수증', v.purchase.rcpt],
              ['급여', v.purchase.pay],
            ]).map(([label, l]) => (
              <KvRow key={label} label={label} value={won(l.amount)} />
            ))}
            {v.prev && change(v.purchase.total, v.prev.purchase) && <KvRow label={prevLabel(months)} value={change(v.purchase.total, v.prev.purchase)!} />}
          </Kv>
        </Card>
      )}
      {v.recv && (
        <Card title="받을 돈" testID="report-receivable">
          <Kv>
            <KvRow label="남은 돈" value={won(v.recv.left)} total />
            <KvRow label="받은 돈" value={won(v.recv.got)} />
            {v.recv.lateN > 0 && <KvRow label="기한 지남" value={`${v.recv.lateN.toLocaleString('ko-KR')}건 ${won(v.recv.lateA)}`} warn />}
          </Kv>
          <Actions>
            <Button kind="secondary" label="받을 돈 보기" onPress={onMoney} testID="report-receivable-money" />
          </Actions>
        </Card>
      )}
      {v.vat && (
        <Card title={`부가세 ${v.vat.h}기`} testID="report-vat">
          <Kv>
            <KvRow label="매출 부가세" value={v.vat.s === null ? '확인 못 함' : won(v.vat.s)} warn={v.vat.s === null} />
            {vatDue === null && <KvRow label={`${monthNo(v.vat.from)}월부터 ${monthNo(v.vat.to)}월`} value={`${v.vat.sn.toLocaleString('ko-KR')}건`} />}
            {v.vat.p !== null && <KvRow label="매입 세금계산서 부가세" value={won(v.vat.p)} />}
            {vatDue !== null && <KvRow label="세금계산서 기준 낼 부가세" value={won(vatDue)} total />}
            <KvRow label="신고 기한" value={`${monthNo(v.vat.dl)}월 ${Number(v.vat.dl.slice(8, 10))}일`} />
          </Kv>
        </Card>
      )}

      <Card title={chartPurchase ? '달마다' : '달마다 매출'} testID="report-monthly">
        {chartPurchase && <Legend a="매출" b="매입" />}
        <BarChart
          cols={v.chart.map((c) => barOf(c, chartPurchase))}
          label={`${v.chart[0]!.label}부터 ${v.chart.at(-1)!.label}까지 달마다 매출${chartPurchase ? '과 매입' : ''}`}
          onPick={(m) => setPicked(m)}
          step={{ prev: v.first ? null : () => setPicked(shiftMonth(month, -1)), next: v.latest ? null : () => setPicked(shiftMonth(month, 1)) }}
          holding={preview?.hold ?? null}
          tip={(m) => {
            const c = v.chart.find((x) => x.month === m)!;
            return <Tip rows={[{ k: '매출', v: amountText(c.sales.total) }, ...(chartPurchase ? [{ k: '매입', v: amountText(c.purchase.total) }] : [])]} testID="report-tip" />;
          }}
        />
      </Card>

      {v.ranks && (
        <>
          <Card title={rankPurchase ? '거래처' : '많이 판 거래처'} testID="report-partners">
            {rankPurchase && <Seg options={SIDES} value={partnerSide} onChange={setPartnerSide} fill tint testID="report-partners-side" />}
            <RankCard rank={rankPurchase && partnerSide === 'purchase' ? v.ranks.pp : v.ranks.ps} kind="partners" empty="이 기간 거래처가 없어요" onRow={(row) => setOpen({ kind: 'partner', side: partnerSide, row })} onAll={() => setOpen({ kind: 'all', what: 'partners', side: partnerSide })} />
          </Card>
          <Card title={rankPurchase ? '품목' : '많이 판 품목'} testID="report-items">
            {rankPurchase && <Seg options={SIDES} value={itemSide} onChange={setItemSide} fill tint testID="report-items-side" />}
            <RankCard rank={rankPurchase && itemSide === 'purchase' ? v.ranks.ip : v.ranks.is} kind="items" empty="이 기간 품목이 없어요" onAll={() => setOpen({ kind: 'all', what: 'items', side: itemSide })} />
          </Card>
        </>
      )}

      {v.bank && (
        <Card title="통장" testID="report-bank">
          <Kv>
            <KvRow label="들어온 돈" value={won(v.bank.in)} />
            <KvRow label="나간 돈" value={won(v.bank.out)} />
            <KvRow label="잔액" value={amountText(v.balanceTotal)} total warn={unsure(v.balanceTotal)} />
          </Kv>
        </Card>
      )}

      {open?.kind === 'partner' && <PartnerSheet copy={copy} span={span} side={open.side} row={open.row} onClose={() => setOpen(null)} onMoney={() => (setOpen(null), onMoney())} />}
      {open?.kind === 'all' && v.ranks && (
        <AllSheet
          span={span}
          what={open.what}
          side={open.side}
          rank={open.what === 'partners' ? (open.side === 'sale' ? v.ranks.ps : v.ranks.pp) : open.side === 'sale' ? v.ranks.is : v.ranks.ip}
          onClose={() => setOpen(null)}
          onRow={open.what === 'partners' ? (row) => setOpen({ kind: 'partner', side: open.side, row }) : undefined}
        />
      )}
    </Screen>
  );
}

function barOf(c: ChartCol, purchase: boolean): BarCol {
  return {
    key: c.month,
    label: c.label,
    a: c.sales.total.amount,
    b: purchase ? c.purchase.total.amount : null,
    on: c.on,
    out: !c.inWindow,
    a11y: `${monthNo(c.month)}월 매출 ${amountText(c.sales.total)}${purchase ? `, 매입 ${amountText(c.purchase.total)}` : ''}${c.on ? '' : ', 이 달 보기'}`,
  };
}

const known = (l: Line) => l.amount !== null;
type Part = [label: string, line: Line, count?: number];
const knownParts = (parts: Part[]): Part[] => parts.filter(([, l], i) => known(l) && (i === 0 || l.amount !== 0));
const prevLabel = (months: Months) => (months === 1 ? '지난달보다' : months === 12 ? '지난해보다' : `앞 ${months}개월보다`);
const change = (cur: Line, prev: Line): string | null => {
  if (cur.amount === null || !prev.amount) return null;
  const diff = cur.amount - prev.amount;
  return diff === 0 ? '같아요' : `${won(Math.abs(diff))} ${diff > 0 ? '늘었어요' : '줄었어요'}`;
};

const itemOf = (x: RankRow, i: number, kind: 'partners' | 'items', onRow?: (row: RankRow) => void): RankItem =>
  kind === 'partners'
    ? { key: String(i), name: x.name, amount: won(x.amount), pct: pctText(x.share), share: x.share, onPress: onRow ? () => onRow(x) : undefined }
    : { key: String(i), name: x.name, count: `${x.n.toLocaleString('ko-KR')}건`, amount: won(x.amount), share: x.share };
const restOf = (x: RankRow, kind: 'partners' | 'items'): RankItem =>
  kind === 'partners' ? { key: 'rest', name: x.name, amount: won(x.amount), pct: pctText(x.share), share: x.share, rest: true } : { key: 'rest', name: x.name, count: `${x.n.toLocaleString('ko-KR')}건`, amount: won(x.amount), share: x.share, rest: true };

function RankCard({ rank, kind, empty, onRow, onAll }: { rank: Rank; kind: 'partners' | 'items'; empty: string; onRow?: (row: RankRow) => void; onAll: () => void }) {
  const top = topOf(rank, 5, kind === 'partners' ? '곳' : '개');
  if (!top.rows.length) {
    return (
      <T v="sub" c="ink2">
        {empty}
      </T>
    );
  }
  return (
    <>
      <RankRows rows={[...top.rows.map((x, i) => itemOf(x, i, kind, onRow)), ...(top.rest ? [restOf(top.rest, kind)] : [])]} testID={`report-${kind}-rows`} />
      {top.more && (
        <Actions>
          <Button kind="secondary" label="전체 보기" onPress={onAll} testID={`report-${kind}-all`} />
        </Actions>
      )}
    </>
  );
}

/** 거래처 시트(기준판 Phone-Report-Partner): 고른 기간 금액, 남은 받을 돈(낼 돈), 받기까지 평균 날수, 달마다 여섯 달 */
function PartnerSheet({ copy, span, side, row, onClose, onMoney }: { copy: CopyReport; span: string; side: Side; row: RankRow; onClose: () => void; onMoney: () => void }) {
  const sale = side === 'sale';
  const what = sale ? '매출' : '매입';
  const owed = sale ? '받을 돈' : '낼 돈';
  const left = row.left ?? 0;
  return (
    <Sheet
      title={row.name}
      height="fit"
      onClose={onClose}
      testID="report-partner"
      footer={left > 0 ? <Button label={`${owed} 보기`} onPress={onMoney} testID="report-partner-money" /> : undefined}
    >
      <Kv>
        <KvRow label={`${span} ${what}`} value={won(row.amount)} />
        {row.left !== undefined && <KvRow label={owed} value={won(row.left)} />}
        {!!row.late && <KvRow label="기한 지남" value={won(row.late)} warn />}
        {row.pm && row.pm.d !== null && <KvRow label={sale ? '받기까지' : '내기까지'} value={`평균 ${row.pm.d}일`} />}
      </Kv>
      {row.pm && (
        <Group title={`달마다 ${what}`}>
          {partnerMonths(copy, row.pm).map((m) => (
            <Row key={m.label} label={m.label} value={won(m.amount)} />
          ))}
        </Group>
      )}
    </Sheet>
  );
}

/** 전체 보기 시트: 사본에 실린 위 10줄과 그 밖 묶음. 거래처 줄을 누르면 그 거래처 시트로 */
function AllSheet({ span, what, side, rank, onClose, onRow }: { span: string; what: 'partners' | 'items'; side: Side; rank: Rank; onClose: () => void; onRow?: (row: RankRow) => void }) {
  const unit = what === 'partners' ? '곳' : '개';
  const rows = [...rank.rows.map((x, i) => itemOf(x, i, what, onRow)), ...(rank.rest ? [restOf({ ...rank.rest, name: `그 밖에 ${rank.rest.k}${unit}` }, what)] : [])];
  return (
    <Sheet title={`${span} ${side === 'sale' ? '매출' : '매입'} ${what === 'partners' ? '거래처' : '품목'}`} height="fit" onClose={onClose} testID="report-all">
      <ScrollView contentContainerStyle={{ paddingBottom: space.s2 }} showsVerticalScrollIndicator={false}>
        <View>
          <RankRows rows={rows} testID="report-all-rows" />
        </View>
      </ScrollView>
    </Sheet>
  );
}
