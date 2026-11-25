import { DOC_CHUNK_MAX, DOC_ID, DOC_MAX_CHUNKS, DOC_RECORD_MAX_CHARS, SHARE_MAX_EPOCH, fromB64url } from '@sax/remote';
import { accountOrigin } from './account';
import { fetchJson, type Htm } from './devauth';

/** 계정 서비스 문서함 경로(ADR-064, services/account/API.md "문서함 계정 사본"). 폰은 읽기만 한다. */
export interface DocEntry {
  docId: string;
  seq: number;
  state: 'ready' | 'deleted';
  rev: number;
  epoch: number;
  chunks: number;
  record: string | null;
}
export interface DocPage {
  docs: DocEntry[];
  head: number;
  more: boolean;
}

/** 실패 이유: 서버 오류 코드 그대로, 연결이 안 되면 'net', 답 모양이 틀리면 'shape'. */
export class DocsError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`docs: ${code}`);
    this.code = code;
  }
}

export type DocsAuth = (htm: Htm, htu: string) => Promise<Record<string, string>>;

const B64URL = /^[A-Za-z0-9_-]+$/;
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shape = (): never => {
  throw new DocsError('shape');
};

async function get(auth: DocsAuth, url: string): Promise<unknown> {
  let res;
  try {
    res = await fetchJson({ method: 'GET', url, headers: await auth('GET', url) });
  } catch {
    throw new DocsError('net');
  }
  if (res.status === 200) return res.body;
  const code = isObj(res.body) && typeof res.body.error === 'string' ? res.body.error : `http_${res.status}`;
  throw new DocsError(code);
}

function entry(v: unknown): DocEntry {
  if (!isObj(v) || typeof v.docId !== 'string' || !DOC_ID.test(v.docId) || !int(v.seq) || v.seq < 1 || (v.state !== 'ready' && v.state !== 'deleted')) return shape();
  if (!int(v.rev) || v.rev < 0 || !int(v.epoch) || v.epoch < 0 || v.epoch > SHARE_MAX_EPOCH || !int(v.chunks) || v.chunks < 1 || v.chunks > DOC_MAX_CHUNKS) return shape();
  const record = v.record;
  if (v.state === 'ready' ? typeof record !== 'string' || record.length > DOC_RECORD_MAX_CHARS || !B64URL.test(record) : record !== null) return shape();
  return { docId: v.docId, seq: v.seq, state: v.state, rev: v.rev, epoch: v.epoch, chunks: v.chunks, record: record as string | null };
}

/** after보다 큰 순번을 순서대로 한 쪽(최대 200개). */
export async function listDocs(auth: DocsAuth, after: number): Promise<DocPage> {
  const url = after === 0 ? `${accountOrigin()}/v1/docs` : `${accountOrigin()}/v1/docs/after/${after}`;
  const b = await get(auth, url);
  if (!isObj(b) || !Array.isArray(b.docs) || !int(b.head) || typeof b.more !== 'boolean') return shape();
  const docs = b.docs.map(entry);
  let last = after;
  for (const d of docs) {
    if (d.seq <= last) return shape();
    last = d.seq;
  }
  return { docs, head: b.head, more: b.more };
}

export async function getChunk(auth: DocsAuth, docId: string, n: number): Promise<Uint8Array> {
  if (!DOC_ID.test(docId) || !int(n) || n < 0 || n >= DOC_MAX_CHUNKS) throw new DocsError('shape');
  const b = await get(auth, `${accountOrigin()}/v1/docs/${docId}/chunks/${n}`);
  if (!isObj(b) || typeof b.data !== 'string' || !B64URL.test(b.data)) return shape();
  const data = fromB64url(b.data);
  if (!data.length || data.length > DOC_CHUNK_MAX) return shape();
  return data;
}
