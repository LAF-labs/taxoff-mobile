
import { masked } from './ui/mask.ts';

export interface Counterparty {
  id: string;
  name: string;
  bizNo: string;
  lastSupply?: number;
  lastItem?: string;
  lastAt?: number;
  issued: number;
  ceo?: string;
  address?: string;
  bizType?: string;
  item?: string;
  email?: string;
  status?: CounterpartyStatus;
}

export type CounterpartyStatus = { kind: 'checking' } | { kind: 'waitPc' } | { kind: 'ok' } | { kind: 'closed'; what: '휴업' | '폐업'; on: string };

export function findByBizNo(all: Counterparty[], bizNo: string): Counterparty | null {
  const d = bizNo.replace(/\D/g, '');
  return d.length === 10 ? (all.find((c) => c.bizNo.replace(/\D/g, '') === d) ?? null) : null;
}

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
  inexact?: boolean;
}

export const taxOf = (supply: number) => Math.floor(supply / 10);

export function splitAmount(amount: number, mode: VatMode): Amounts {
  if (!Number.isFinite(amount) || amount <= 0) return { supply: 0, tax: 0, total: 0 };
  const n = Math.floor(amount);
  if (mode === 'excl') return { supply: n, tax: taxOf(n), total: n + taxOf(n) };
  const s0 = Math.floor((n * 10) / 11);
  for (let s = s0 + 1; s >= Math.max(0, s0 - 1); s--) {
    const total = s + taxOf(s);
    if (total === n) return { supply: s, tax: taxOf(s), total };
    if (total < n) return { supply: s, tax: taxOf(s), total, inexact: true };
  }
  return { supply: 0, tax: 0, total: 0, inexact: true };
}

export function recentCounterparties(all: Counterparty[], n = 5): Counterparty[] {
  return all.filter((c) => c.lastAt).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, n);
}

export function searchCounterparties(all: Counterparty[], q: string): Counterparty[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const digits = t.replace(/\D/g, '');
  return all.filter((c) => c.name.toLowerCase().includes(t) || (digits.length >= 3 && c.bizNo.replace(/\D/g, '').includes(digits)));
}

export function manualRecipientFromSearch(query: string): { name: string; bizNo: string } {
  const t = query.trim();
  if (t && !/^[\d-\s]+$/.test(t)) return { name: t, bizNo: '' };
  return { name: '', bizNo: t.replace(/\D/g, '').length >= 3 ? masked('bizNo', t) : '' };
}

export function findDuplicate(today: IssuedToday[], counterpartyId: string, total: number): IssuedToday | null {
  return today.find((d) => d.counterpartyId === counterpartyId && d.total === total) ?? null;
}

export function orderedCounterparties(all: Counterparty[]): Counterparty[] {
  return all
    .map((c, i) => ({ c, i, day: c.lastAt ? Math.floor(c.lastAt / 86_400_000) : -1 }))
    .sort((a, b) => b.day - a.day || b.c.issued - a.c.issued || a.i - b.i)
    .map((x) => x.c);
}
