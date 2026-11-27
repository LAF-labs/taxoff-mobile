import { b64, concat, fromB64, toHex } from './bytes.ts';
import { sha256Hash } from './crypto.ts';

/** ADR-070: 라이브 세션 전용. 큐 봉투로 보내지 않는다. */

export const DOC_CHUNK = 49152;
export const DOC_MAX_BYTES = 15 * 1024 * 1024;
export const DOC_LIST_PAGE = 100;
export const DOC_LIST_MAX_PAGES = 100;
export const DOC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DocListItem {
  docId: string;
  name: string;
  docType: string;
  issuedOn?: string;
  expiresOn?: string;
  bytes: number;
  sha256: string;
}
export interface DocListBody {
  asOf: number;
  page: number;
  pages: number;
  items: DocListItem[];
}
export interface DocWantBody {
  docId: string;
}
export interface DocChunkBody {
  docId: string;
  index: number;
  count: number;
  data: string;
}

export const docChunkCount = (bytes: number): number => Math.ceil(bytes / DOC_CHUNK);

/** 목록을 쪽으로 나눈다. 빈 보관함도 한 쪽(빈 목록)을 보내 폰이 가진 것을 지우게 한다. */
export function docListPages(items: readonly DocListItem[], asOf: number): DocListBody[] {
  const all = items.slice(0, DOC_LIST_PAGE * DOC_LIST_MAX_PAGES);
  const pages = Math.max(1, Math.ceil(all.length / DOC_LIST_PAGE));
  return Array.from({ length: pages }, (_, page) => ({ asOf, page, pages, items: all.slice(page * DOC_LIST_PAGE, (page + 1) * DOC_LIST_PAGE) }));
}

export function docChunkBodies(docId: string, bytes: Uint8Array): DocChunkBody[] {
  const count = docChunkCount(bytes.length);
  return Array.from({ length: count }, (_, index) => ({ docId, index, count, data: b64(bytes.subarray(index * DOC_CHUNK, (index + 1) * DOC_CHUNK)) }));
}

export class DocListCollector {
  #asOf = -1;
  #pages: (DocListItem[] | undefined)[] = [];
  add(b: DocListBody): DocListItem[] | null {
    if (b.asOf !== this.#asOf || this.#pages.length !== b.pages) {
      this.#asOf = b.asOf;
      this.#pages = Array.from({ length: b.pages }, () => undefined);
    }
    if (b.page >= b.pages) return null;
    this.#pages[b.page] = b.items;
    if (this.#pages.some((p) => !p)) return null;
    const out = this.#pages.flat() as DocListItem[];
    this.#pages = [];
    this.#asOf = -1;
    return out;
  }
}

export type DocAssembleResult = { state: 'more' } | { state: 'done'; bytes: Uint8Array } | { state: 'bad' };

export class DocAssembler {
  readonly item: DocListItem;
  readonly #parts: (Uint8Array | undefined)[];
  constructor(item: DocListItem) {
    this.item = item;
    this.#parts = Array.from({ length: docChunkCount(item.bytes) }, () => undefined);
  }
  add(c: DocChunkBody): DocAssembleResult {
    if (c.docId !== this.item.docId || c.count !== this.#parts.length || c.index >= c.count) return { state: 'bad' };
    const part = fromB64(c.data);
    if (part.length < 1 || part.length > DOC_CHUNK) return { state: 'bad' };
    this.#parts[c.index] = part;
    if (this.#parts.some((p) => !p)) return { state: 'more' };
    const bytes = concat(...(this.#parts as Uint8Array[]));
    if (bytes.length !== this.item.bytes || toHex(sha256Hash(bytes)) !== this.item.sha256) return { state: 'bad' };
    return { state: 'done', bytes };
  }
}
