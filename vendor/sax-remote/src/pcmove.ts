import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal, toHex, utf8 } from './bytes.ts';
import { CTX } from './contexts.ts';
import { encodeHs, KIND, parseFrame, Transport } from './frame.ts';
import type { NoiseStatic } from './keys.ts';
import { Handshake } from './noise.ts';
import { attachQueue, nextFrame, queuedFrame, type Link } from './relay.ts';

/** ADR-055 개정(ADR-070 결정 8): 쓰던 PC가 새 PC로 기록 묶음을 룸 하나로 바로 보낸다. 서버는 프레임을 넘기기만 한다. */

export const MOVE_CHUNK = 60 * 1024;
export const MOVE_MAX_BYTES = 600 * 1024 * 1024;
export const MOVE_WINDOW = 256;
export const MOVE_ACK_EVERY = 64;
/** 룸 프레임 한도(services/relay msgPerSecPerMailbox 20, 두 방향 합)보다 낮게. */
export const MOVE_FRAMES_PER_SEC = 15;
/** 넣는 동안 룸이 쉬는 연결로 닫히지 않게(services/relay 쉬는 시간 120초). */
export const MOVE_KEEPALIVE_MS = 20_000;

const TAG = { manifest: 1, chunk: 2, ack: 3, result: 4 } as const;
type Tag = (typeof TAG)[keyof typeof TAG];

export interface MoveEnds {
  requestId: string;
  fromDeviceId: string;
  toDeviceId: string;
}

export interface MoveManifest {
  v: 1;
  schema: number;
  bytes: number;
  sha256: string;
  chunks: number;
  counts: Record<string, number>;
}

export type MoveRefusal = 'schema_newer' | 'bad_bundle' | 'import_failed' | 'too_big';
export type MoveResult = { state: 'stored'; counts: Record<string, number> } | { state: 'refused'; reason: MoveRefusal };

export const movePrologue = (e: MoveEnds): Uint8Array => concat(utf8(CTX.move), utf8(`${e.requestId}\0${e.fromDeviceId}\0${e.toDeviceId}`));

export const moveChunkCount = (bytes: number): number => Math.ceil(bytes / MOVE_CHUNK);

export class MovePipe {
  readonly #link: Link;
  readonly #tx: Transport;
  constructor(link: Link, tx: Transport) {
    this.#link = link;
    this.#tx = tx;
  }
  get closed(): boolean {
    return this.#link.closed;
  }
  send(tag: Tag, body: Uint8Array): void {
    this.#link.send(this.#tx.seal(concat(Uint8Array.of(tag), body)));
  }
  sendJson(tag: Tag, v: unknown): void {
    this.send(tag, utf8(JSON.stringify(v)));
  }
  poll(): { tag: number; body: Uint8Array } | null {
    for (let f = queuedFrame(this.#link); f; f = queuedFrame(this.#link)) {
      const m = this.#open(f);
      if (m) return m;
    }
    return null;
  }
  #open(f: Uint8Array): { tag: number; body: Uint8Array } | null {
    const inner = this.#tx.open(f);
    return inner && inner.length >= 1 ? { tag: inner[0]!, body: inner.subarray(1) } : null;
  }
  async recv(timeoutMs: number): Promise<{ tag: number; body: Uint8Array } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return null;
      const f = await nextFrame(this.#link, left);
      if (!f) return null;
      const m = this.#open(f);
      if (m) return m;
    }
  }
  close(): void {
    this.#tx.destroy();
    this.#link.close();
  }
}

/** [새 PC] 쓰던 PC(목록의 Sx)에게 IK를 연다. 답이 없거나 키가 틀리면 null. */
export async function openMoveReceiver(link: Link, o: MoveEnds & { noise: NoiseStatic; senderStatic: Uint8Array; timeoutMs?: number }): Promise<MovePipe | null> {
  attachQueue(link);
  try {
    const hs = new Handshake({ pattern: 'IK', initiator: true, ctx: CTX.move, s: o.noise, rs: o.senderStatic, prologue: movePrologue(o) });
    link.send(encodeHs(await hs.writeMessage()));
    const f = await nextFrame(link, o.timeoutMs ?? 30_000);
    const p = f ? parseFrame(f) : null;
    if (!p || p.kind !== KIND.HS) return null;
    await hs.readMessage(p.body);
    return new MovePipe(link, new Transport(hs.split()));
  } catch {
    return null;
  }
}

