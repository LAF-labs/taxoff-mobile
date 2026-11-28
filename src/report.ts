import type { CopyBankCats, CopyLine, CopyRank, CopyReport, CopyReportMonth, ReportDoc, ReportDocPartners, ReportDocRank } from '@sax/remote';
import type { PcStatus } from './net/pc';
import type { CachedPhoneCopy } from './net/pcCopy';

/**
 * 폰 월 리포트(tex ADR-068 결정 8): PC가 계산해 보낸 사본(phone.copy.report)만으로 고른 달과 기간의 값을 만든다.
 * 계산 규칙은 PC 엔진(engine/src/bank/report.ts monthLines)과 같다. 모르는 값은 0으로 세지 않는다(null = 확인 못 함).
 * 순위(거래처, 품목)는 사본의 마지막 달에서 끝나는 기간 넷만 있다. 앞 달로 넘기면 순위는 null이다.
 */

export type Months = 1 | 3 | 6 | 12;
export const WINDOWS: ReadonlyArray<{ key: Months; label: string }> = [
  { key: 1, label: '1개월' },
  { key: 3, label: '3개월' },
  { key: 6, label: '6개월' },
  { key: 12, label: '1년' },
];

/** 묶음 한 칸. amount null = 기간 안에 받은 자료가 없다, partial = 기간 일부만 받았다 */
export interface Line {
  amount: number | null;
  partial: boolean;
}

export const OUT_CATS = [
  ['payable', '매입 결제'],
  ['payroll', '급여'],
  ['card_payment', '카드대금'],
  ['tax', '세금과 4대보험'],
  ['other', '기타'],
] as const;
export const IN_CATS = [
  ['receivable', '받을 돈'],
  ['card_sales', '카드 매출 입금'],
  ['interest', '이자'],
  ['other', '기타'],
] as const;

export interface ReportSales {
  inv: Line;
  cr: Line;
  card: Line;
  cash: Line;
  total: Line;
}
export interface ReportPurchase {
  inv: Line;
  card: Line;
  cr: Line;
  rcpt: Line;
  pay: Line;
  total: Line;
}
export interface ReportBank {
  in: number;
  out: number;
  net: number;
}
export interface ChartCol {
  month: string;
  /** 6칸이면 "11월", 12칸이면 "11" */
  label: string;
  /** 고른 달 */
  on: boolean;
  /** 고른 기간 안 */
  inWindow: boolean;
  sales: ReportSales;
  purchase: ReportPurchase;
  bank: ReportBank | null;
}
export interface RankRow {
  name: string;
  /** 건수 */
  n: number;
  amount: number;
  /** 0~1 */
  share: number;
  /** 거래처 줄만: 남은 받을 돈(낼 돈), 그 가운데 기한 지난 것, 사본 report.pm의 칸 */
  left?: number;
  late?: number;
  pm?: { m: number[]; d: number | null };
}
export interface Rank {
  rows: RankRow[];
  /** 위 10줄 밖을 묶은 줄. k = 묶인 거래처나 품목 수 */
  rest: (RankRow & { k: number }) | null;
  total: number;
}
export interface ReportView {
  month: string;
  months: Months;
  /** 사본의 마지막 달 */
  latest: boolean;
  /** 더 앞 달로 갈 수 없다(사본 12달 안에서 막대 칸을 다 채울 수 있는 데까지) */
  first: boolean;
  sales: ReportSales;
  purchase: ReportPurchase;
  /** 계좌를 하나도 잇지 않았으면 null */
  bank: ReportBank | null;
  bankOut: Array<{ key: string; label: string; amount: number }>;
  bankIn: Array<{ key: string; label: string; amount: number }>;
  chart: ChartCol[];
  /** 마지막 달이 아니면 null(사본에 없다) */
  ranks: { ps: Rank; pp: Rank; is: Rank; ip: Rank } | null;
  balances: Array<{ label: string; amount: number | null; day: string | null }>;
  balanceTotal: Line;
  /** 바로 앞 같은 길이 기간의 합계. 사본에 그 달들이 없으면 null */
  prev: { sales: Line; purchase: Line; comparable: { sales: boolean; purchase: boolean } } | null;
  /** 고른 기간의 날 수(오늘까지). 1개월 하루 평균 */
  days: number;
  /** 마지막 달만(사본에 있다) */
  recv: { got: number; left: number; lateN: number; lateA: number } | null;
  vat: NonNullable<CopyReport['vat']> | null;
}

