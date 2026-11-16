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
}

export const taxOf = (supply: number) => Math.floor(supply / 10);

/** 적은 금액을 공급가액·세액·합계로. excl: 적은 값이 공급가액, incl: 적은 값이 합계. */
export function splitAmount(amount: number, mode: VatMode): Amounts {
  if (!Number.isFinite(amount) || amount <= 0) return { supply: 0, tax: 0, total: 0 };
  const n = Math.floor(amount);
  if (mode === 'excl') return { supply: n, tax: taxOf(n), total: n + taxOf(n) };
  // s + floor(s/10) = n 인 s. 그런 s가 없으면(예: 11의 배수 사이 빈 값) 가까운 s를 쓰고 세액으로 맞춘다.
  const s0 = Math.floor((n * 10) / 11);
  for (const s of [s0, s0 + 1, s0 - 1]) if (s > 0 && s + taxOf(s) === n) return { supply: s, tax: taxOf(s), total: n };
  return { supply: s0, tax: n - s0, total: n };
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
