import {
  CAP, QUEUE, flushOutbox, fromB64, issueCmd, monotonicClock, openMobileSession, queueCmd, queueLeave, queueOutbox, relayOrigin, relayQueue, softNoiseStatic, softSigner, verifyQBundle,
  wsRelayClient, VM_PURPOSES, type FlushResult, type Link, type PhoneCopyBody, type QueueSendResult, type WebSocketLike,
} from '@sax/remote';
import { APP_VERSION, DEV_RELAY_HOST, DEV_STACK, PUBLIC_ORIGIN } from '../config';
import { deviceAuthFor, fetchJson, type Htm } from './devauth';
import type { DeviceKeys } from '../keyring';
import type { FileOutbox } from '../storage/outbox';
import type { AppData } from '../storage/state';
import { PHONE_CAPS, newerCopy, receiveCopy } from './pcCopy';
import { driveCmds, trimCmds } from './issueLive';
import { cmdsToQueue } from '../phoneCmd';
import { enrollPx } from './pxLive';
import type { PxDevice } from '../approvalKey';
import { replaying, tapping } from './hold';
import { causeOf, needsRelink, pushWhy, whyCode } from './pcWhy';

export type PcStatus = 'unpaired' | 'connecting' | 'online' | 'queued' | 'stale' | 'relink' | 'offline';

interface SyncDeps {
  keys: DeviceKeys;
  data: () => AppData;
  update: (f: (d: AppData) => AppData) => Promise<void>;
  outbox: FileOutbox;
  onLive?: () => void;
  alive?: () => boolean;
  px?: PxDevice | null;
}

interface SyncResult {
  status: PcStatus;
  why?: string;
  flushed?: FlushResult;
  queued?: QueueSendResult;
}

const PEER_WAIT_MS = 3000;

type RnWebSocket = new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => WebSocketLike;
const RnWs = WebSocket as unknown as RnWebSocket;