export const shiftMonth = (month: string, d: number): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthNo = (m: string) => Number(m.slice(5, 7));
/** 막대 칸 수: PC 엔진과 같이 max(6, 기간) */
export const spanOf = (months: Months) => Math.max(6, months);

const lineOf = (l: CopyLine): Line => ({ amount: l.a, partial: l.p });
const line = (ls: CopyLine[]): Line => {
  const known = ls.filter((l) => l.a !== null);
  return { amount: known.length ? known.reduce((s, l) => s + l.a!, 0) : null, partial: known.length > 0 && (known.length < ls.length || known.some((l) => l.p)) };
};
/** 현금매출과 급여는 사장님이 넣은 달만 있다. 넣지 않은 달은 없음이지만 묶음 합계를 확인 못 함으로 만들지 않는다 */
const optional = (ls: CopyLine[]): Line => {
  const known = ls.filter((l) => l.a !== null);
  return { amount: known.length ? known.reduce((s, l) => s + l.a!, 0) : null, partial: false };
};
const totalOf = (all: Line[], strict: Line[]): Line => ({ amount: all.reduce((s, l) => s + (l.amount ?? 0), 0), partial: strict.some((l) => l.amount === null || l.partial) });

function salesOf(ms: CopyReportMonth[]): ReportSales {
  const inv = line(ms.map((m) => m.sales.inv));
  const cr = line(ms.map((m) => m.sales.cr));
  const card = line(ms.map((m) => m.sales.card));
  const cash = optional(ms.map((m) => m.sales.cash));
  return { inv, cr, card, cash, total: totalOf([inv, cr, card, cash], [inv, cr, card]) };
}
function purchaseOf(ms: CopyReportMonth[]): ReportPurchase {
  const inv = line(ms.map((m) => m.purchase.inv));
  const card = line(ms.map((m) => m.purchase.card));
  const cr = line(ms.map((m) => m.purchase.cr));
  const rcpt = line(ms.map((m) => m.purchase.rcpt));
  const pay = optional(ms.map((m) => m.purchase.pay));
  return { inv, card, cr, rcpt, pay, total: totalOf([inv, card, cr, rcpt, pay], [inv, card, cr]) };
}
function bankOf(ms: CopyReportMonth[]): ReportBank | null {
  if (!ms.some((m) => m.bank)) return null;
  const i = ms.reduce((s, m) => s + (m.bank?.in ?? 0), 0);
  const o = ms.reduce((s, m) => s + (m.bank?.out ?? 0), 0);
  return { in: i, out: o, net: i - o };
}
function catsOf(ms: CopyReportMonth[], side: 'bin' | 'bout', order: ReadonlyArray<readonly [string, string]>) {
  const sum = (k: string) => ms.reduce((s, m) => s + ((m.bank?.[side] as CopyBankCats | undefined)?.[k as keyof CopyBankCats] ?? 0), 0);
  return order.map(([key, label]) => ({ key, label, amount: sum(key) })).filter((x) => x.amount > 0);
}

function rankOf(r: CopyRank, pm: CopyReport['pm'], unnamed: string): Rank {
  const rows = r.rows.map((x): RankRow => {
    const row: RankRow = { name: x.name ?? unnamed, n: x.n, amount: x.a, share: x.pct / 100 };
    if (x.left !== undefined) row.left = x.left;
    if (x.late) row.late = x.late;
    const p = x.i !== undefined ? pm?.[x.i] : undefined;
    if (p) row.pm = p;
    return row;
  });
  return { rows, rest: r.rest ? { name: '', n: r.rest.n, amount: r.rest.a, share: r.rest.pct / 100, k: r.rest.k } : null, total: r.total };
}

/** 자료 종류마다 받은 달 수(PC report.ts coverage와 같다). 앞 기간이 지금보다 적게 받았으면 늘고 줄었다고 말하지 않는다 */
function coverage(ms: CopyReportMonth[]): { sales: number[]; purchase: number[] } {
  const n = (f: (m: CopyReportMonth) => CopyLine) => ms.filter((m) => f(m).a !== null).length;
  return { sales: [n((m) => m.sales.inv), n((m) => m.sales.cr), n((m) => m.sales.card)], purchase: [n((m) => m.purchase.inv), n((m) => m.purchase.card), n((m) => m.purchase.cr)] };
}
const covers = (prev: number[], cur: number[]) => cur.every((c, i) => prev[i]! >= c);
/** 기간의 날 수. 이번 달은 오늘까지 */
function daysIn(months: string[], today: string): number {
  return months.reduce((s, m) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    const end = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return s + (m === today.slice(0, 7) ? Number(today.slice(8, 10)) : end);
  }, 0);
}

