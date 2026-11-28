import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CopyReport } from '@sax/remote';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { Card, Kv, KvRow } from '../ui/card';
import { bigWon, Button, Empty, Group, Notice, Row, Screen, Seg, T, TextButton } from '../ui/kit';
import { BarChart, InfoMark, Legend, MonthStep, RankRows, Ring, Spark, Stack, Tip, type BarCol, type RankItem } from '../ui/report';
import { Sheet } from '../ui/sheet';
import { averageOf, clampMonth, ddayText, headlineText, partnerMonths, prevName, shortWon, trendText, whyOf, reportView, reportWait, shiftMonth, spanText, topOf, WINDOWS, type ChartCol, type Line, type Months, type Rank, type RankRow, type ReportWait } from '../report';
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
const won = bigWon;
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

export function ReportScreen({ go, onMoney, onAsk, preview }: { go: (to: HomeRoute) => void; onMoney: () => void; onAsk?: (text: string) => void; preview?: ReportPreview }) {
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
  return <Report copy={copy} copyAt={s.data.pcCopy?.asOf ?? null} onMoney={onMoney} onAsk={onAsk} preview={preview} />;
}

function Report({ copy, copyAt, onMoney, onAsk, preview }: { copy: CopyReport; copyAt: number | null; onMoney: () => void; onAsk?: (text: string) => void; preview?: ReportPreview }) {
  const p = usePalette();
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
  const [compare, setCompare] = useState(false);
  const [vatInfo, setVatInfo] = useState(false);
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
  const lyOk = v.chart.some((c) => !!c.lastYear?.amount);
  const showLy = compare && lyOk;
  const headline = headlineText(v, showLy);
  const why = whyOf(v);
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
      {copyAt !== null && (
        <T v="meta" c="ink3" style={{ textAlign: 'right' }} testID="report-updated">
          {`${updatedText(copyAt)} 기준`}
        </T>
      )}
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

      <TotalCard title="매출" testID="report-sales" total={v.sales.total} prev={v.prev?.sales} comparable={v.prev?.comparable.sales} months={months} days={v.days} values={v.chart.map((c) => c.sales.total.amount)} color={p.dataSale} />
      <TotalCard title="매입" testID="report-purchase" total={v.purchase.total} prev={v.prev?.purchase} comparable={v.prev?.comparable.purchase} months={months} days={v.days} values={v.chart.map((c) => c.purchase.total.amount)} color={p.dataBuy} />
      {v.vat && (
        <Card
          title={`부가세 ${v.vat.h}기`}
          testID="report-vat"
          side={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`부가세 ${v.vat.h}기가 뭔지 보기`} accessibilityState={{ expanded: vatInfo }} onPress={() => setVatInfo((x) => !x)} hitSlop={8} testID="report-vat-info">
                <InfoMark color={p.ink3} />
              </Pressable>
              <T v="sub" c="ink2">{`${monthNo(v.vat.dl)}월 ${Number(v.vat.dl.slice(8, 10))}일`}</T>
              {ddayText(copy.today, v.vat.dl) && (
                <View style={{ paddingHorizontal: 8, borderRadius: 999, backgroundColor: ddayLeft(copy.today, v.vat.dl) <= 14 ? p.attentionSoft : p.sunken }}>
                  <T v="label" c={ddayLeft(copy.today, v.vat.dl) <= 14 ? 'attention' : 'ink'}>{ddayText(copy.today, v.vat.dl).trim()}</T>
                </View>
              )}
            </View>
          }
        >
          {vatInfo && <T v="sub" c="ink2" testID="report-vat-period">{`${v.vat.h === 1 ? '1월부터 6월' : '7월부터 12월'} 매출과 매입, ${monthNo(v.vat.dl)}월 ${Number(v.vat.dl.slice(8, 10))}일 신고`}</T>}
          <T v="strong">{vatDue !== null ? `${won(vatDue)} 낼 것 같아요` : v.vat.s !== null ? `매출 부가세 ${won(v.vat.s)}` : '확인 못 함'}</T>
          {vatDue !== null && v.vat.s ? <Stack parts={[{ share: Math.max(0, vatDue) / v.vat.s, color: p.dataSale }, { share: 1 - Math.max(0, vatDue) / v.vat.s, color: p.sunken }]} /> : null}
          <Kv>
            <KvRow label="매출 부가세" value={v.vat.s === null ? '확인 못 함' : won(v.vat.s)} warn={v.vat.s === null} />
            <KvRow label="매입 부가세" value={v.vat.p === null ? '확인 못 함' : won(v.vat.p)} warn={v.vat.p === null} />
          </Kv>
        </Card>
      )}
      <Card title={chartPurchase ? '달마다' : '달마다 매출'} testID="report-monthly">
        {headline && <T v="strong" testID="report-headline">{headline}</T>}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {chartPurchase ? <Legend a="매출" b="매입" /> : <View />}
          {lyOk && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: showLy }}
              onPress={() => setCompare((x) => !x)}
              testID="report-compare"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: showLy ? p.ink : p.sunken }}
            >
              <View style={{ width: 12, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: showLy ? p.onInk : p.ink2 }} />
              <T v="label" c={showLy ? 'onInk' : 'ink'}>작년과 비교</T>
            </Pressable>
          )}
        </View>
        <BarChart
          line={showLy ? v.chart.map((c) => c.lastYear?.amount ?? null) : undefined}
          cols={v.chart.map((c) => barOf(c, chartPurchase, v.chart.length <= 6))}
          tick={(n) => shortWon(n).replace(/원$/, '')}
          label={`${v.chart[0]!.label}부터 ${v.chart.at(-1)!.label}까지 달마다 매출${chartPurchase ? '과 매입' : ''}`}
          onPick={(m) => setPicked(m)}
          step={{ prev: v.first ? null : () => setPicked(shiftMonth(month, -1)), next: v.latest ? null : () => setPicked(shiftMonth(month, 1)) }}
          holding={preview?.hold ?? null}
          tip={(m) => {
            const c = v.chart.find((x) => x.month === m)!;
            return <Tip rows={[{ k: '매출', v: amountText(c.sales.total) }, ...(chartPurchase ? [{ k: '매입', v: amountText(c.purchase.total) }] : []), ...(showLy && c.lastYear ? [{ k: '작년', v: amountText(c.lastYear) }] : [])]} testID="report-tip" />;
          }}
        />
        <MonthTable cols={v.chart} purchase={chartPurchase} ly={showLy} />
      </Card>

      {why && (
        <Card title={why.title} testID="report-why">
          <Kv>
            {why.rows.map((x) => (
              <KvRow key={x.label} label={x.label} value={`${x.delta > 0 ? '+' : '−'}${shortWon(Math.abs(x.delta))}`} />
            ))}
          </Kv>
          {onAsk && <Button kind="secondary" label="대화에서 더 묻기" onPress={() => onAsk(`${span} 매출이 ${prevName(months)}보다 왜 ${why.up ? '늘었는지' : '줄었는지'} 알려줘`)} testID="report-why-ask" />}
        </Card>
      )}

      <MixCard title="매출은 어디서" testID="report-sales-mix" colors={[p.dataSale, p.dataSaleMuted, p.dataSaleSoft, p.dataSaleSoft]} parts={saleParts} />
      {hasPurchase && (
        <MixCard
          title="매입은 어디로"
          testID="report-purchase-mix"
          colors={[p.dataBuy, p.dataBuyMuted, p.dataBuySoft, p.dataBuySoft, p.dataBuySoft]}
          parts={knownParts([
            ['세금계산서', v.purchase.inv],
            ['사업용 카드', v.purchase.card],
            ['현금영수증', v.purchase.cr],
            ['영수증', v.purchase.rcpt],
            ['급여', v.purchase.pay],
          ])}
        />
      )}

      {v.ranks && (
        <>
          <Card title={rankPurchase ? '거래처' : '많이 판 거래처'} testID="report-partners">
            {rankPurchase && <Seg options={SIDES} value={partnerSide} onChange={setPartnerSide} fill tint testID="report-partners-side" />}
            <RankCard buy={rankPurchase && partnerSide === 'purchase'} rank={rankPurchase && partnerSide === 'purchase' ? v.ranks.pp : v.ranks.ps} kind="partners" empty="이 기간 거래처가 없어요" onRow={(row) => setOpen({ kind: 'partner', side: partnerSide, row })} onAll={() => setOpen({ kind: 'all', what: 'partners', side: partnerSide })} />
          </Card>
          <Card title={rankPurchase ? '품목' : '많이 판 품목'} testID="report-items">
            {rankPurchase && <Seg options={SIDES} value={itemSide} onChange={setItemSide} fill tint testID="report-items-side" />}
            <RankCard buy={rankPurchase && itemSide === 'purchase'} rank={rankPurchase && itemSide === 'purchase' ? v.ranks.ip : v.ranks.is} kind="items" empty="이 기간 품목이 없어요" onAll={() => setOpen({ kind: 'all', what: 'items', side: itemSide })} />
          </Card>
        </>
      )}

      {v.recv && (
        <Card title="받을 돈" testID="report-receivable">
          <Stack parts={[{ share: v.recv.got, color: p.dataSale }, { share: v.recv.left - v.recv.lateA, color: p.dataSaleMuted }, { share: v.recv.lateA, color: p.attention }]} />
          <Kv>
            <KvRow label="받은 돈" value={won(v.recv.got)} />
            <KvRow label="기다리는 돈" value={won(v.recv.left - v.recv.lateA)} />
            {v.recv.lateN > 0 && <KvRow label={`기한 지남 ${v.recv.lateN.toLocaleString('ko-KR')}건`} value={won(v.recv.lateA)} warn />}
          </Kv>
          <TextButton label="받을 돈 보기" onPress={onMoney} testID="report-receivable-money" />
        </Card>
      )}
      {v.bank && (
        <Card title="통장" testID="report-bank">
          <T v="sub">{`들어온 돈 ${won(v.bank.in)}`}</T>
          <Stack parts={[{ share: 1, color: p.dataSale }]} width={v.bank.in / Math.max(1, v.bank.in, v.bank.out)} />
          <T v="sub">{`나간 돈 ${won(v.bank.out)}`}</T>
          <Stack parts={[{ share: 1, color: p.dataBuy }]} width={v.bank.out / Math.max(1, v.bank.in, v.bank.out)} />
          <Kv>
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

function barOf(c: ChartCol, purchase: boolean, roomy: boolean): BarCol {
  const sale = c.sales.total.amount;
  return {
    ...(sale && (c.on || roomy) ? { value: shortWon(sale) } : {}),
    key: c.month,
    label: c.label,
    a: c.sales.total.amount,
    b: purchase ? c.purchase.total.amount : null,
    on: c.on,
    out: !c.inWindow,
    busy: c.on ? { a: c.sales.total.partial || c.sales.total.amount === null, b: purchase && (c.purchase.total.partial || c.purchase.total.amount === null) } : undefined,
    a11y: `${monthNo(c.month)}월 매출 ${amountText(c.sales.total)}${purchase ? `, 매입 ${amountText(c.purchase.total)}` : ''}${c.on ? '' : ', 이 달 보기'}`,
  };
}

const known = (l: Line) => l.amount !== null;

/** 요약 카드(PC totalCard): 합계, 비교 글, 앞 기간 합계와 평균. 꺾은선은 제목 줄 */
function TotalCard({ title, total, prev, comparable, months, days, values, color, testID }: {
  title: string; total: Line; prev: Line | undefined; comparable: boolean | undefined; months: Months; days: number; values: Array<number | null>; color: string; testID: string;
}) {
  const t = trendText(total, prev, months, comparable);
  const avg = averageOf(total, months, days);
  return (
    <Card title={title} testID={testID} side={<Spark values={values} color={color} />}>
      <View style={{ gap: 2 }}>
        <T v="figure" testID={`${testID}-total`}>{amountText(total)}</T>
        {t && <T v="sub" c="ink2">{t}</T>}
      </View>
      <Kv>
        {prev && <KvRow label={prevName(months)} value={comparable === false ? '일부만 받았어요' : amountText(prev)} warn={comparable === false || prev.amount === null} />}
        <KvRow label={avg.label} value={avg.amount === null ? '확인 못 함' : won(avg.amount)} warn={avg.amount === null} />
      </Kv>
    </Card>
  );
}
type Part = [label: string, line: Line, count?: number];
const knownParts = (parts: Part[]): Part[] => parts.filter(([, l], i) => known(l) && (i === 0 || l.amount !== 0));
const updatedText = (at: number) => {
  const t = new Date(at);
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return t.toDateString() === new Date().toDateString() ? `오늘 ${hm}` : `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm}`;
};
const ddayLeft = (today: string, day: string) => Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);

/** 달마다 표(PC rp-table): 막대와 같은 칸, 색 칸이 줄 이름 */
function MonthTable({ cols, purchase, ly }: { cols: ChartCol[]; purchase: boolean; ly: boolean }) {
  const p = usePalette();
  const cell = (n: number | null) => (n === null ? '-' : shortWon(n).replace(/만원$/, '').replace(/원$/, ''));
  const unit = cols.every((c) => (c.sales.total.amount ?? 0) < 1e8 && (c.purchase.total.amount ?? 0) < 1e8) ? '만원' : null;
  const fmt = (n: number | null) => (n === null ? '-' : unit ? cell(n) : shortWon(n).replace(/원$/, ''));
  const row = (key: string, sw: ReactNode, label: string, vals: Array<number | null>) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.line }}>
      <View style={{ width: 56, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {sw}
        <T v="meta" c="ink2">{label}</T>
      </View>
      {vals.map((n, i) => (
        <T key={i} v="meta" c={cols[i]!.on ? 'ink' : 'ink2'} lines={1} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: cols[i]!.on ? '600' : '400' }}>
          {fmt(n)}
        </T>
      ))}
    </View>
  );
  const dot = (color: string) => <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />;
  return (
    <View testID="report-table">
      {unit && <T v="meta" c="ink3" style={{ textAlign: 'right', fontSize: 11 }}>{`단위 ${unit}`}</T>}
      {row('s', dot(p.dataSale), '매출', cols.map((c) => c.sales.total.amount))}
      {purchase && row('b', dot(p.dataBuy), '매입', cols.map((c) => c.purchase.total.amount))}
      {ly && row('l', <View style={{ width: 8, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: p.ink3 }} />, '작년', cols.map((c) => c.lastYear?.amount ?? null))}
    </View>
  );
}

