import { Directory, File, Paths } from 'expo-file-system';
import { fromUtf8, utf8, xOpen, xSeal, type DocListItem } from '@sax/remote';
import { currentEpoch, inflight, liveKey, sameEpoch } from '../inflight';
import { ROOT, deleteQuietly, writeProtected } from '../storage/files';

export interface DocItem {
  docId: string;
  name: string;
  docType: string;
  issuedOn: string | null;
  expiresOn: string | null;
  bytes: number;
  sha256: string;
}

export interface DocIndex {
  v: 2;
  pairId: string;
  items: DocItem[];
}

export type DocKind = 'invoice' | 'cert' | 'other';
export const kindOf = (docType: string): DocKind => (docType === 'tax_invoice' ? 'invoice' : docType === 'other' ? 'other' : 'cert');

const AD = utf8('SAX-mobile-docs-v2');
const FILE_AD = utf8('SAX-mobile-doc-v2');
const FILE = new File(ROOT, 'docs.bin');
const DIR = new Directory(ROOT, 'docs');
const TEMP = new Directory(Paths.cache, 'docs');
const SAFE_ID = /^[0-9a-f-]{36}$/;

const listeners = new Set<(d: DocIndex) => void>();
export function onIndex(cb: (d: DocIndex) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const itemOf = (it: DocListItem): DocItem => ({
  docId: it.docId, name: it.name, docType: it.docType, issuedOn: it.issuedOn ?? null, expiresOn: it.expiresOn ?? null, bytes: it.bytes, sha256: it.sha256,
});

export async function loadIndex(fileKey: Uint8Array): Promise<DocIndex | null> {
  try {
    if (!FILE.exists) return null;
    const d = JSON.parse(fromUtf8(xOpen(fileKey, await FILE.bytes(), AD))) as DocIndex;
    return d.v === 2 && Array.isArray(d.items) ? d : null;
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
  void mine.then(() => {
    for (const cb of listeners) cb(d);
  });
  return mine;
}

const docFile = (docId: string) => {
  if (!SAFE_ID.test(docId)) throw new Error('docs: bad id');
  return new File(DIR, `${docId}.bin`);
};

export function hasDoc(docId: string): boolean {
  try {
    return docFile(docId).exists;
  } catch {
    return false;
  }
}

export async function storeDoc(fileKey: Uint8Array, docId: string, bytes: Uint8Array): Promise<void> {
  const e = currentEpoch();
  const box = xSeal(liveKey(fileKey), bytes, FILE_AD);
  await inflight(async () => {
    sameEpoch(e);
    await writeProtected(docFile(docId), box);
  });
}

export async function readDoc(fileKey: Uint8Array, docId: string): Promise<Uint8Array> {
  return xOpen(fileKey, await docFile(docId).bytes(), FILE_AD);
}

export function removeDoc(docId: string): void {
  try {
    deleteQuietly(docFile(docId).uri);
  } catch {
    /* 모양이 틀린 id는 파일이 없다 */
  }
}

export function dropAll(): void {
  deleteQuietly(FILE.uri);
  try {
    if (DIR.exists) DIR.delete();
  } catch {
    /* 다음에 다시 */
  }
  for (const cb of listeners) cb({ v: 2, pairId: '', items: [] });
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