/** 고를 수 있는 달: 사본 12달 안에서 고른 기간의 막대 칸을 다 채울 수 있는 달 */
export function monthsFor(copy: CopyReport, months: Months): string[] {
  const all = copy.months.map((m) => m.month);
  return all.slice(Math.min(all.length - 1, spanOf(months) - 1));
}

/** 고른 기간에 맞는 달: 그 기간으로 고를 수 없는 달이면 가장 가까운 달로 */
export function clampMonth(copy: CopyReport, month: string, months: Months): string {
  const ok = monthsFor(copy, months);
  if (ok.includes(month)) return month;
  return month < ok[0]! ? ok[0]! : ok.at(-1)!;
}

export function reportView(copy: CopyReport, month: string, months: Months): ReportView {
  const at = new Map(copy.months.map((m) => [m.month, m] as const));
  const span = spanOf(months);
  const cols = Array.from({ length: span }, (_, i) => shiftMonth(month, i - span + 1));
  const inWin = new Set(cols.slice(span - months));
  const win = cols.filter((m) => inWin.has(m)).map((m) => at.get(m)).filter((m): m is CopyReportMonth => !!m);
  const ok = monthsFor(copy, months);
  const chart = cols.map((m): ChartCol => {
    const row = at.get(m);
    const ms = row ? [row] : [];
    return { month: m, label: span === 12 ? String(monthNo(m)) : `${monthNo(m)}월`, on: m === month, inWindow: inWin.has(m), sales: salesOf(ms), purchase: purchaseOf(ms), bank: bankOf(ms) };
  });
  const latest = month === copy.month;
  const w = latest ? copy.windows.find((x) => x.months === months) : undefined;
  const known = copy.balances.filter((b) => b.a !== null);
  const before = Array.from({ length: months }, (_, i) => at.get(shiftMonth(month, i - 2 * months + 1)));
  const prevRows = before.every((m): m is CopyReportMonth => !!m) ? before : null;
  return {
    month, months, latest, first: month <= ok[0]!,
    sales: salesOf(win), purchase: purchaseOf(win), bank: bankOf(win),
    bankOut: catsOf(win, 'bout', OUT_CATS), bankIn: catsOf(win, 'bin', IN_CATS),
    chart,
    ranks: w ? { ps: rankOf(w.ps, copy.pm, '이름 없음'), pp: rankOf(w.pp, copy.pm, '이름 없음'), is: rankOf(w.is, undefined, '품목 없음'), ip: rankOf(w.ip, undefined, '품목 없음') } : null,
    balances: copy.balances.map((b) => ({ label: `${b.bank} ${b.last4}`, amount: b.a, day: b.d ?? null })),
    balanceTotal: { amount: known.length ? known.reduce((s, b) => s + b.a!, 0) : null, partial: known.length < copy.balances.length },
    prev: prevRows
      ? { sales: salesOf(prevRows).total, purchase: purchaseOf(prevRows).total, comparable: { sales: covers(coverage(prevRows).sales, coverage(win).sales), purchase: covers(coverage(prevRows).purchase, coverage(win).purchase) } }
      : w?.prev
        ? { sales: lineOf(w.prev.s), purchase: lineOf(w.prev.p), comparable: { sales: !w.prev.s.p, purchase: !w.prev.p.p } }
        : null,
    days: daysIn(cols.filter((m) => inWin.has(m)), copy.today),
    recv: w?.recv ?? null,
    vat: latest ? (copy.vat ?? null) : null,
  };
}

/**
 * 카드에 보일 순위: 위 다섯 줄, 그 아래는 "그 밖에" 한 줄로 묶는다(사본의 위 10줄 밖 묶음까지 더해서).
 * 비율은 묶은 금액을 그 기간 합계로 다시 나눈다.
 */
