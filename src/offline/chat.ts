// PC가 꺼져 있을 때 폰이 게이트웨이를 거쳐 모델을 직접 부르는 대화(ADR-046 결정 7, ADR-047).
// 대화 코어(@sax/chat-core, tex 고정 사본)를 폰의 포트에 잇고, 코어의 결과를 홈 대화 줄(ChatItem)로 바꾼다.
// - 모델 공급사 키는 게이트웨이에만 있다. 폰은 기기 토큰(chat 범위, 유료·체험 중에만)과 요청별 DPoP만 붙인다.
// - 가림·컨텍스트 조립·도구 루프·답 검사는 코어가 한다(PC와 같은 함수). 이 파일은 연결과 화면 모양만 맡는다.
// - Expo 모듈을 부르지 않는다(시험이 Node에서 그대로 돈다). 기기 쪽 포트는 device.ts가 만든다.
import { PhoneChat, PhoneGateway, type ChatMessage, type PhoneChatPorts, type PhoneCopy, type PhoneDraft, type PhoneGatewayOptions, type PhoneScreen, type PhoneShow, type PhoneTurnResult } from '@sax/chat-core';
import type { ChatCard, ChatItem } from '../chat.ts';
import { maskingSelfCheck, type SelfCheck } from './selfcheck.ts';

export interface OfflinePorts {
  /** 게이트웨이 origin(운영 https://tax.laf-co.com, 계정 서비스와 같다) */
  origin: string;
  fetch: PhoneGatewayOptions['fetch'];
  authHeaders: PhoneGatewayOptions['authHeaders'];
  /** 봉인 저장(대화 기록·카드). 값은 JSON 문자열 하나 */
  store: PhoneChatPorts['store'];
  /** 대화에 붙은 카드·표를 남기는 봉인 저장(없으면 앱을 끄면 사라진다). 값은 JSON 문자열 하나 */
  shownStore?: PhoneChatPorts['store'];
  copy(): PhoneCopy | null;
  now(): number;
  newId(): string;
  randomHex(): string;
  /** 지금 PC가 켜져 있는지. 켜져 있어도 폰 대화는 이 폰이 직접 부른다(ADR-047 결정 6). */
  pcOnline?(): boolean;
}

/** 홈 화면에 주는 한 턴의 결과 */
export interface OfflineReply {
  /** 대화 줄에 더할 것(앱 답과 카드·표). 내가 쓴 줄은 messages()에 이미 있다. */
  items: ChatItem[];
  /** 되묻기 칩(누르면 그 글을 보낸다) */
  chips: Array<{ label: string; text: string }>;
  /** 이번 턴에 만든 카드(맡기기·취소 단추용) */
  drafts: PhoneDraft[];
  /** 모델이 연 앱 화면(대화 아래 단추로 붙는다) */
  screens: PhoneScreen[];
  /** 모델을 부르지 못했다(한도·연결·정지 등). text는 사장님에게 보일 한 줄이다. */
  unavailable?: { code: string; text: string; retry: boolean };
}

const won = (n: number) => `${n.toLocaleString('en-US')}원`;
const VAT: Record<string, string> = { separate: '부가세 별도', included: '부가세 포함' };

/** 카드·표 → 홈 대화의 묶음 면 */
export function cardOf(s: Exclude<PhoneShow, { type: 'screen' }>, pcOnline = false): ChatCard {
  if (s.type === 'card') {
    const d = s.draft;
    return {
      title: `${s.counterparty} 세금계산서`,
      rows: [
        { label: '금액', value: won(d.amount), strong: true },
        // 부가세를 말하지 않았으면 별도(공급가액에 10%를 더한다). 카드의 [수정]에서 포함으로 바꿀 수 있다.
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

/** 코어 메시지 → 홈 대화 줄. 앱 답은 'pc' 쪽 말풍선에 그린다. 이 대화는 이 폰에만 있어서 'PC 받음' 표시는 없다. */
export function itemOf(m: ChatMessage): ChatItem {
  return m.from === 'user' ? { kind: 'msg', id: m.id, from: 'me', at: m.at, text: m.text } : { kind: 'msg', id: m.id, from: 'pc', via: 'phone', at: m.at, text: m.text };
}

type Shown = Exclude<ChatItem, { kind: 'merged' }>;
const isShown = (x: ChatItem): x is Shown => x.kind !== 'merged';
/** 남겨 두는 카드·표의 수(코어 기록 600개에 비해 충분하다) */
const SHOWN_MAX = 100;

export class OfflineChat {
  readonly core: PhoneChat;
  private readonly gateway: PhoneGateway;
  private readonly ports: OfflinePorts;
  private check: Promise<SelfCheck> | null = null;
  /** 대화에 붙은 카드·표(오래된 것부터). 처음 부를 때 한 번 읽는다. */
  private shown: Promise<Shown[]> | null = null;

  constructor(ports: OfflinePorts) {
    this.ports = ports;
    this.gateway = new PhoneGateway({ origin: ports.origin, fetch: ports.fetch, authHeaders: ports.authHeaders });
    this.core = new PhoneChat({ model: this.gateway, store: ports.store, copy: ports.copy, now: ports.now, newId: ports.newId, randomHex: ports.randomHex, pcOnline: () => ports.pcOnline?.() ?? false });
  }

  /** 가림 자가 점검(앱을 연 뒤 한 번). 통과하지 못하면 send는 모델을 부르지 않는다. */
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

  /** 지금까지의 폰 대화(PC가 넘긴 앞 대화 포함) */
  async items(): Promise<ChatItem[]> {
    const shown = await this.loadShown();
    // 코어 기록에서 밀려난 옛 말보다 앞선 카드는 보이지 않게 한다(말이 없는 카드만 덩그러니 남지 않게)
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

  /** 카드·표나 못 보낸 말(과 이유 줄)을 남긴다. 저장이 안 돼도 대화는 계속된다(이번 실행 동안은 화면에 있다). */
  async keep(items: ChatItem[]): Promise<void> {
    await this.remember(items.filter(isShown));
  }

  /** 남겨 둔 줄을 지운다(못 보낸 말을 다시 보낼 때) */
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

  /** 오늘 쓴 금액과 한도(PC와 같이 센다) */
  usage() {
    return this.gateway.usage();
  }

  private toReply(r: PhoneTurnResult): OfflineReply {
    if (r.kind === 'unavailable') return { items: [], chips: [], drafts: [], screens: [], unavailable: { code: r.code, text: r.text, retry: r.retry } };
    const at = this.ports.now();
    const items: ChatItem[] = [];
    r.show.forEach((s, i) => {
      if (s.type !== 'screen') items.push({ kind: 'msg', id: `${r.id}-${i}`, from: 'pc', via: 'phone', at, card: cardOf(s, this.ports.pcOnline?.() ?? false) });
    });
    return { items, chips: r.ask?.chips ?? [], drafts: r.show.flatMap((s) => (s.type === 'card' ? [s.draft] : [])), screens: r.show.flatMap((s) => (s.type === 'screen' ? [s.screen] : [])) };
  }
}
