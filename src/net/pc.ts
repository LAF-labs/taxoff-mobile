// PC 연결: 라이브 세션이 있으면 라이브로, 없으면 릴레이 HTTPS 큐로 보낸다(팀장 결정 2026-11-05, Phase 1은 라이브 WSS가 꺼져 있다).
//   라이브(D08 §5): 우편함 라이브 연결 → Noise_IK 세션 → hello → 보관함 비우기. PC가 받으면 ack → 폰에서 지운다.
//   큐(D08 §7, intent-envelope v1.5 xfer): 번들(Q_D, Vd 서명) 확인 → HPKE로 봉인해 POST. PC가 켜지면 꺼내 간다.
//     ack가 폰으로 오지 않으므로 보관함에 남겨 두고, 큐 TTL(24시간)이 지나면 다시 넣고, 7일 뒤 지운다(@sax/remote queueOutbox).
// PC가 꺼져 있거나 이 폰을 거부하면 라이브는 구분 없이 실패한다(PC는 무응답으로 거부한다). 보낸 뒤에는 연결을 닫는다.
import {
  CAP, QUEUE, flushOutbox, fromB64, monotonicClock, openMobileSession, queueOutbox, relayOrigin, relayQueue, softNoiseStatic, softSigner, verifyQBundle,
  wsRelayClient, VM_PURPOSES, type FlushResult, type Link, type QueueSendResult, type WebSocketLike,
} from '@sax/remote';
import { APP_VERSION, DEV_RELAY_HOST, DEV_STACK } from '../config';
import { deviceAuthFor, fetchJson, type Htm } from './devauth';
import type { DeviceKeys } from '../keyring';
import type { FileOutbox } from '../storage/outbox';
import type { AppData } from '../storage/state';
import { PHONE_CAPS, newerCopy, receiveCopy } from './pcCopy';
import { driveCmds, trimCmds } from './issueLive';
import { causeOf, pushWhy, whyCode } from './pcWhy';

/** queued: PC는 꺼져 있고 릴레이 큐에 맡겼다. stale: PC가 오래 꺼져 있어 유효한 번들이 없다(맡길 수 없다). */
export type PcStatus = 'unpaired' | 'connecting' | 'online' | 'queued' | 'stale' | 'offline';

export interface SyncDeps {
  keys: DeviceKeys;
  data: () => AppData;
  update: (f: (d: AppData) => AppData) => Promise<void>;
  outbox: FileOutbox;
  /** 세션이 열리면 부른다(명령을 지켜보는 동안 화면이 '연결 중'에 머물지 않게) */
  onLive?: () => void;
  /** 잠그면 거짓 */
  alive?: () => boolean;
}

export interface SyncResult {
  status: PcStatus;
  /** 라이브가 안 된 이유('단계:원인', net/pcWhy.ts). 라이브로 붙었으면 없다 */
  why?: string;
  flushed?: FlushResult;
  queued?: QueueSendResult;
}

const PEER_WAIT_MS = 3000;

// RN WebSocket 생성자(react-native/Libraries/WebSocket/WebSocket.js): 세 번째 인자 { headers }. DOM 타입에는 없다.
type RnWebSocket = new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => WebSocketLike;
const RnWs = WebSocket as unknown as RnWebSocket;

/** 릴레이 클라이언트. deviceAuth는 우편함 라이브에만 필요하다(페어링 룸은 인증 없음). */
export function relayFor(host: string, deviceAuth?: (htm: Htm, htu: string) => Promise<Record<string, string>>) {
  return wsRelayClient({
    host,
    insecureLocal: DEV_STACK && host === DEV_RELAY_HOST,
    // RN WebSocket은 세 번째 인자로 헤더를 받는다(기기 토큰·우편함 토큰. URL에는 넣지 않는다).
    open: (url, headers) => new RnWs(url, undefined, headers ? { headers } : undefined),
    deviceAuth,
  });
}