export function topOf(r: Rank, n = 5, unit = '곳'): { rows: RankRow[]; rest: RankRow | null; more: boolean } {
  const rows = r.rows.slice(0, n);
  const folded = r.rows.slice(n);
  const k = folded.length + (r.rest?.k ?? 0);
  if (!k) return { rows, rest: null, more: false };
  const amount = folded.reduce((s, x) => s + x.amount, 0) + (r.rest?.amount ?? 0);
  const count = folded.reduce((s, x) => s + x.n, 0) + (r.rest?.n ?? 0);
  return { rows, rest: { name: `그 밖에 ${k}${unit}`, n: count, amount, share: r.total > 0 ? amount / r.total : 0 }, more: true };
}

/** 기간 글: "11월", "9월부터 11월", 해가 바뀌어도 달만("12월부터 11월") */
/**
 * 리포트가 아직 없을 때 무엇을 말할지. PC가 켜져 있는데 "PC가 켜지면"이라고 하지 않는다(2026-11-26 실기기, PC 0.1.41).
 * off: PC가 꺼졌거나 연결 중이 아님. loading: 켜졌고 이번 연결의 사본을 기다림. pc_old: 사본을 보낸 PC가 리포트를 모름. not_made: PC가 리포트를 만들지 못함(PC 로그 main.phone_copy_report).
 */
export type ReportWait = 'off' | 'loading' | 'pc_old' | 'not_made';
export function reportWait(pc: PcStatus, copy: CachedPhoneCopy | null | undefined): ReportWait {
  if (pc !== 'online') return 'off';
  if (!copy || copy.reportCap === undefined) return 'loading';
  return copy.reportCap ? 'not_made' : 'pc_old';
}

export const spanText = (month: string, months: Months) => (months === 1 ? `${monthNo(month)}월` : `${monthNo(shiftMonth(month, 1 - months))}월부터 ${monthNo(month)}월`);

/** 거래처 시트의 달마다 줄: 사본 마지막 달에서 거꾸로 여섯 달(새 달이 위) */
export function partnerMonths(copy: CopyReport, pm: { m: number[] }, n = 6): Array<{ label: string; amount: number }> {
  return pm.m
    .map((amount, i) => ({ label: `${monthNo(shiftMonth(copy.month, i - pm.m.length + 1))}월`, amount }))
    .slice(-n)
    .reverse();
}

// ── PDF(tex ADR-068 결정 11): PC와 같은 ReportDoc을 사본으로 만든다 ──

const ym = (m: string) => `${m.slice(0, 4)}년 ${monthNo(m)}월`;
const md = (iso: string) => `${monthNo(iso)}월 ${Number(iso.slice(8, 10))}일`;

/** PC report-pdf.ts periodText와 같은 글: "2026년 11월", "2026년 9월부터 11월", "2025년 12월부터 2026년 11월" */
export function periodText(month: string, months: Months): string {
  if (months === 1) return ym(month);
  const first = shiftMonth(month, 1 - months);
  return first.slice(0, 4) === month.slice(0, 4) ? `${ym(first)}부터 ${monthNo(month)}월` : `${ym(first)}부터 ${ym(month)}`;
}
export const reportFileName = (month: string, months: Months) => `택스오프 리포트 ${periodText(month, months)}.pdf`;

const kstText = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const prevLabel = (months: Months) => (months === 1 ? '지난달보다' : months === 12 ? '지난해보다' : `앞 ${months}개월보다`);
export const prevName = (months: Months) => (months === 1 ? '지난달' : months === 12 ? '지난해' : `앞 ${months}개월`);
/** PC shell-report.js trendText와 같은 글 */
export function trendText(cur: Line, prev: Line | undefined, months: Months, comparable?: boolean): string | null {
  if (cur.amount === null || !prev) return null;
  if (prev.amount === null || !prev.amount || comparable === false || (prev.partial && !cur.partial)) return `비교할 ${months === 12 ? '작년' : months === 1 ? '지난달' : '앞 기간'} 자료가 없어요`;
  const pct = Math.round(((cur.amount - prev.amount) / prev.amount) * 100);
  return pct === 0 ? `${prevLabel(months)} 같아요` : `${prevLabel(months)} ${Math.abs(pct)}% ${pct > 0 ? '늘었어요' : '줄었어요'}`;
}
/** 요약 카드 평균: 1개월은 하루 평균, 그 밖은 한 달 평균 */
export function averageOf(total: Line, months: Months, days: number): { label: string; amount: number | null } {
  if (total.amount === null) return { label: '평균', amount: null };
  return months === 1 ? { label: '하루 평균', amount: total.amount / Math.max(1, days) } : { label: '한 달 평균', amount: total.amount / months };
}

