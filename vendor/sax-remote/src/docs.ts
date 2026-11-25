import { b64url, concat, fromB64url, fromUtf8, toHex, utf8 } from './bytes.ts';
import { CTX } from './contexts.ts';
import { ed25519Verify, hkdfSha256, randomBytes, sha256Hash, xOpen, xSeal } from './crypto.ts';
import { jcs, jcsBytes } from './jcs.ts';
import { SHARE_MAX_EPOCH, type ShareSign } from './share.ts';

/**
 * 문서함 계정 사본(ADR-064). PC가 보관함 PDF를 문서마다 무작위 열쇠(DEK)로 조각 봉인해 올리고,
 * DEK와 이름·종류·날짜는 문서 기록에 넣어 K_doc(e)로 봉인하고 Ws로 서명한다. 서버는 암호문과 크기만 본다.
 */

/** 조각 하나의 평문 크기. Vercel 함수 본문 4.5MB 안에 base64로 들어간다. */
export const DOC_CHUNK_PLAIN = 1 << 20;
/** 조각 하나의 암호문 크기 상한(논스 24 + 태그 16). 마지막 조각만 짧을 수 있다. */
export const DOC_CHUNK_MAX = DOC_CHUNK_PLAIN + 40;
/** 문서 하나의 조각 수 상한. 보관함 상한(15MB)을 Padmé로 채워도 16조각 안이다. */
export const DOC_MAX_CHUNKS = 16;
/** 문서 하나의 평문 상한(엔진 보관함과 같다). */
export const DOC_MAX_BYTES = 15 * 1024 * 1024;
/** 기록 평문 패딩 버킷(바이트). 이름 길이가 크기로 새지 않게 한다. */
export const DOC_RECORD_BUCKETS = [1024, 2048] as const;
/** 기록 암호문(b64url) 최대 길이. 계정 서비스 DOCS.recordMaxChars와 같다. */
export const DOC_RECORD_MAX_CHARS = Math.ceil(((DOC_RECORD_BUCKETS[DOC_RECORD_BUCKETS.length - 1]! + 40) * 4) / 3);
export const DOC_ID = /^[A-Za-z0-9_-]{22}$/;

const DOC_KEY_INFO = 'doc/v1';
const DOC_TYPE = /^[a-z][a-z0-9_]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64U32 = /^[A-Za-z0-9_-]{43}$/;

export const newDocId = (): string => b64url(randomBytes(16));
export const newDocKey = (): Uint8Array => randomBytes(32);
/** K_doc(e) = HKDF-SHA256(K_share(e), "doc/v1"). 폰은 share.key로 받은 K_share(e)에서 같은 값을 만든다. */
export const docRecordKey = (shareKey: Uint8Array): Uint8Array => {
  if (shareKey.length !== 32) throw new Error('docs: share key');
  return hkdfSha256(shareKey, DOC_KEY_INFO, 32);
};

/** 기록 속 문서 정보. 서버는 보지 못한다. */
export interface DocBody {
  name: string;
  docType: string;
  issuedOn: string | null;
  expiresOn: string | null;
  bytes: number;
  sha256: string;
  dek: string;
  chunks: number;
  src: 'app' | 'import';
}
/** 서명되는 기록의 속. t는 계정 공유 기록 줄(같은 Ws 서명)과 모양이 겹치지 않게 한다. */
export interface DocRecordCore {
  t: 'doc';
  v: 1;
  doc_id: string;
  rev: number;
  epoch: number;
  at: number;
  dev: string;
  body: DocBody;
}
/** 서버에 올리는 모양(계정 서비스 PUT /v1/docs/:docId/record). */
export interface DocRecordWire {
  docId: string;
  rev: number;
  epoch: number;
  record: string;
}

/**
 * Padmé 길이(Nikitin 외, PURBs 2019): 길이 L을 지수의 비트 수만큼만 남기고 올린다. 늘어나는 양은 최대 약 12%이고,
 * 서버는 크기 등급만 본다. L은 표시 바이트(0x80) 하나를 더한 값이다.
 */
export function padmeLength(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('docs: length');
  if (n < 2) return n;
  const e = Math.floor(Math.log2(n));
  const s = Math.floor(Math.log2(e)) + 1;
  const mask = 2 ** (e - s) - 1;
  return Math.ceil(n / (mask + 1)) * (mask + 1);
}