function waitPeer(link: Link, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    link.onPeer(() => {
      clearTimeout(t);
      resolve(true);
    });
    link.onClose(() => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/** 한 번 연결해 보관함을 비운다. 라이브가 안 되면 큐로. 동시에 두 번 돌지 않게 호출하는 쪽이 막는다. */
export async function syncWithPc(d: SyncDeps): Promise<SyncResult> {
  const pair = d.data().pair;
  if (!pair) return { status: 'unpaired' };
  const live = await viaLive(d, pair);
  if ('status' in live) return live;
  // 잠겨서 멈췄으면 큐로 넘어가지 않는다(키가 지워지는 중)
  if (d.alive && !d.alive()) return { status: 'offline', why: live.why };
  const q = await viaQueue(d, pair);
  // 큐가 막혔으면 그 이유를, 아니면 라이브가 멈춘 이유를 남긴다(둘 다 실패면 큐 쪽이 더 바깥 원인이다: 인터넷·기기 토큰)
  const why = q.why ?? live.why;
  await d.update((x) => ({ ...x, pcLog: pushWhy(x.pcLog, { code: why, at: Date.now() }) })).catch(() => undefined);
  return { ...q, why };
}

type Pair = NonNullable<AppData['pair']>;

/** 라이브 세션. 세션이 열리지 않으면 멈춘 단계와 원인(큐로 넘어간다). */
async function viaLive(d: SyncDeps, pair: Pair): Promise<SyncResult | { why: string }> {
  let link: Link | null = null;
  const noise = softNoiseStatic(d.keys.sm);
  let stage: 'join' | 'session' | 'live' = 'join';
  try {
    const relay = relayFor(pair.relayHost, deviceAuthFor(pair.pairId, pair.cert, d.keys.vm));
    link = await relay.joinMailbox(fromB64(pair.mbxId), { read: fromB64(pair.tokRead), write: fromB64(pair.tokWrite) }, 'mobile');
    // 우편함에는 들어갔다. PC가 이 우편함을 지키고 있으면 릴레이가 곧 peer를 알린다(없으면 PC가 꺼졌거나 이 폰 기록이 PC에 없다)
    if (!(await waitPeer(link, PEER_WAIT_MS))) return { why: whyCode('peer', link.closed ? 'closed' : 'timeout') };
    stage = 'session';
    const clock = monotonicClock(d.data().ikTs);
    let used = 0;
    const s = await openMobileSession(link, {
      pairId: pair.pairId,
      noise,
      desktopStatic: fromB64(pair.desktopStatic),
      hello: { appVersion: APP_VERSION, deviceListVersion: d.data().seenListVersion, capabilities: [CAP.receipt, CAP.receiptV2, CAP.cash, ...PHONE_CAPS] },
      nextTimestamp: () => (used = clock()),
      responseTimeoutMs: 8000,
    });
    if (used) await d.update((x) => ({ ...x, ikTs: Math.max(x.ikTs, used) }));
    // PC는 모르는 폰·폐기된 폰·재생된 시각을 무응답으로 거절한다. 응답 시간초과와 구분되지 않는다
    if (!s) return { why: whyCode('session', link.closed ? 'closed' : 'no_answer') };
    stage = 'live';
    await d.update((x) => ({ ...x, lastSeenPc: Date.now() }));
    d.onLive?.();
    // PC는 세션을 열자마자 사본을 보낸다. 보관함을 비우기 전에 받는다(비우는 동안 온 다른 봉투는 버려진다).
    const copy = await receiveCopy(s.channel, s.peerHello.capabilities).catch(() => null);
    if (copy) await d.update((x) => ({ ...x, pcCopy: newerCopy(x.pcCopy, copy) }));
    const flushed = await flushOutbox(s.channel, d.outbox);
    if (flushed.sent.length) {
      const sent = new Set(flushed.sent);
      await d.update((x) => ({
        ...x,
        cash: x.cash.map((c) => (sent.has(c.msgId) ? { ...c, state: 'sent' as const } : c)),
        recent: x.recent.map((r) => (sent.has(r.msgId) ? { ...r, state: 'sent' as const } : r)),
      }));
    }
    // 폰 발급 명령: 저장된 cmdId로 보내고(다시 보내도 같은 cmdId), 끝날 때까지 진행을 받는다
    await driveCmds(s.channel, s.peerHello.capabilities, {
      cmds: () => d.data().cmds ?? [],
      save: (f) => d.update((x) => ({ ...x, cmds: trimCmds(f(x.cmds ?? [])) })),
      onCopy: (c) => d.update((x) => ({ ...x, pcCopy: newerCopy(x.pcCopy, c) })),
      alive: d.alive,
    });
    s.channel.close();
    return { status: 'online', flushed };
  } catch (e) {
    return { why: whyCode(stage, causeOf(e)) };
  } finally {
    noise.destroy();
    link?.close();
  }
}

/** 릴레이 큐. 번들이 없거나 만료·역행이면 'stale'(PC가 7일 넘게 꺼져 있었다). */
async function viaQueue(d: SyncDeps, pair: Pair): Promise<SyncResult> {
  const vm = softSigner(d.keys.vm, VM_PURPOSES);
  try {
    const origin = relayOrigin(pair.relayHost, DEV_STACK && pair.relayHost === DEV_RELAY_HOST);
    const q = relayQueue({
      http: fetchJson,
      origin,
      mbxId: fromB64(pair.mbxId),
      tok: { read: fromB64(pair.tokRead), write: fromB64(pair.tokWrite) },
      deviceAuth: deviceAuthFor(pair.pairId, pair.cert, d.keys.vm),
    });
    const field = await q.getBundle();
    const bundle = field ? verifyQBundle(field, fromB64(pair.desktopVd), { minSeq: d.data().qbundleSeq }) : null;
    if (!bundle) return { status: 'stale', why: whyCode('stale', field ? 'bundle_invalid' : 'no_bundle') };
    if (bundle.seq > d.data().qbundleSeq) await d.update((x) => ({ ...x, qbundleSeq: Math.max(x.qbundleSeq, bundle.seq) }));
    // 봉투 seq를 먼저 예약해 저장한다(중간에 죽어도 같은 seq를 다시 쓰지 않는다. 빈 번호는 괜찮다).
    const items = await d.outbox.list();
    const need = items.reduce((n, it) => n + (it.kind === 'cash' ? 1 : 1 + Math.ceil(it.offer.bytes / QUEUE.chunk)), 0);
    if (need === 0) return { status: 'offline' };
    const start = d.data().queueSeq;
    await d.update((x) => ({ ...x, queueSeq: Math.max(x.queueSeq, start) + need }));
    let next = start;
    const queued = await queueOutbox(d.outbox, { queue: q, pairId: pair.pairId, vm, bundle, mbxEpoch: pair.mbxEpoch, nextSeq: () => ++next });
    const done = new Set(queued.queued);
    if (done.size) {
      await d.update((x) => ({
        ...x,
        cash: x.cash.map((c) => (done.has(c.msgId) && c.state === 'pending' ? { ...c, state: 'queued' as const } : c)),
        recent: x.recent.map((r) => (done.has(r.msgId) && r.state === 'pending' ? { ...r, state: 'queued' as const } : r)),
      }));
    }
    return { status: queued.queued.length || !queued.waiting.length ? 'queued' : 'offline', queued };
  } catch (e) {
    return { status: 'offline', why: whyCode('queue', causeOf(e)) };
  } finally {
    vm.destroy();
  }
}
