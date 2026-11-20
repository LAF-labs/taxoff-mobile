
export type ReceivableStatus = 'unpaid' | 'unknown' | 'partial' | 'waiting' | 'received' | 'excluded';
export type AllocMethod = 'account' | 'cash' | 'other_account' | 'offset' | 'other' | 'fee';

export interface ReceivableView {
  id: string;
  counterpartyId: string | null;
  cpName: string | null;
  cpBizNo: string | null;
  item: string | null;
  approvalTail: string | null;
  writtenOn: string;
  total: number;
  received: number;
  remaining: number;
  dueOn: string | null;
  promisedOn: string | null;
  dueIn: number | null;
  overdue: boolean;
  status: ReceivableStatus;
  via: 'auto' | 'manual' | null;
  offAccount: AllocMethod | null;
  sources: Array<'ledger' | 'hometax'>;
  excludedReason: string | null;
}

export interface PayableSummary {
  unpaidCount: number;
  unpaidTotal: number;
  overdueCount: number;
  overdueTotal: number;
  dueSoonCount: number;
  dueSoonTotal: number;
  reviewCount: number;
}

export interface BankSummary {
  today: string;
  latestDay: string | null;
  stale: boolean;
  hasAccounts: boolean;
  unpaidCount: number;
  unpaidTotal: number;
  overdueCount: number;
  overdueTotal: number;
  oldestOverdue: { cpName: string | null; writtenOn: string; daysOver: number } | null;
  reviewCount: number;
  autoCount: number;
  payable: PayableSummary;
}

export interface Money {
  total: number;
  by: Record<string, number>;
}

export interface CashFlowMonth {
  month: string;
  from: string;
  to: string;
  complete: boolean;
  missing: Array<{ accountId: string; last4: string; bank: string; coverTo: string | null }>;
  hasAccounts: boolean;
  cash: { in: Money; out: Money; net: number; excluded: number };
  accrual: { salesInvoices: number; cashSales: number | null; purchaseInvoices: number; card: number | null; receipts: number; payroll: number | null };
  collectionRate: number | null;
  unknown: { inTotal: number; outTotal: number; inCount: number; outCount: number; topIds: string[] };
}

interface CashFlowSnapshot {
  today: string;
  balance: { total: number | null; partial: boolean; accounts: Array<{ accountId: string; last4: string; bank: string; balance: number | null; day: string | null }> };
  next30: { payOut: number; payOverdue: number; payIn: number; noDuePay: number; noDueRecv: number };
  aging: { notDue: number; d0_30: number; d31_60: number; d61_90: number; d90p: number; unknown: number };
  collectDays: { overall: number | null; byCounterparty: Array<{ key: string; cpName: string | null; days: number; count: number; recentDays: number | null; priorDays: number | null }> };
  payDays: number | null;
  concentration: { months: string[]; invoiceCount: number; top1: { key: string; cpName: string | null; share: number } | null; top3Share: number | null };
}

type CashFlowAlert =
  | { id: string; kind: 'shortfall'; gap: number }
  | { id: string; kind: 'slowdown'; counterpartyKey: string; cpName: string | null; priorDays: number; recentDays: number }
  | { id: string; kind: 'concentration'; counterpartyKey: string; cpName: string | null; share: number }
  | { id: string; kind: 'unknown_in'; month: string; total: number; share: number };

export interface CashFlowResult {
  month: CashFlowMonth;
  snapshot: CashFlowSnapshot;
  alerts: CashFlowAlert[];
}

export type PhoneMarkMethod = 'cash' | 'other_account' | 'offset' | 'other';
export interface MarkReceivedParams {
  profileId: string;
  receivableId: string;
  method: PhoneMarkMethod;
  amount?: number;
  on?: string;
  memo?: string;
}
export interface UndoParams {
  profileId: string;
  seq: number;
}
export type BankErrorCode = 'already_received' | 'already_undone' | 'cannot_undo' | 'bad_amount' | 'bad_date' | 'bad_method' | 'not_found';

export const METHOD_LABEL: Record<PhoneMarkMethod, string> = { cash: '현금', other_account: '다른 계좌', offset: '상계', other: '기타' };

export interface MoneySnapshot {
  at: number;
  accounts: number;
  summary: BankSummary;
  cashflow: CashFlowResult;
  receivables: ReceivableView[];
  payables: ReceivableView[];
}