/** 이 평문 길이가 서버에서 차지할 조각 수와 암호문 바이트 합. */
export function docBlobSize(plainBytes: number): { chunks: number; blobBytes: number } {
  if (!Number.isSafeInteger(plainBytes) || plainBytes < 1 || plainBytes > DOC_MAX_BYTES) throw new Error('docs: size');
  const padded = padmeLength(plainBytes + 1);
  const chunks = Math.ceil(padded / DOC_CHUNK_PLAIN);
  return { chunks, blobBytes: padded + chunks * 40 };
}

const u32be = (n: number): Uint8Array => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunkAad = (docId: string, i: number, n: number): Uint8Array => concat(utf8(CTX.docBlob), utf8(docId), u32be(i), u32be(n));

/** PDF를 Padmé로 채워 조각마다 DEK로 봉인한다. aad에 doc_id, 순번, 조각 수가 있어 맞바꾸기·자르기·순서 바꾸기가 열리지 않는다. */
export function sealDocBlob(dek: Uint8Array, docId: string, plain: Uint8Array): Uint8Array[] {
  if (dek.length !== 32 || !DOC_ID.test(docId)) throw new Error('docs: blob args');
  const { chunks } = docBlobSize(plain.length);
  const padded = new Uint8Array(padmeLength(plain.length + 1));
  padded.set(plain);
  padded[plain.length] = 0x80;
  const out: Uint8Array[] = [];
  for (let i = 0; i < chunks; i++) out.push(xSeal(dek, padded.subarray(i * DOC_CHUNK_PLAIN, Math.min(padded.length, (i + 1) * DOC_CHUNK_PLAIN)), chunkAad(docId, i, chunks)));
  padded.fill(0);
  return out;
}

export type DocBlobOpen = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'shape' | 'key' | 'pad' | 'hash' };

/** 받은 조각을 열고 길이와 sha256을 기록과 대조한다. 서버가 준 입력이라 던지지 않는다. */
export function openDocBlob(dek: Uint8Array, docId: string, chunks: readonly Uint8Array[], expect: { bytes: number; sha256: string }): DocBlobOpen {
  try {
    if (dek.length !== 32 || !DOC_ID.test(docId) || !chunks.length || chunks.length > DOC_MAX_CHUNKS) return { ok: false, reason: 'shape' };
    const size = docBlobSize(expect.bytes);
    if (size.chunks !== chunks.length || chunks.reduce((a, c) => a + c.length, 0) !== size.blobBytes) return { ok: false, reason: 'shape' };
    const parts: Uint8Array[] = [];
    for (const [i, c] of chunks.entries()) {
      try {
        parts.push(xOpen(dek, c, chunkAad(docId, i, chunks.length)));
      } catch {
        return { ok: false, reason: 'key' };
      }
    }
    const padded = concat(...parts);
    if (padded[expect.bytes] !== 0x80 || padded.subarray(expect.bytes + 1).some((b) => b !== 0)) return { ok: false, reason: 'pad' };
    const bytes = padded.slice(0, expect.bytes);
    padded.fill(0);
    if (toHex(sha256Hash(bytes)) !== expect.sha256) return { ok: false, reason: 'hash' };
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'shape' };
  }
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.normalize('NFC');
const dayOrNull = (v: unknown): boolean => v === null || (typeof v === 'string' && DAY.test(v));
const BODY_KEYS = ['name', 'docType', 'issuedOn', 'expiresOn', 'bytes', 'sha256', 'dek', 'chunks', 'src'] as const;
const CORE_KEYS = ['t', 'v', 'doc_id', 'rev', 'epoch', 'at', 'dev', 'body'] as const;

function checkBody(b: unknown): b is DocBody {
  if (!obj(b) || !only(b, BODY_KEYS) || !BODY_KEYS.every((k) => k in b)) return false;
  if (!str(b.name, 100) || typeof b.docType !== 'string' || !DOC_TYPE.test(b.docType) || !dayOrNull(b.issuedOn) || !dayOrNull(b.expiresOn)) return false;
  if (!Number.isSafeInteger(b.bytes) || (b.bytes as number) < 1 || (b.bytes as number) > DOC_MAX_BYTES) return false;
  if (typeof b.sha256 !== 'string' || !SHA256_HEX.test(b.sha256) || typeof b.dek !== 'string' || !B64U32.test(b.dek)) return false;
  if (b.chunks !== docBlobSize(b.bytes as number).chunks) return false;
  return b.src === 'app' || b.src === 'import';
}
function checkCore(c: unknown): c is DocRecordCore {
  if (!obj(c) || !only(c, CORE_KEYS) || c.t !== 'doc' || c.v !== 1 || typeof c.doc_id !== 'string' || !DOC_ID.test(c.doc_id)) return false;
  if (!Number.isSafeInteger(c.rev) || (c.rev as number) < 1 || !Number.isSafeInteger(c.epoch) || (c.epoch as number) < 0 || (c.epoch as number) > SHARE_MAX_EPOCH) return false;
  if (!Number.isSafeInteger(c.at) || (c.at as number) <= 0 || typeof c.dev !== 'string' || !UUID.test(c.dev)) return false;
  return checkBody(c.body);
}

