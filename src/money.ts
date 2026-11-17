// 돈 탭(기획 v2 PR 8, 11-cash-flow §3.4·§3.5·§3.7, 09-bank-matching 받을 돈).
// 엔진 명령의 출력 모양을 필드 이름 그대로 옮겼다(tex poc/packages/engine/src/bank/service.ts·cashflow.ts):
//   db.query.bank.summary → BankSummary, db.query.bank.cashflow → CashFlowResult, 받을·낼 돈 목록 → ReceivableView[],
//   bank.markReceived → {seq}, bank.undo → {seq}, 실패는 already_received 등 코드.
// 서버는 이 숫자를 갖지 않는다(09 §13). 폰은 PC가 켜져 있을 때 물어 받고, 꺼져 있으면 마지막으로 받은 요약을 날짜와 함께 보인다.
// 폰에 보관할 때는 거래처 이름만 남기고 사업자번호·계좌 정보는 지운다(storeable).

// ---- 엔진 모양 ----

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
  /** 받기로 한 날 − 오늘(지나면 음수). 기한 없음이면 null */
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

export interface CashFlowSnapshot {
  today: string;
  balance: { total: number | null; partial: boolean; accounts: Array<{ accountId: string; last4: string; bank: string; balance: number | null; day: string | null }> };
  next30: { payOut: number; payOverdue: number; payIn: number; noDuePay: number; noDueRecv: number };
  aging: { notDue: number; d0_30: number; d31_60: number; d61_90: number; d90p: number; unknown: number };
  collectDays: { overall: number | null; byCounterparty: Array<{ key: string; cpName: string | null; days: number; count: number; recentDays: number | null; priorDays: number | null }> };
  payDays: number | null;
  concentration: { months: string[]; invoiceCount: number; top1: { key: string; cpName: string | null; share: number } | null; top3Share: number | null };
}

export type CashFlowAlert =
  | { id: string; kind: 'shortfall'; gap: number }
  | { id: string; kind: 'slowdown'; counterpartyKey: string; cpName: string | null; priorDays: number; recentDays: number }
  | { id: string; kind: 'concentration'; counterpartyKey: string; cpName: string | null; share: number }
  | { id: string; kind: 'unknown_in'; month: string; total: number; share: number };

export interface CashFlowResult {
  month: CashFlowMonth;
  snapshot: CashFlowSnapshot;
  alerts: CashFlowAlert[];
}

/** 폰에서 쓰는 받은 방법(계좌 입금 account·수수료 fee는 PC가 맞춘다) */
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

// ---- 폰에 보관하는 마지막 요약 ----

export interface MoneySnapshot {
  /** PC에서 받은 시각(ms) */
  at: number;
  /** 연결한 계좌 수(이름·번호는 보관하지 않는다) */
  accounts: number;
  summary: BankSummary;
  cashflow: CashFlowResult;
  receivables: ReceivableView[];
  payables: ReceivableView[];
}

/** 보관 전에 사업자번호·계좌 끝자리·계좌 id·은행 이름을 지운다(거래처 이름·금액·날짜만 남긴다). */
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

// ---- 표기 ----

const NB = ' ';
const comma = (n: number) => Math.trunc(n).toLocaleString('ko-KR');

/** 1억이 넘으면 "1억 2,340만원"처럼 줄인다(만 원 아래는 버림, 누르면 정확한 값). 그 아래는 "12,340,000원". */
export function shortWon(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(Math.trunc(n));
  if (a < 100_000_000) return `${sign}${comma(a)}원`;
  const eok = Math.floor(a / 100_000_000);
  const man = Math.floor((a % 100_000_000) / 10_000);
  return `${sign}${comma(eok)}억${man ? `${NB}${comma(man)}만원` : '원'}`;
}

export const exactWon = (n: number) => `${n < 0 ? '−' : ''}${comma(Math.abs(n))}원`;

/** 받을·낼 돈 7일 안(오늘 포함, 기한 안 지남) */
export function dueSoon(list: ReceivableView[]): { count: number; total: number } {
  const xs = list.filter((v) => isOpen(v) && !v.overdue && v.dueIn !== null && v.dueIn >= 0 && v.dueIn <= 7);
  return { count: xs.length, total: xs.reduce((a, v) => a + v.remaining, 0) };
}

export const isOpen = (v: ReceivableView) => v.status === 'unpaid' || v.status === 'unknown' || v.status === 'partial';

/** 목록 순서: 기한 지남(오래된 순) → 기한 있는 것(가까운 순) → 기한 없음 → 확인 못 함 */
export function sortOpen(list: ReceivableView[]): ReceivableView[] {
  const rank = (v: ReceivableView) => (v.status === 'unknown' ? 3 : v.overdue ? 0 : v.dueIn !== null ? 1 : 2);
  return list.filter(isOpen).sort((a, b) => rank(a) - rank(b) || (a.dueIn ?? 0) - (b.dueIn ?? 0) || a.writtenOn.localeCompare(b.writtenOn));
}

/** 줄의 기한 표시 */
export function dueLine(v: ReceivableView, kind: 'recv' | 'pay'): string {
  if (v.status === 'unknown') return '입금 확인 못 함 · 거래내역이 오래됐어요';
  if (v.overdue && v.dueIn !== null) return `기한${NB}${-v.dueIn}일${NB}지남`;
  if (v.dueIn === 0) return '오늘까지';
  if (v.dueIn !== null) return `${v.dueIn}일${NB}남음`;
  return kind === 'recv' ? '기한 없음' : '낼 날 없음';
}

/** "11월 2일" */
export function md(day: string): string {
  const [, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${m}월${NB}${d}일`;
}

/** 11-cash-flow §3.5 알림 문구(사실만, 초안 그대로) */
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

/** 이번 달 숫자를 믿을 수 없을 때(§3.4 "확인 못 함") 이유 한 줄. 믿을 수 있으면 null */
export function unsureLine(m: CashFlowMonth, today: string, staleDays = 7): string | null {
  if (!m.hasAccounts || m.complete) return null;
  const names = m.missing.map((x) => `${x.bank}${x.last4 ? `${NB}${x.last4}` : ''}`).filter(Boolean);
  const who = names.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` 외 ${names.length - 2}개` : ''} 계좌` : '일부 계좌';
  const old = m.missing.some((x) => !x.coverTo || daysBetween(x.coverTo, today) > staleDays);
  return `확인 못 함 · ${who} 거래내역이 ${old ? `${staleDays}일 넘게 오래됐어요` : '이 달을 다 덮지 못해요'}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
