import { CAP, DocAssembler, DocListCollector, type DocChunkBody, type DocListBody, type DocListItem } from '@sax/remote';
import { dropAll, hasDoc, itemOf, loadIndex, removeDoc, saveIndex, storeDoc, type DocIndex } from '../docs/box';


interface Recv<E> {
  recv(timeoutMs: number): Promise<E | null>;
}
interface Env {
  type: string;
  body?: unknown;
}

export interface DocsInbox {
  list: DocListItem[] | null;
  chunks: DocChunkBody[];
}

export const newDocsInbox = (): DocsInbox => ({ list: null, chunks: [] });

export function catchingDocs<C extends Recv<E>, E extends Env>(ch: C, inbox: DocsInbox): C {
  const pages = new DocListCollector();
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') {
        return async (ms: number) => {
          const until = Date.now() + ms;
          for (;;) {
            const e = await t.recv(Math.max(0, until - Date.now()));
            if (!e || (e.type !== 'doc.list' && e.type !== 'doc.chunk')) return e;
            if (e.type === 'doc.list') {
              const all = pages.add(e.body as DocListBody);
              if (all) inbox.list = all;
            } else inbox.chunks.push(e.body as DocChunkBody);
          }
        };
      }
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

interface Sender {
  closed: boolean;
  send(type: 'doc.want', body: { docId: string }): unknown;
}

const LIST_WAIT_MS = 3000;
const CHUNK_IDLE_MS = 8000;
const BUDGET_MS = 90_000;

export interface DocsSyncResult {
  state: 'skipped' | 'no_list' | 'ok' | 'partial';
  got: number;
  removed: number;
  bad: number;
}

async function pump<E extends Env>(ch: Recv<E>, ms: number, done: () => boolean): Promise<void> {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until) await ch.recv(Math.min(500, Math.max(0, until - Date.now())));
}

export async function syncDocs<E extends Env>(o: {
  ch: Recv<E> & Sender;
  peerCaps: readonly string[];
  inbox: DocsInbox;
  pairId: string;
  fileKey: Uint8Array;
  alive?: () => boolean;
  log?: (step: string, data?: Record<string, number>) => void;
}): Promise<DocsSyncResult> {
  const out: DocsSyncResult = { state: 'skipped', got: 0, removed: 0, bad: 0 };
  if (!o.peerCaps.includes(CAP.docs)) return out;
  const live = () => !o.ch.closed && (!o.alive || o.alive());
  if (!o.inbox.list) await pump(o.ch, LIST_WAIT_MS, () => !!o.inbox.list || !live());
  const list = o.inbox.list;
  if (!list) return { ...out, state: 'no_list' };
  let have = await loadIndex(o.fileKey);
  if (have && have.pairId !== o.pairId) {
    dropAll();
    have = null;
  }
  const listed = new Set(list.map((it) => it.docId));
  const kept = (have?.items ?? []).filter((it) => {
    const keep = listed.has(it.docId) && list.find((x) => x.docId === it.docId)!.sha256 === it.sha256 && hasDoc(it.docId);
    if (!keep) {
      removeDoc(it.docId);
      if (!listed.has(it.docId)) out.removed++;
    }
    return keep;
  });
  const index: DocIndex = { v: 2, pairId: o.pairId, items: kept, ...(have?.syncedAt ? { syncedAt: have.syncedAt } : {}) };
  if (out.removed || !have) await saveIndex(o.fileKey, index);
  const missing = list.filter((it) => !kept.some((k) => k.docId === it.docId));
  const started = Date.now();
  for (const it of missing) {
    if (!live() || Date.now() - started > BUDGET_MS) break;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok && live(); attempt++) {
      const asm = new DocAssembler(it);
      o.inbox.chunks = [];
      o.ch.send('doc.want', { docId: it.docId });
      let state: 'more' | 'done' | 'bad' = 'more';
      let bytes: Uint8Array | null = null;
      while (state === 'more' && live()) {
        const c = o.inbox.chunks.shift();
        if (!c) {
          await pump(o.ch, CHUNK_IDLE_MS, () => o.inbox.chunks.length > 0 || !live());
          if (!o.inbox.chunks.length) break;
          continue;
        }
        if (c.docId !== it.docId) continue;
        const r = asm.add(c);
        state = r.state;
        if (r.state === 'done') bytes = r.bytes;
      }
      if (bytes) {
        await storeDoc(o.fileKey, it.docId, bytes);
        index.items = [...index.items.filter((x) => x.docId !== it.docId), itemOf(it)];
        await saveIndex(o.fileKey, index);
        out.got++;
        ok = true;
      } else if (state === 'bad') out.bad++;
      else break;
    }
  }
  out.state = index.items.length === list.length ? 'ok' : 'partial';
  if (out.state === 'ok') await saveIndex(o.fileKey, { ...index, syncedAt: new Date().toISOString() });
  o.log?.('docs', { got: out.got, removed: out.removed, bad: out.bad, left: list.length - index.items.length });
  return out;
}
