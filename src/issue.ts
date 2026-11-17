// 발급 작성(P-10)과 거래처 고르기(P-11)의 순수 계산. 화면은 src/screens/IssueScreen.tsx.
// 세액은 공급가액의 10%를 원 단위 아래 버림(floor). 부가세 포함으로 적으면 공급가액 + 세액이 그 값이 되는 공급가액을 찾는다.

export interface Counterparty {
  id: string;
  name: string;
  /** 000-00-00000 */
  bizNo: string;
  /** 지난번 공급가액 */
  lastSupply?: number;
  lastItem?: string;
  lastAt?: number;
  /** 지금까지 발급한 건수(0이면 처음 거래하는 곳) */
  issued: number;
  /** 등록증에서 읽은 값(기획 v2 PR 7) */
  ceo?: string;
  address?: string;
  bizType?: string;
  item?: string;
  /** 세금계산서 받을 이메일 */
  email?: string;
  /** 휴·폐업 확인: PC가 확인 중 · PC가 켜지면 확인 · 정상 · 휴업·폐업(조회일) */
  status?: CounterpartyStatus;
}

export type CounterpartyStatus = { kind: 'checking' } | { kind: 'waitPc' } | { kind: 'ok' } | { kind: 'closed'; what: '휴업' | '폐업'; on: string };

/** 같은 사업자번호(숫자만 비교)의 거래처 */
export function findByBizNo(all: Counterparty[], bizNo: string): Counterparty | null {
  const d = bizNo.replace(/\D/g, '');
  return d.length === 10 ? (all.find((c) => c.bizNo.replace(/\D/g, '') === d) ?? null) : null;
}

/** 오늘 이미 발급한 것(중복 경고용) */
export interface IssuedToday {
  counterpartyId: string;
  total: number;
  at: number;
}

export type VatMode = 'excl' | 'incl';

export interface Amounts {
  supply: number;
  tax: number;
  total: number;
  /** 부가세 포함으로 적은 합계를 세액 규칙(10% 버림)으로 정확히 만들 수 없어 가장 가까운 아래 값으로 맞췄다 */
  inexact?: boolean;
}

export const taxOf = (supply: number) => Math.floor(supply / 10);

/** 적은 금액을 공급가액·세액·합계로. excl: 적은 값이 공급가액, incl: 적은 값이 합계. */
export function splitAmount(amount: number, mode: VatMode): Amounts {
  if (!Number.isFinite(amount) || amount <= 0) return { supply: 0, tax: 0, total: 0 };
  const n = Math.floor(amount);
  if (mode === 'excl') return { supply: n, tax: taxOf(n), total: n + taxOf(n) };
  // s + floor(s/10) = n 인 s. s + floor(s/10)은 s가 10의 배수를 지날 때 2씩 뛰므로 그런 s가 없는 n이 있다(10, 21, 32, …).
  // 그때도 세액 규칙은 지킨다: s + floor(s/10) <= n 인 가장 큰 s를 쓰고, 합계가 n보다 1 작다고 알린다.
  const s0 = Math.floor((n * 10) / 11);
  for (let s = s0 + 1; s >= Math.max(0, s0 - 1); s--) {
    const total = s + taxOf(s);
    if (total === n) return { supply: s, tax: taxOf(s), total };
    if (total < n) return { supply: s, tax: taxOf(s), total, inexact: true };
  }
  return { supply: 0, tax: 0, total: 0, inexact: true };
}

/** 최근 거래처 다섯 곳(마지막 발급이 최근인 순). */
export function recentCounterparties(all: Counterparty[], n = 5): Counterparty[] {
  return all.filter((c) => c.lastAt).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, n);
}

/** 상호·등록번호(숫자만으로도) 찾기. */
export function searchCounterparties(all: Counterparty[], q: string): Counterparty[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const digits = t.replace(/\D/g, '');
  return all.filter((c) => c.name.toLowerCase().includes(t) || (digits.length >= 3 && c.bizNo.replace(/\D/g, '').includes(digits)));
}

/** 오늘 같은 거래처에 같은 합계로 발급한 것이 있으면 그것. */
export function findDuplicate(today: IssuedToday[], counterpartyId: string, total: number): IssuedToday | null {
  return today.find((d) => d.counterpartyId === counterpartyId && d.total === total) ?? null;
}
