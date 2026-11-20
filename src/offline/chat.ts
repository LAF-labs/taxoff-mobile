import { PhoneChat, PhoneGateway, type ChatMessage, type ReactionId, type PhoneChatPorts, type PhoneCopy, type PhoneDraft, type PhoneGatewayOptions, type PhoneScreen, type PhoneShow, type PhoneTurnResult } from '@sax/chat-core';
import type { ChatCard, ChatItem } from '../chat.ts';
import { maskingSelfCheck, type SelfCheck } from './selfcheck.ts';

interface OfflinePorts {
  origin: string;
  fetch: PhoneGatewayOptions['fetch'];
  authHeaders: PhoneGatewayOptions['authHeaders'];
  store: PhoneChatPorts['store'];
  shownStore?: PhoneChatPorts['store'];
  copy(): PhoneCopy | null;
  now(): number;
  newId(): string;
  randomHex(): string;
  pcOnline?(): boolean;
}

export interface OfflineReply {
  items: ChatItem[];
  chips: Array<{ label: string; text: string }>;
  drafts: PhoneDraft[];
  screens: PhoneScreen[];
  unavailable?: { code: string; text: string; retry: boolean };
  reaction?: ReactionId;
}

const won = (n: number) => `${n.toLocaleString('en-US')}원`;
const VAT: Record<string, string> = { separate: '부가세 별도', included: '부가세 포함' };

export function cardOf(s: Exclude<PhoneShow, { type: 'screen' }>, pcOnline = false): ChatCard {
  if (s.type === 'card') {
    const d = s.draft;
    return {
      title: `${s.counterparty} 세금계산서`,
      rows: [
        { label: '금액', value: won(d.amount), strong: true },
        { label: '부가세', value: VAT[d.vat ?? 'separate']! },
        ...(d.item ? [{ label: '품목', value: d.item }] : []),
      ],
      draft: { id: d.id, counterpartyId: d.counterpartyId, amount: d.amount, vat: d.vat ?? 'separate', item: d.item },
      note: pcOnline ? (d.state === 'entrusted' ? 'PC가 준비하고 있어요' : '발급하기를 누르면 PC가 바로 준비해요') : d.state === 'entrusted' ? 'PC를 켜면 시작해요' : '발급하기를 누르면 PC를 켰을 때 시작해요',
    };
  }
  return {
    title: s.title,
    rows: s.rows.map((r) => ({ label: `${r.date.slice(5).replace('-', '/')} ${r.counterparty}`, value: r.total === null ? '금액 없음' : won(r.total) })),
    note: s.copy === 'stale' ? 'PC가 마지막으로 넘긴 기록이에요' : s.copy === 'none' ? '이 폰에는 아직 기록이 없어요' : undefined,
  };
}

export function itemOf(m: ChatMessage): ChatItem {
  return m.from === 'user' ? { kind: 'msg', id: m.id, from: 'me', at: m.at, text: m.text, ...(m.reaction ? { reaction: m.reaction } : {}) } : { kind: 'msg', id: m.id, from: 'pc', via: 'phone', at: m.at, text: m.text };
}

type Shown = Exclude<ChatItem, { kind: 'merged' }>;
const isShown = (x: ChatItem): x is Shown => x.kind !== 'merged';
const SHOWN_MAX = 100;

export class OfflineChat {
  readonly core: PhoneChat;
  private readonly gateway: PhoneGateway;
  private readonly ports: OfflinePorts;
  private check: Promise<SelfCheck> | null = null;
  reactionSink: ((r: ReactionId) => void) | null = null;
  private shown: Promise<Shown[]> | null = null;

  constructor(ports: OfflinePorts) {
    this.ports = ports;
    this.gateway = new PhoneGateway({ origin: ports.origin, fetch: ports.fetch, authHeaders: ports.authHeaders });
    this.core = new PhoneChat({ model: this.gateway, store: ports.store, copy: ports.copy, now: ports.now, newId: ports.newId, randomHex: ports.randomHex, pcOnline: () => ports.pcOnline?.() ?? false, onReaction: (r) => this.reactionSink?.(r) });
  }

  ready(): Promise<SelfCheck> {
    this.check ??= maskingSelfCheck(this.ports.randomHex);
    return this.check;
  }

  async send(text: string): Promise<OfflineReply> {
    const c = await this.ready();
    if (!c.ok) return { items: [], chips: [], drafts: [], screens: [], unavailable: { code: 'chat.unavailable', text: this.ports.pcOnline?.() ? '지금은 폰에서 답할 수 없어요. 앱을 껐다 켠 뒤 다시 말씀해 주세요.' : '지금은 폰에서 답할 수 없어요. PC를 켜면 이어서 할게요.', retry: false } };
    const r = this.toReply(await this.core.send(text));
    if (r.items.length) await this.remember(r.items.filter(isShown));
    return r;
  }

  async items(): Promise<ChatItem[]> {
    const shown = await this.loadShown();
    const msgs = (await this.core.messages()).map(itemOf).filter(isShown);
    const first = msgs[0]?.at ?? 0;
    return [...msgs, ...shown.filter((x) => x.at >= first)].sort((a, b) => a.at - b.at);
  }

  private loadShown(): Promise<Shown[]> {
    this.shown ??= (async () => {
      try {
        const raw = await this.ports.shownStore?.load();
        const v = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(v) ? (v as Shown[]).filter((x) => x && typeof x === 'object' && (x.kind === 'msg' || x.kind === 'note') && typeof x.id === 'string' && typeof x.at === 'number') : [];
      } catch {
        return [];
      }
    })();
    return this.shown;
  }

  async keep(items: ChatItem[]): Promise<void> {
    await this.remember(items.filter(isShown));
  }

  async forget(ids: string[]): Promise<void> {
    const all = (await this.loadShown()).filter((x) => !ids.includes(x.id));
    await this.write(all);
  }

  private async remember(items: Shown[]): Promise<void> {
    await this.write([...(await this.loadShown()).filter((x) => !items.some((n) => n.id === x.id)), ...items].slice(-SHOWN_MAX));
  }

  private async write(all: Shown[]): Promise<void> {
    this.shown = Promise.resolve(all);
    try {
      await this.ports.shownStore?.save(JSON.stringify(all));
    } catch {
      // 못 남겨도 지금 대화는 그대로
    }
  }

  subscribe(f: () => void): () => void {
    return this.core.subscribe(f);
  }

  entrust(draftId: string): Promise<PhoneDraft | null> {
    return this.core.entrust(draftId);
  }

  discard(draftId: string): Promise<boolean> {
    return this.core.discard(draftId);
  }

  usage() {
    return this.gateway.usage();
  }

  private toReply(r: PhoneTurnResult): OfflineReply {
    if (r.kind === 'unavailable') return { items: [], chips: [], drafts: [], screens: [], unavailable: { code: r.code, text: r.text, retry: r.retry } };
    if (r.kind === 'reaction') return { items: [], chips: [], drafts: [], screens: [], reaction: r.reaction };
    const at = this.ports.now();
    const items: ChatItem[] = [];
    r.show.forEach((s, i) => {
      if (s.type !== 'screen') items.push({ kind: 'msg', id: `${r.id}-${i}`, from: 'pc', via: 'phone', at, card: cardOf(s, this.ports.pcOnline?.() ?? false) });
    });
    return { items, chips: r.ask?.chips ?? [], drafts: r.show.flatMap((s) => (s.type === 'card' ? [s.draft] : [])), screens: r.show.flatMap((s) => (s.type === 'screen' ? [s.screen] : [])) };
  }
}
