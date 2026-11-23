import type { PcStatus } from './pc';

export const RETRY_FIRST_MS = 3_000;
export const JITTER = 0.2;
export const NET_SETTLE_MS = 800;

export interface NetShape {
  type: string;
  reachable: boolean | null;
}

export function netChanged(prev: NetShape | null, next: NetShape): boolean {
  if (!prev) return false;
  if (next.reachable === false || next.type === 'none') return false;
  if (prev.type !== next.type) return true;
  return prev.reachable === false;
}

export function failed(status: PcStatus): boolean {
  return status === 'offline' || status === 'stale' || status === 'relink' || status === 'connecting';
}

export function retryDelay(n: number, maxMs: number, rand: () => number = Math.random): number {
  const base = Math.min(maxMs, RETRY_FIRST_MS * 2 ** Math.max(0, Math.min(n - 1, 16)));
  const jitter = base * JITTER * (rand() * 2 - 1);
  return Math.max(1_000, Math.round(Math.min(maxMs, base + jitter)));
}