export function storeable(s: MoneySnapshot): MoneySnapshot {
  const strip = (r: ReceivableView): ReceivableView => ({ ...r, cpBizNo: null, approvalTail: null });
  return {
    ...s,
    receivables: s.receivables.map(strip),
    payables: s.payables.map(strip),
    cashflow: {
      ...s.cashflow,
      month: { ...s.cashflow.month, missing: s.cashflow.month.missing.map((m) => ({ accountId: '', last4: '', bank: m.bank, coverTo: m.coverTo })) },
      snapshot: { ...s.cashflow.snapshot, balance: { ...s.cashflow.snapshot.balance, accounts: s.cashflow.snapshot.balance.accounts.map((a) => ({ ...a, accountId: '', last4: '' })) } },
    },
  };
}

const NB = ' ';
const comma = (n: number) => Math.trunc(n).toLocaleString('ko-KR');

export function shortWon(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(Math.trunc(n));
  if (a < 100_000_000) return `${sign}${comma(a)}원`;
  const eok = Math.floor(a / 100_000_000);
  const man = Math.floor((a % 100_000_000) / 10_000);
  return `${sign}${comma(eok)}억${man ? `${NB}${comma(man)}만원` : '원'}`;
}

export const exactWon = (n: number) => `${n < 0 ? '−' : ''}${comma(Math.abs(n))}원`;

export function dueSoon(list: ReceivableView[]): { count: number; total: number } {
  const xs = list.filter((v) => isOpen(v) && !v.overdue && v.dueIn !== null && v.dueIn >= 0 && v.dueIn <= 7);
  return { count: xs.length, total: xs.reduce((a, v) => a + v.remaining, 0) };
}

const isOpen = (v: ReceivableView) => v.status === 'unpaid' || v.status === 'unknown' || v.status === 'partial';

export function sortOpen(list: ReceivableView[]): ReceivableView[] {
  const rank = (v: ReceivableView) => (v.status === 'unknown' ? 3 : v.overdue ? 0 : v.dueIn !== null ? 1 : 2);
  return list.filter(isOpen).sort((a, b) => rank(a) - rank(b) || (a.dueIn ?? 0) - (b.dueIn ?? 0) || a.writtenOn.localeCompare(b.writtenOn));
}

export function dueLine(v: ReceivableView, kind: 'recv' | 'pay'): string {
  if (v.status === 'unknown') return '거래내역이 오래돼 입금을 확인하지 못했어요';
  if (v.overdue && v.dueIn !== null) return `기한${NB}${-v.dueIn}일${NB}지남`;
  if (v.dueIn === 0) return '오늘까지';
  if (v.dueIn !== null) return `${v.dueIn}일${NB}남음`;
  return kind === 'recv' ? '기한 없음' : '낼 날 없음';
}

export function md(day: string): string {
  const [, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${m}월${NB}${d}일`;
}

export function alertLine(a: CashFlowAlert): string {
  switch (a.kind) {
    case 'shortfall':
      return `다음 30일에 낼 돈이 통장 잔액과 들어올 돈보다 ${exactWon(a.gap)} 많아요`;
    case 'slowdown':
      return `${a.cpName ?? '한 거래처'} 입금이 평소보다 늦어지고 있어요(평균 ${a.priorDays}일 → ${a.recentDays}일)`;
    case 'concentration':
      return `지난 3개월 매출의 ${Math.round(a.share * 100)}%가 ${a.cpName ?? '한 거래처'}예요`;
    case 'unknown_in':
      return `어디서 온 돈인지 모르는 입금이 ${exactWon(a.total)} 있어요. 확인해 둘까요?`;
  }
}

export function unsureLine(m: CashFlowMonth, today: string, staleDays = 7): string | null {
  if (!m.hasAccounts || m.complete) return null;
  const names = m.missing.map((x) => `${x.bank}${x.last4 ? `${NB}${x.last4}` : ''}`).filter(Boolean);
  const who = names.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` 외 ${names.length - 2}개` : ''} 계좌` : '일부 계좌';
  const old = m.missing.some((x) => !x.coverTo || daysBetween(x.coverTo, today) > staleDays);
  return `확인하지 못했어요. ${who} 거래내역이 ${old ? `${staleDays}일 넘게 오래됐어요` : '이 달을 다 덮지 못해요'}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
