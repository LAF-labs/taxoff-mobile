import {
  CAP, QUEUE, flushOutbox, fromB64, monotonicClock, openMobileSession, queueOutbox, relayOrigin, relayQueue, softNoiseStatic, softSigner, verifyQBundle,
  wsRelayClient, VM_PURPOSES, type FlushResult, type Link, type PhoneCopyBody, type QueueSendResult, type WebSocketLike,
} from '@sax/remote';
import { APP_VERSION, DEV_RELAY_HOST, DEV_STACK } from '../config';
import { deviceAuthFor, fetchJson, type Htm } from './devauth';
import type { DeviceKeys } from '../keyring';
import type { FileOutbox } from '../storage/outbox';
import type { AppData } from '../storage/state';
import { PHONE_CAPS, newerCopy, receiveCopy } from './pcCopy';
import { driveCmds, trimCmds } from './issueLive';
import { enrollPx } from './pxLive';
import type { PxDevice } from '../approvalKey';
import { replaying, tapping } from './hold';
import { causeOf, pushWhy, whyCode } from './pcWhy';

export type PcStatus = 'unpaired' | 'connecting' | 'online' | 'queued' | 'stale' | 'offline';

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
  const live = await viaLive(d, pair);
  if ('status' in live) return live;
  if (d.alive && !d.alive()) return { status: 'offline', why: live.why };
  const q = await viaQueue(d, pair);
  const why = q.why ?? live.why;
  await d.update((x) => ({ ...x, pcLog: pushWhy(x.pcLog, { code: why, at: Date.now() }) })).catch(() => undefined);
  return { ...q, why };
}

type Pair = NonNullable<AppData['pair']>;

let liveLink: Link | null = null;

export function closeLive(): void {
  liveLink?.close();
}

async function viaLive(d: SyncDeps, pair: Pair): Promise<SyncResult | { why: string }> {
  let link: Link | null = null;
  const noise = softNoiseStatic(d.keys.sm);
  let stage: 'join' | 'session' | 'live' = 'join';
  try {
    const relay = relayFor(pair.relayHost, deviceAuthFor(pair.pairId, pair.cert, d.keys.vm));
    link = await relay.joinMailbox(fromB64(pair.mbxId), { read: fromB64(pair.tokRead), write: fromB64(pair.tokWrite) }, 'mobile');
    liveLink = link;
    if (!(await waitPeer(link, PEER_WAIT_MS))) return { why: whyCode('peer', link.closed ? 'closed' : 'timeout') };
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
    const copy = await receiveCopy(early, s.peerHello.capabilities).catch(() => null);
    if (copy) await d.update((x) => ({ ...x, pcCopy: newerCopy(x.pcCopy, copy) }));
    const onCopy = (c: PhoneCopyBody) => d.update((x) => ({ ...x, pcCopy: newerCopy(x.pcCopy, c) }));
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
    return { status: 'online', flushed };
  } catch (e) {
    return { why: whyCode(stage, causeOf(e)) };
  } finally {
    noise.destroy();
    link?.close();
    if (liveLink === link) liveLink = null;
  }
}

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