export function reportDocOf(copy: CopyReport, v: ReportView, nowMs: number): ReportDoc {
  const L = (label: string, l: Line) => ({ label, amount: l.amount, partial: l.partial });
  const s = v.sales;
  const p = v.purchase;
  const sales = [L('세금계산서', s.inv), L('현금영수증', s.cr), L('카드 매출', s.card), ...(s.cash.amount !== null ? [L('현금 매출', s.cash)] : [])];
  const purchase = [L('세금계산서', p.inv), L('사업용 카드', p.card), L('현금영수증', p.cr), ...(p.rcpt.amount ? [L('영수증', p.rcpt)] : []), ...(p.pay.amount !== null ? [L('급여', p.pay)] : [])];
  const partners = (r: Rank): ReportDocPartners => ({
    rows: r.rows.map((x): ReportDocRank => ({ name: x.name, count: x.n, amount: x.amount, share: x.share })),
    rest: r.rest ? { name: `그 밖에 ${r.rest.k}곳`, count: r.rest.n, amount: r.rest.amount, share: r.rest.share } : null,
    total: r.total,
    count: r.rows.reduce((a, x) => a + x.n, 0) + (r.rest?.n ?? 0),
  });
  const days = v.balances.map((b) => b.day).filter((d): d is string => !!d).sort();
  const bankOn = !!v.bank;
  return {
    bizName: copy.biz?.name ?? '', bizNo: copy.biz?.bizNo ?? null, period: periodText(v.month, v.months), made: kstText(nowMs),
    bankTo: bankOn && copy.bankTo ? `${md(copy.bankTo)}까지` : null,
    hometaxTo: copy.hometaxTo ? `${md(copy.hometaxTo)}까지` : null,
    sales, salesTotal: L('합계', s.total), purchase, purchaseTotal: L('합계', p.total),
    bank: v.bank ?? { in: 0, out: 0, net: 0 },
    months: v.chart.map((c) => ({ label: `${monthNo(c.month)}월`, on: c.inWindow, sales: c.sales.total.amount, purchase: c.purchase.total.amount, in: c.bank?.in ?? 0, out: c.bank?.out ?? 0 })),
    partnersSale: v.ranks ? partners(v.ranks.ps) : null,
    partnersPurchase: v.ranks ? partners(v.ranks.pp) : null,
    itemsSale: v.ranks ? v.ranks.is.rows.map((x) => ({ name: x.name, count: x.n, amount: x.amount })) : null,
    bankOut: v.bankOut.map(({ label, amount }) => ({ label, amount })),
    bankIn: v.bankIn.map(({ label, amount }) => ({ label, amount })),
    balances: v.balances.map(({ label, amount }) => ({ label, amount })),
    balanceDay: days.length ? md(days.at(-1)!) : null,
    salesTrend: trendText(s.total, v.prev?.sales, v.months, v.prev?.comparable.sales),
    purchaseTrend: trendText(p.total, v.prev?.purchase, v.months, v.prev?.comparable.purchase),
    salesRows: summaryRows(s.total, v.prev?.sales, v.prev?.comparable.sales, v),
    purchaseRows: summaryRows(p.total, v.prev?.purchase, v.prev?.comparable.purchase, v),
    vat: v.vat ? { title: `부가세 ${v.vat.h}기`, deadline: `${md(v.vat.dl)}까지`, sale: v.vat.s, purchase: v.vat.p } : null,
    receivable: v.recv ? { received: v.recv.got, waiting: v.recv.left - v.recv.lateA, late: v.recv.lateA, lateCount: v.recv.lateN } : null,
    bankLinked: bankOn,
  };
}

function summaryRows(total: Line, prev: Line | undefined, comparable: boolean | undefined, v: ReportView) {
  const avg = averageOf(total, v.months, v.days);
  return [
    ...(prev ? [comparable === false ? { label: prevName(v.months), amount: null, note: '일부만 받았어요' } : { label: prevName(v.months), amount: prev.amount }] : []),
    avg,
  ];
}