/** [쓰던 PC] 새 PC의 msg1을 받아, 그 정적 키가 요청한 기기(목록의 Sx)인지 본다. 아니면 무응답(null). */
export async function acceptMoveSender(link: Link, o: MoveEnds & { noise: NoiseStatic; receiverStatic: Uint8Array; timeoutMs?: number }): Promise<MovePipe | null> {
  attachQueue(link);
  try {
    const f = await nextFrame(link, o.timeoutMs ?? 120_000);
    const p = f ? parseFrame(f) : null;
    if (!p || p.kind !== KIND.HS) return null;
    const hs = new Handshake({ pattern: 'IK', initiator: false, ctx: CTX.move, s: o.noise, prologue: movePrologue(o) });
    await hs.readMessage(p.body);
    const rs = hs.remoteStatic;
    if (!rs || !equal(rs, o.receiverStatic)) return null;
    link.send(encodeHs(await hs.writeMessage()));
    return new MovePipe(link, new Transport(hs.split()));
  } catch {
    return null;
  }
}

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const readU32 = (b: Uint8Array) => ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
const json = (b: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b));
  } catch {
    return null;
  }
};

const isCounts = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, n]) => /^[a-z_]{1,40}$/.test(k) && Number.isSafeInteger(n) && (n as number) >= 0);

export function parseMoveManifest(v: unknown): MoveManifest | null {
  const m = v as Partial<MoveManifest> | null;
  if (!m || typeof m !== 'object' || m.v !== 1) return null;
  if (!Number.isSafeInteger(m.schema) || (m.schema as number) < 1) return null;
  if (!Number.isSafeInteger(m.bytes) || (m.bytes as number) < 1 || (m.bytes as number) > MOVE_MAX_BYTES) return null;
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
  if (m.chunks !== moveChunkCount(m.bytes as number) || !isCounts(m.counts)) return null;
  return { v: 1, schema: m.schema as number, bytes: m.bytes as number, sha256: m.sha256, chunks: m.chunks, counts: { ...m.counts } };
}

function parseResult(v: unknown): MoveResult | null {
  const r = v as { state?: unknown; counts?: unknown; reason?: unknown } | null;
  if (r?.state === 'stored' && isCounts(r.counts)) return { state: 'stored', counts: r.counts };
  if (r?.state === 'refused' && (r.reason === 'schema_newer' || r.reason === 'bad_bundle' || r.reason === 'import_failed' || r.reason === 'too_big')) return { state: 'refused', reason: r.reason };
  return null;
}

export interface MoveSource {
  manifest: MoveManifest;
  chunk(index: number): Promise<Uint8Array>;
}

export interface SendMoveOptions {
  pace?: () => Promise<void>;
  ackTimeoutMs?: number;
  resultTimeoutMs?: number;
  onProgress?: (sent: number, total: number) => void;
}

const defaultPace = () => new Promise<void>((r) => setTimeout(r, 1000 / MOVE_FRAMES_PER_SEC));

