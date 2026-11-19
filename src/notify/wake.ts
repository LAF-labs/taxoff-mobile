// 푸시 깨우기(ADR-053 결정 4)의 순수 판단. OS·네트워크 없이 시험한다(test/push-wake.spec.ts).
// 서버(tex poc/services/push/API.md)는 내용 없는 알림만 보낸다: aps.alert.loc-key가 종류다. 글은 앱 번들 현지화에 있다.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Job } from '../queue';
import type { Permission } from './local';

export type WakeKind = 'approve' | 'update';
export type PushPlatform = 'apns' | 'apns_dev';

/** 앱 번들 Localizable.strings 키(plugins/with-wake-strings.cjs와 같아야 한다) */
export const WAKE_KEYS: Record<WakeKind, string> = { approve: 'SAX_WAKE_APPROVE', update: 'SAX_WAKE_UPDATE' };

/** 개발 빌드는 Apple 샌드박스(apns_dev), TestFlight·스토어 빌드는 운영(apns). 토큰만 봐서는 구분이 안 돼 폰이 알린다. */
export function pushPlatform(isDev: boolean, override?: string): PushPlatform {
  if (override === 'development') return 'apns_dev';
  if (override === 'production') return 'apns';
  return isDev ? 'apns_dev' : 'apns';
}

/** 마지막으로 올린 토큰의 지문(플랫폼까지). 같으면 다시 올리지 않는다. 토큰 자체는 저장하지 않는다. */
export function tokenHash(platform: PushPlatform, token: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${platform}:${token}`)));
}

/** APNs 토큰 모양(서버와 같은 규칙: 소문자 hex 64~200자) */
export function apnsToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.toLowerCase();
  return /^[0-9a-f]{64,200}$/.test(t) ? t : null;
}

export type PushPlan = 'put' | 'delete' | 'none';

/**
 * 지금 서버에 무엇을 할지. 올리는 때: PC와 연결돼 있고, OS 허용을 받았고, 설정 스위치가 켜져 있고, 토큰이 바뀌었을 때.
 * 그 밖에 올린 기록이 있으면 지운다(설정에서 끔, OS에서 끔). 토큰을 아직 못 받았으면(token null) 아무것도 하지 않는다.
 */
export function pushPlan(o: { paired: boolean; perm: Permission | null; wakeOn: boolean; hash: string | null; last: string | null }): PushPlan {
  const want = o.paired && o.perm === 'granted' && o.wakeOn;
  if (want) return o.hash && o.hash !== o.last ? 'put' : 'none';
  return o.last ? 'delete' : 'none';
}

/** 앱 안에서 허용을 물을 때: 발급을 한 번이라도 맡겼고, 아직 묻지 않았고, OS가 아직 정하지 않았을 때 한 번 */
export function askDue(o: { entrusted: number; asked: boolean; perm: Permission | null }): boolean {
  return o.entrusted > 0 && !o.asked && o.perm === 'undetermined';
}

/**
 * 받은 알림이 우리 깨우기인지와 종류. iOS: trigger.payload.aps.alert['loc-key']. Android(다음 단계): data {t:'wake', k}.
 * 앱이 만든 로컬 알림(발급 진행·돈)은 null.
 */
export function wakeKindOf(n: { request?: { trigger?: unknown; content?: { data?: unknown } } } | null | undefined): WakeKind | null {
  const trig = n?.request?.trigger as { type?: string; payload?: unknown; remoteMessage?: { data?: unknown } } | null | undefined;
  if (!trig || trig.type !== 'push') return null;
  const aps = (trig.payload as { aps?: { alert?: unknown } } | undefined)?.aps;
  const key = aps && typeof aps.alert === 'object' && aps.alert ? (aps.alert as Record<string, unknown>)['loc-key'] : undefined;
  if (key === WAKE_KEYS.approve) return 'approve';
  if (key === WAKE_KEYS.update) return 'update';
  const data = (trig.remoteMessage?.data ?? n?.request?.content?.data) as { t?: unknown; k?: unknown } | undefined;
  if (data?.t === 'wake') return data.k === 'approve' ? 'approve' : 'update';
  return null;
}

/** 앱이 만든 승인 알림(앱이 뒤에 있을 때 받은 승인 요청, PushHost). 누르면 깨우기 approve와 같이 다룬다. */
export const LOCAL_APPROVE = 'approve';

/** 누른 알림이 승인 쪽으로 가야 하는지: 서버 깨우기 또는 앱이 만든 승인 알림 */
export function tapKindOf(n: Parameters<typeof wakeKindOf>[0]): WakeKind | null {
  const k = wakeKindOf(n);
  if (k) return k;
  const data = n?.request?.content?.data as { open?: unknown } | undefined;
  return data?.open === LOCAL_APPROVE ? 'approve' : null;
}

/**
 * 앱이 뒤에 있는 동안 새로 받은 승인 요청(아직 알리지 않은 reqId, 마감 전, 폰이 맡긴 일). 앱이 뒤로 간 직후 몇 초는
 * PC와의 연결이 살아 있어 PC가 깨우기 대신 승인 요청을 바로 넘긴다. 그때 폰이 스스로 알림을 띄운다.
 */
export function newGates(jobs: readonly Job[], told: ReadonlySet<string>, now: number): Job[] {
  return jobs.filter((j) => j.id.startsWith('cmd-') && j.state === 'approval' && j.gate && j.gate.exp > now && !told.has(j.gate.reqId));
}

/**
 * approve 알림을 눌렀는데 승인 시트가 오지 않았다(PC에서 이미 승인했거나 10분이 지났다): 그 실행의 지금 상태를 보인다.
 * 폰이 맡긴 일(cmd-) 가운데 가장 최근 것. 없으면 null(맡긴 일 목록으로).
 */
export function latestEntrusted(jobs: readonly Job[]): Job | null {
  let best: Job | null = null;
  for (const j of jobs) if (j.id.startsWith('cmd-') && (!best || j.createdAt > best.createdAt)) best = j;
  return best;
}

/** 승인 시트를 기다리는 시간(세션이 붙은 뒤). PC는 attach에서 열린 게이트를 다시 보낸다. */
export const SHEET_WAIT_MS = 4000;
