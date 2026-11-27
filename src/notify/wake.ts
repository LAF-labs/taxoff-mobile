import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Job } from '../queue';
import type { Permission } from './local';

export type WakeKind = 'approve' | 'update' | 'unlock';
export type PushPlatform = 'apns' | 'apns_dev';

const WAKE_KEYS: Record<WakeKind, string> = { approve: 'SAX_WAKE_APPROVE', update: 'SAX_WAKE_UPDATE', unlock: 'SAX_WAKE_UNLOCK' };
/** 한꺼번에 눌렸을 때 무엇을 먼저 여는지. 풀기 요청은 60초뿐이라 맨 앞이다. */
export const WAKE_RANK: Record<WakeKind, number> = { update: 0, approve: 1, unlock: 2 };

export function pushPlatform(isDev: boolean, override?: string): PushPlatform {
  if (override === 'development') return 'apns_dev';
  if (override === 'production') return 'apns';
  return isDev ? 'apns_dev' : 'apns';
}

export function tokenHash(platform: PushPlatform, token: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${platform}:${token}`)));
}

export function apnsToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.toLowerCase();
  return /^[0-9a-f]{64,200}$/.test(t) ? t : null;
}

type PushPlan = 'put' | 'delete' | 'none';

export function pushPlan(o: { paired: boolean; perm: Permission | null; wakeOn: boolean; hash: string | null; last: string | null }): PushPlan {
  const want = o.paired && o.perm === 'granted' && o.wakeOn;
  if (want) return o.hash && o.hash !== o.last ? 'put' : 'none';
  return o.last ? 'delete' : 'none';
}

export function askDue(o: { entrusted: number; asked: boolean; perm: Permission | null }): boolean {
  return o.entrusted > 0 && !o.asked && o.perm === 'undetermined';
}

export function wakeKindOf(n: { request?: { trigger?: unknown; content?: { data?: unknown } } } | null | undefined): WakeKind | null {
  const trig = n?.request?.trigger as { type?: string; payload?: unknown; remoteMessage?: { data?: unknown } } | null | undefined;
  if (!trig || trig.type !== 'push') return null;
  const aps = (trig.payload as { aps?: { alert?: unknown } } | undefined)?.aps;
  const key = aps && typeof aps.alert === 'object' && aps.alert ? (aps.alert as Record<string, unknown>)['loc-key'] : undefined;
  if (key === WAKE_KEYS.approve) return 'approve';
  if (key === WAKE_KEYS.update) return 'update';
  if (key === WAKE_KEYS.unlock) return 'unlock';
  const data = (trig.remoteMessage?.data ?? n?.request?.content?.data) as { t?: unknown; k?: unknown } | undefined;
  if (data?.t === 'wake') return data.k === 'approve' || data.k === 'unlock' ? data.k : 'update';
  return null;
}

export const LOCAL_APPROVE = 'approve';

export function tapKindOf(n: Parameters<typeof wakeKindOf>[0]): WakeKind | null {
  const k = wakeKindOf(n);
  if (k) return k;
  const data = n?.request?.content?.data as { open?: unknown } | undefined;
  return data?.open === LOCAL_APPROVE ? 'approve' : null;
}

export function newGates(jobs: readonly Job[], told: ReadonlySet<string>, now: number): Job[] {
  return jobs.filter((j) => j.id.startsWith('cmd-') && j.state === 'approval' && j.gate && j.gate.exp > now && !told.has(j.gate.reqId));
}

export function latestEntrusted(jobs: readonly Job[]): Job | null {
  let best: Job | null = null;
  for (const j of jobs) if (j.id.startsWith('cmd-') && (!best || j.createdAt > best.createdAt)) best = j;
  return best;
}

export const SHEET_WAIT_MS = 4000;