/** [쓰던 PC] 목록을 보내고 조각을 창(MOVE_WINDOW) 안에서 보낸다. 받는 쪽이 빠진 곳을 알리면 거기서 다시 보낸다. 끊기면 null. */
export async function sendMove(pipe: MovePipe, src: MoveSource, o: SendMoveOptions = {}): Promise<MoveResult | null> {
  const pace = o.pace ?? defaultPace;
  const ackTimeout = o.ackTimeoutMs ?? 60_000;
  const resultTimeout = o.resultTimeoutMs ?? 30 * 60_000;
  const total = src.manifest.chunks;
  pipe.sendJson(TAG.manifest, src.manifest);
  let next = 0;
  let acked = 0;
  const take = (m: { tag: number; body: Uint8Array }): MoveResult | null => {
    if (m.tag === TAG.result) return parseResult(json(m.body));
    if (m.tag !== TAG.ack) return null;
    const n = (json(m.body) as { next?: unknown } | null)?.next;
    if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > total) return null;
    acked = n as number;
    if (acked < next) next = acked;
    return null;
  };
  while (!pipe.closed) {
    const blocked = next >= total || next - acked >= MOVE_WINDOW;
    const m = blocked ? await pipe.recv(acked >= total ? resultTimeout : ackTimeout) : pipe.poll();
    if (m) {
      const r = take(m);
      if (r) return r;
      continue;
    }
    if (blocked) return null;
    const data = await src.chunk(next);
    pipe.send(TAG.chunk, concat(u32(next), data));
    next++;
    o.onProgress?.(next, total);
    await pace();
  }
  return null;
}

export interface MoveSink {
  open(m: MoveManifest): Promise<MoveRefusal | null>;
  write(index: number, data: Uint8Array): Promise<void>;
  finish(): Promise<MoveResult>;
  abort(): Promise<void>;
}

/** [새 PC] 목록을 받아 순서대로 쓰고, 다 받으면 SHA-256을 맞춘 뒤 넣고(sink.finish) 결과를 돌려 보낸다. 끊기면 abort 뒤 null. */
export async function receiveMove(pipe: MovePipe, sink: MoveSink, o: { idleMs?: number; onProgress?: (got: number, total: number) => void } = {}): Promise<MoveResult | null> {
  const idle = o.idleMs ?? 90_000;
  const first = await pipe.recv(idle);
  const manifest = first?.tag === TAG.manifest ? parseMoveManifest(json(first.body)) : null;
  if (!manifest) return null;
  const refused = await sink.open(manifest);
  if (refused) {
    const r: MoveResult = { state: 'refused', reason: refused };
    pipe.sendJson(TAG.result, r);
    return r;
  }
  const hash = sha256.create();
  let next = 0;
  let bytes = 0;
  let asked = -1;
  try {
    while (next < manifest.chunks) {
      const m = await pipe.recv(idle);
      if (!m) return (await sink.abort(), null);
      if (m.tag !== TAG.chunk || m.body.length < 5) continue;
      const index = readU32(m.body);
      if (index !== next) {
        if (index > next && asked !== next) {
          asked = next;
          pipe.sendJson(TAG.ack, { next });
        }
        continue;
      }
      const data = m.body.subarray(4);
      const want = index === manifest.chunks - 1 ? manifest.bytes - index * MOVE_CHUNK : MOVE_CHUNK;
      if (data.length !== want) return refuse(pipe, sink, 'bad_bundle');
      await sink.write(index, data);
      hash.update(data);
      bytes += data.length;
      next++;
      o.onProgress?.(next, manifest.chunks);
      if (next % MOVE_ACK_EVERY === 0 || next === manifest.chunks) pipe.sendJson(TAG.ack, { next });
    }
    if (bytes !== manifest.bytes || toHex(hash.digest()) !== manifest.sha256) return refuse(pipe, sink, 'bad_bundle');
    const keepalive = setInterval(() => pipe.sendJson(TAG.ack, { next }), MOVE_KEEPALIVE_MS);
    try {
      const r = await sink.finish();
      pipe.sendJson(TAG.result, r);
      return r;
    } finally {
      clearInterval(keepalive);
    }
  } catch {
    return refuse(pipe, sink, 'import_failed');
  }
}

async function refuse(pipe: MovePipe, sink: MoveSink, reason: MoveRefusal): Promise<MoveResult> {
  await sink.abort();
  const r: MoveResult = { state: 'refused', reason };
  if (!pipe.closed) pipe.sendJson(TAG.result, r);
  return r;
}