const recordAad = (w: { docId: string; epoch: number; rev: number }): Uint8Array => concat(utf8(CTX.docRecord), jcsBytes({ doc_id: w.docId, epoch: w.epoch, rev: w.rev }));
const coreOf = (c: DocRecordCore): DocRecordCore => ({ t: 'doc', v: 1, doc_id: c.doc_id, rev: c.rev, epoch: c.epoch, at: c.at, dev: c.dev, body: { ...c.body } });

function padRecord(p: Uint8Array): Uint8Array {
  const bucket = DOC_RECORD_BUCKETS.find((b) => b >= p.length + 1);
  if (bucket === undefined) throw new Error('docs: record too large');
  const out = new Uint8Array(bucket);
  out.set(p);
  out[p.length] = 0x80;
  return out;
}
function unpadRecord(p: Uint8Array): Uint8Array | null {
  if (!(DOC_RECORD_BUCKETS as readonly number[]).includes(p.length)) return null;
  let i = p.length - 1;
  while (i >= 0 && p[i] === 0) i--;
  return i >= 0 && p[i] === 0x80 ? p.subarray(0, i) : null;
}

/** 기록을 Ws로 서명하고 K_doc(e)로 봉인한다. shareKey는 그 세대의 K_share(e)다. 모양이 틀리면 던진다(올리기 전에 막는다). */
export async function sealDocRecord(shareKey: Uint8Array, core: DocRecordCore, sign: ShareSign): Promise<DocRecordWire> {
  if (!checkCore(core)) throw new Error('docs: record shape');
  const c = coreOf(core);
  const sig = await sign(jcsBytes(c));
  if (sig.length !== 64) throw new Error('docs: signature');
  const key = docRecordKey(shareKey);
  const wire = { docId: c.doc_id, rev: c.rev, epoch: c.epoch };
  try {
    return { ...wire, record: b64url(xSeal(key, padRecord(jcsBytes({ core: c, sig: b64url(sig) })), recordAad(wire))) };
  } finally {
    key.fill(0);
  }
}

export type DocRecordOpen = { ok: true; core: DocRecordCore } | { ok: false; reason: 'key' | 'shape' | 'mismatch' | 'signature' };

/** 받은 기록을 열고 Ws 서명을 확인한다. 서버가 준 입력이라 어떤 모양이 와도 던지지 않는다. */
export function openDocRecord(shareKey: Uint8Array, wire: DocRecordWire, signPub: Uint8Array): DocRecordOpen {
  let key: Uint8Array | null = null;
  try {
    if (shareKey.length !== 32 || signPub.length !== 32 || typeof wire.record !== 'string' || wire.record.length > DOC_RECORD_MAX_CHARS || !DOC_ID.test(wire.docId)) return { ok: false, reason: 'shape' };
    key = docRecordKey(shareKey);
    let padded: Uint8Array;
    try {
      padded = xOpen(key, fromB64url(wire.record), recordAad(wire));
    } catch {
      return { ok: false, reason: 'key' };
    }
    const plain = unpadRecord(padded);
    if (!plain) return { ok: false, reason: 'shape' };
    const text = fromUtf8(plain);
    const v: unknown = JSON.parse(text);
    if (jcs(v) !== text || !obj(v) || !only(v, ['core', 'sig']) || typeof v.sig !== 'string' || !checkCore(v.core)) return { ok: false, reason: 'shape' };
    const core = v.core;
    if (core.doc_id !== wire.docId || core.rev !== wire.rev || core.epoch !== wire.epoch) return { ok: false, reason: 'mismatch' };
    const sig = fromB64url(v.sig);
    if (sig.length !== 64 || !ed25519Verify(signPub, CTX.share, jcsBytes(core), sig)) return { ok: false, reason: 'signature' };
    return { ok: true, core };
  } catch {
    return { ok: false, reason: 'shape' };
  } finally {
    key?.fill(0);
  }
}

/** 기록의 DEK를 바이트로 돌려준다(쓴 뒤 지운다). */
export const docKeyOf = (body: DocBody): Uint8Array => fromB64url(body.dek);