export function relayFor(host: string, deviceAuth?: (htm: Htm, htu: string) => Promise<Record<string, string>>) {
  return wsRelayClient({
    host,
    insecureLocal: DEV_STACK && host === DEV_RELAY_HOST,
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

export async function syncWithPc(d: SyncDeps): Promise<SyncResult> {
  const pair = d.data().pair;
  if (!pair) return { status: 'unpaired' };
  // 붙잡아 둔 연결로 PC가 없는 줄 이미 알면 3초 기다리지 않고 바로 큐에 맡긴다(맡기고 곧장 앱을 닫아도 가게).
  const live = pcAway() ? { why: whyCode('peer', 'away') } : await viaLive(d, pair);
  if ('status' in live) return live;
  if (d.alive && !d.alive()) return { status: 'offline', why: live.why };
  const q = await viaQueue(d, pair);
  const why = q.why ?? live.why;
  await d.update((x) => ({ ...x, pcLog: pushWhy(x.pcLog, { code: why, at: Date.now() }) })).catch(() => undefined);
  if (needsRelink(why)) return { ...q, status: 'relink', why };
  return { ...q, why };
}

type Pair = NonNullable<AppData['pair']>;

let liveLink: Link | null = null;

/** PC가 우편함에 들어오고 나가는 것. 'lost'는 붙잡아 둔 연결 자체가 끊긴 것이다. */
export type Presence = 'up' | 'down' | 'lost';
let held: Link | null = null;
let presence: ((p: Presence) => void) | null = null;

/** 앱을 연 동안 우편함 연결을 붙잡아 두고, PC가 켜지고 꺼지는 것을 바로 알린다. */
export function onPresence(cb: ((p: Presence) => void) | null): void {
  presence = cb;
}

let heldDown = false;

/** 붙잡아 둔 연결이 열려 있고 그 너머에 PC가 없다. */
export function pcAway(): boolean {
  return !!held && !held.closed && heldDown;
}

function hold(link: Link, peerNow: boolean): void {
  dropHeld();
  held = link;
  heldDown = !peerNow;
  link.onPeerGone?.(() => {
    if (held !== link || heldDown) return;
    heldDown = true;
    presence?.('down');
  });
  link.onPeer(() => {
    if (held !== link || !heldDown) return;
    heldDown = false;
    presence?.('up');
  });
  link.onClose(() => {
    if (held !== link) return;
    held = null;
    presence?.('lost');
  });
}

function dropHeld(): void {
  const h = held;
  held = null;
  h?.close();
}

export function closeLive(): void {
  liveLink?.close();
  dropHeld();
}

async function viaLive(d: SyncDeps, pair: Pair): Promise<SyncResult | { why: string }> {
  let link: Link | null = null;
  const noise = softNoiseStatic(d.keys.sm);
  let stage: 'join' | 'session' | 'live' = 'join';
  try {
    const relay = relayFor(pair.relayHost, deviceAuthFor(pair.pairId, pair.cert, d.keys.vm));
    dropHeld();
    link = await relay.joinMailbox(fromB64(pair.mbxId), { read: fromB64(pair.tokRead), write: fromB64(pair.tokWrite) }, 'mobile');
    liveLink = link;
    if (!(await waitPeer(link, PEER_WAIT_MS))) {
      const why = whyCode('peer', link.closed ? 'closed' : 'timeout');
      if (!link.closed && (!d.alive || d.alive())) {
        hold(link, false);
        link = null;
      }
      return { why };
    }
    stage = 'session';
    const clock = monotonicClock(d.data().ikTs);
    let used = 0;
    const s = await openMobileSession(link, {
      pairId: pair.pairId,
      noise,
      desktopStatic: fromB64(pair.desktopStatic),
      hello: { appVersion: APP_VERSION, deviceListVersion: d.data().seenListVersion, capabilities: [CAP.receipt, CAP.receiptV2, CAP.cash, ...PHONE_CAPS, ...(d.px ? [CAP.approve] : [])] },
      nextTimestamp: () => (used = clock()),
      responseTimeoutMs: 8000,
    });
    if (used) await d.update((x) => ({ ...x, ikTs: Math.max(x.ikTs, used) }));
    if (!s) return { why: whyCode('session', link.closed ? 'closed' : 'no_answer') };
    stage = 'live';
    await d.update((x) => ({ ...x, lastSeenPc: Date.now() }));
    d.onLive?.();
    const held: Parameters<typeof s.channel.sendRaw>[0][] = [];
    const early = tapping(s.channel, held);
    const onCopy = (c: PhoneCopyBody) => d.update((x) => (x.pair?.pairId === pair.pairId ? { ...x, pcCopy: newerCopy(x.pcCopy, c) } : x));
    const copy = await receiveCopy(early, s.peerHello.capabilities).catch(() => null);
    if (copy) await onCopy(copy);
    const px = await enrollPx(early, s.peerHello.capabilities, { pairId: pair.pairId, deviceId: d.keys.deviceId, vm: d.keys.vm, px: d.px ?? null, onCopy }).catch(() => null);
    if (px) await d.update((x) => ({ ...x, px }));
    const flushed = await flushOutbox(early, d.outbox);
    if (flushed.sent.length) {
      const sent = new Set(flushed.sent);
      await d.update((x) => ({
        ...x,
        cash: x.cash.map((c) => (sent.has(c.msgId) ? { ...c, state: 'sent' as const } : c)),
        recent: x.recent.map((r) => (sent.has(r.msgId) ? { ...r, state: 'sent' as const } : r)),
      }));
    }
    await driveCmds(replaying(s.channel, held), s.peerHello.capabilities, {
      cmds: () => d.data().cmds ?? [],
      save: (f) => d.update((x) => ({ ...x, cmds: trimCmds(f(x.cmds ?? [])) })),
      onCopy,
      alive: d.alive,
    });
    s.channel.close();
    if (!link.closed && (!d.alive || d.alive())) {
      hold(link, true);
      link = null;
    }
    return { status: 'online', flushed };
  } catch (e) {
    return { why: whyCode(stage, causeOf(e)) };
  } finally {
    noise.destroy();
    if (link) {
      link.close();
      if (liveLink === link) liveLink = null;
    } else liveLink = null;
  }
}

/** 다른 PC로 옮기기 전에 예전 PC의 우편함에 떠난다고 남긴다. 예전 PC는 켜지면 이 폰을 목록에서 뺀다. 실패해도 옮기기는 막지 않는다. */
export async function leavePc(d: Pick<SyncDeps, 'keys' | 'data' | 'update'>, pair: Pair): Promise<boolean> {
  const vm = softSigner(d.keys.vm, VM_PURPOSES);
  try {
    const q = relayQueue({
      http: fetchJson,
      origin: queueOrigin(pair),
      mbxId: fromB64(pair.mbxId),
      tok: { read: fromB64(pair.tokRead), write: fromB64(pair.tokWrite) },
      deviceAuth: deviceAuthFor(pair.pairId, pair.cert, d.keys.vm),
    });
    const field = await q.getBundle();
    const bundle = field ? verifyQBundle(field, fromB64(pair.desktopVd), { minSeq: d.data().qbundleSeq }) : null;
    if (!bundle) return false;
    const seq = d.data().queueSeq + 1;
    await d.update((x) => ({ ...x, queueSeq: Math.max(x.queueSeq, seq) }));
    return (await queueLeave({ queue: q, pairId: pair.pairId, vm, bundle, mbxEpoch: pair.mbxEpoch, nextSeq: () => seq })) === 'ok';
  } catch {
    return false;
  } finally {
    vm.destroy();
  }
}

/**
 * 큐(HTTPS)는 실시간 연결(WSS) 호스트가 아니라 공개 주소로 부른다. 릴레이는 HTTPS 기기 확인을 공개 주소로만 받아서,
 * rooms 호스트로 부르면 401(queue.bundle_401)로 막혀 PC가 꺼져 있을 때 아무것도 맡기지 못했다(11-23 실기기).
 */
function queueOrigin(pair: Pair): string {
  return DEV_STACK && pair.relayHost === DEV_RELAY_HOST ? relayOrigin(pair.relayHost, true) : PUBLIC_ORIGIN;
}

async function viaQueue(d: SyncDeps, pair: Pair): Promise<SyncResult> {
  const vm = softSigner(d.keys.vm, VM_PURPOSES);
  try {
    const origin = queueOrigin(pair);
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
    const items = await d.outbox.list();
    const cmds = cmdsToQueue(d.data().cmds ?? [], QUEUE.ttlMs);
    const need = cmds.length + items.reduce((n, it) => n + (it.kind === 'cash' ? 1 : 1 + Math.ceil(it.offer.bytes / QUEUE.chunk)), 0);
    if (need === 0) return { status: 'offline' };
    const start = d.data().queueSeq;
    await d.update((x) => ({ ...x, queueSeq: Math.max(x.queueSeq, start) + need }));
    let next = start;
    const send = { queue: q, pairId: pair.pairId, vm, bundle, mbxEpoch: pair.mbxEpoch, nextSeq: () => ++next };
    const cmdsQueued: string[] = [];
    for (const c of cmds) if ((await queueCmd(issueCmd(c.cmdId, c.req), send).catch(() => 'failed' as const)) === 'ok') cmdsQueued.push(c.cmdId);
    if (cmdsQueued.length) {
      const at = Date.now();
      const done = new Set(cmdsQueued);
      await d.update((x) => ({ ...x, cmds: (x.cmds ?? []).map((c) => (done.has(c.cmdId) ? { ...c, queuedAt: at } : c)) }));
    }
    const queued = await queueOutbox(d.outbox, send);
    const done = new Set(queued.queued);
    if (done.size) {
      await d.update((x) => ({
        ...x,
        cash: x.cash.map((c) => (done.has(c.msgId) && c.state === 'pending' ? { ...c, state: 'queued' as const } : c)),
        recent: x.recent.map((r) => (done.has(r.msgId) && r.state === 'pending' ? { ...r, state: 'queued' as const } : r)),
      }));
    }
    return { status: cmdsQueued.length || queued.queued.length || !queued.waiting.length ? 'queued' : 'offline', queued };
  } catch (e) {
    return { status: 'offline', why: whyCode('queue', causeOf(e)) };
  } finally {
    vm.destroy();
  }
}