function MixCard({ title, parts, colors, testID }: { title: string; parts: Part[]; colors: string[]; testID: string }) {
  const p = usePalette();
  const sum = parts.reduce((a, [, l]) => a + Math.max(0, l.amount ?? 0), 0);
  if (!parts.length) return null;
  const color = (i: number) => colors[i] ?? colors.at(-1)!;
  return (
    <Card title={title} testID={testID} side={<Ring parts={parts.map(([, l], i) => ({ share: Math.max(0, l.amount ?? 0), color: color(i) }))} track={p.sunken} sizePx={44} />}>
      <View style={{ gap: space.s2 }}>
        {parts.map(([label, l, n], i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color(i) }} />
            <T v="sub" c="ink2" lines={1} style={{ flex: 1, minWidth: 0 }}>
              {`${n === undefined ? label : `${label} ${n.toLocaleString('ko-KR')}건`}${sum ? ` ${Math.round((Math.max(0, l.amount ?? 0) / sum) * 100)}%` : ''}`}
            </T>
            <T v="subValue">{won(l.amount)}</T>
          </View>
        ))}
      </View>
    </Card>
  );
}

const itemOf = (x: RankRow, i: number, kind: 'partners' | 'items', onRow?: (row: RankRow) => void): RankItem =>
  kind === 'partners'
    ? { key: String(i), name: x.name, amount: won(x.amount), pct: pctText(x.share), share: x.share, onPress: onRow ? () => onRow(x) : undefined }
    : { key: String(i), name: x.name, count: `${x.n.toLocaleString('ko-KR')}건`, amount: won(x.amount), share: x.share };
const restOf = (x: RankRow, kind: 'partners' | 'items'): RankItem =>
  kind === 'partners' ? { key: 'rest', name: x.name, amount: won(x.amount), pct: pctText(x.share), share: x.share, rest: true } : { key: 'rest', name: x.name, count: `${x.n.toLocaleString('ko-KR')}건`, amount: won(x.amount), share: x.share, rest: true };

function RankCard({ rank, kind, empty, onRow, onAll, buy }: { rank: Rank; kind: 'partners' | 'items'; empty: string; onRow?: (row: RankRow) => void; onAll: () => void; buy?: boolean }) {
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
      <RankRows rows={[...top.rows.map((x, i) => itemOf(x, i, kind, onRow)), ...(top.rest ? [restOf(top.rest, kind)] : [])]} testID={`report-${kind}-rows`} buy={buy} />
      {top.more && <TextButton label="전체 보기" onPress={onAll} testID={`report-${kind}-all`} />}
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
