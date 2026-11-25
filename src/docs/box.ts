import { Directory, File, Paths } from 'expo-file-system';
import { fromB64url, fromUtf8, openDocBlob, openDocRecord, utf8, xOpen, xSeal, type ShareKeySet } from '@sax/remote';
import { DocsError, getChunk, listDocs, type DocsAuth } from '../net/docs';
import { currentEpoch, inflight, liveKey, sameEpoch } from '../inflight';
import { ROOT, deleteQuietly, writeProtected } from '../storage/files';

/**
 * 폰 문서함(ADR-064 결정 7): PC가 계정에 봉인해 둔 문서 기록을 받아 목록을 만들고, 누르면 조각을 받아 연다.
 * 목록(이름, 종류, 날짜, 문서 열쇠)은 이 폰 안에서만 열리고 앱 파일 열쇠로 봉인해 둔다. PDF는 열 때만 받고 닫으면 지운다.
 */
export interface DocItem {
  docId: string;
  rev: number;
  name: string;
  docType: string;
  issuedOn: string | null;
  expiresOn: string | null;
  bytes: number;
  sha256: string;
  dek: string;
  chunks: number;
}

export interface DocIndex {
  v: 1;
  /** 이 목록을 만든 연결과 계정 서명 키. 다르면 버리고 처음부터 받는다. */
  pairId: string;
  signPub: string;
  cursor: number;
  items: DocItem[];
}

export type DocKind = 'invoice' | 'cert' | 'other';
export const kindOf = (docType: string): DocKind => (docType === 'tax_invoice' ? 'invoice' : docType === 'other' ? 'other' : 'cert');

const AD = utf8('SAX-mobile-docs-v1');
const FILE = new File(ROOT, 'docs.bin');
const TEMP = new Directory(Paths.cache, 'docs');

export async function loadIndex(fileKey: Uint8Array): Promise<DocIndex | null> {
  try {
    if (!FILE.exists) return null;
    const d = JSON.parse(fromUtf8(xOpen(fileKey, await FILE.bytes(), AD))) as DocIndex;
    return d.v === 1 && Array.isArray(d.items) ? d : null;
  } catch {
    return null;
  }
}

let writing: Promise<void> = Promise.resolve();
export function saveIndex(fileKey: Uint8Array, d: DocIndex): Promise<void> {
  const e = currentEpoch();
  const box = xSeal(liveKey(fileKey), utf8(JSON.stringify(d)), AD);
  const mine = inflight(() =>
    writing
      .catch(() => undefined)
      .then(() => {
        sameEpoch(e);
        return writeProtected(FILE, box);
      }),
  );
  writing = mine.catch(() => undefined);
  return mine;
}

export function dropIndex(): void {
  deleteQuietly(FILE.uri);
}

export type SyncResult = { index: DocIndex; result: 'ok' | 'need_key' };

/**
 * 커서 다음 변경을 끝까지 받아 목록에 넣는다. 지운 문서는 뺀다. 아직 없는 세대의 열쇠로 봉인된 기록을 만나면 거기서 멈춘다
 * (커서를 넘기지 않아, PC가 새 세대 열쇠를 준 뒤 다음 받기에서 이어진다). 열리지 않는 기록(서명, 모양)은 건너뛴다.
 */
export async function syncIndex(o: { auth: DocsAuth; set: ShareKeySet; pairId: string; signPub: string; have: DocIndex | null }): Promise<SyncResult> {
  const fresh = (): DocIndex => ({ v: 1, pairId: o.pairId, signPub: o.signPub, cursor: 0, items: [] });
  let idx = o.have && o.have.pairId === o.pairId && o.have.signPub === o.signPub ? o.have : fresh();
  const items = new Map(idx.items.map((it) => [it.docId, it]));
  let cursor = idx.cursor;
  let restarted = false;
  const done = (result: SyncResult['result']): SyncResult => ({ index: { ...idx, cursor, items: [...items.values()] }, result });
  for (;;) {
    const page = await listDocs(o.auth, cursor);
    if (page.head < cursor && !restarted) {
      // 서버 순번이 내려갔다(계정 문서함을 새로 만든 경우). 가진 목록을 버리고 처음부터 받는다.
      restarted = true;
      idx = fresh();
      items.clear();
      cursor = 0;
      continue;
    }
    for (const e of page.docs) {
      if (e.state === 'deleted') {
        items.delete(e.docId);
        cursor = e.seq;
        continue;
      }
      const key = o.set.keys[e.epoch];
      if (!key) return done('need_key');
      const r = openDocRecord(key, { docId: e.docId, rev: e.rev, epoch: e.epoch, record: e.record! }, o.set.signPub);
      const have = items.get(e.docId);
      if (r.ok && r.core.body.chunks === e.chunks && (!have || have.rev <= r.core.rev)) {
        const b = r.core.body;
        items.set(e.docId, { docId: e.docId, rev: r.core.rev, name: b.name, docType: b.docType, issuedOn: b.issuedOn, expiresOn: b.expiresOn, bytes: b.bytes, sha256: b.sha256, dek: b.dek, chunks: b.chunks });
      }
      cursor = e.seq;
    }
    if (!page.more || !page.docs.length) return done('ok');
  }
}

/** 조각을 모두 받아 열고 크기와 SHA-256을 확인한다. 맞지 않으면 DocsError('hash' 등). */
export async function fetchDoc(auth: DocsAuth, it: DocItem): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let n = 0; n < it.chunks; n++) chunks.push(await getChunk(auth, it.docId, n));
  const r = openDocBlob(fromB64url(it.dek), it.docId, chunks, { bytes: it.bytes, sha256: it.sha256 });
  if (!r.ok) throw new DocsError(r.reason);
  return r.bytes;
}

const UNSAFE = /[\\/:*?"<>|]/g;
const CONTROL = (c: string) => c.charCodeAt(0) < 0x20;
/** 미리보기와 공유에 보일 파일 이름. 확장자는 .pdf 하나만. */
export function fileNameOf(name: string): string {
  const base = [...name].map((c) => (CONTROL(c) ? ' ' : c)).join('').replace(UNSAFE, ' ').replace(/\.pdf$/i, '').trim().slice(0, 80) || '문서';
  return `${base}.pdf`;
}

/** 미리보기용 임시 파일(캐시, 백업 제외와 파일 보호). 닫으면 dropTemp로 지운다. */
export async function writeTemp(it: DocItem, bytes: Uint8Array): Promise<File> {
  const f = new File(new Directory(TEMP, it.docId), fileNameOf(it.name));
  await writeProtected(f, bytes);
  return f;
}

export function dropTemp(f: File | null): void {
  if (!f) return;
  try {
    const d = f.parentDirectory;
    if (d.exists) d.delete();
  } catch {
    deleteQuietly(f.uri);
  }
}

/** 앱을 켤 때 지난번에 남은 임시 파일을 지운다. */
export function sweepTemps(): void {
  try {
    if (TEMP.exists) TEMP.delete();
  } catch {
    /* 다음 시작 때 다시 */
  }
}
