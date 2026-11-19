// 홈 대화(기획 v2): PC 에이전트와 나누는 하나의 대화. 이 PR은 화면만 바꾼다(새 프로토콜 없음).
// 앱에서는 이 폰에 남은 기록(보낸 종이 증빙)과 이 폰에서 적은 말로만 줄을 만들고, PC 답은 갤러리 가짜 데이터에만 있다.
import type { AppData, RecentRecord } from './storage/state';

/** 카드 답(묶음 면). 줄은 라벨·값 두 칸. */
export interface ChatCard {
  title: string;
  rows: Array<{ label: string; value: string; strong?: boolean }>;
  note?: string;
  /** 폰 대화가 만든 세금계산서 카드면 그 초안. 열린 카드에는 [발급 맡기기]가 붙는다. */
  draft?: { id: string; counterpartyId: string; amount: number; vat: 'separate' | 'included' | null; item: string | null };
}

export type ChatItem =
  /**
   * 말 한 줄. from 'pc'는 상대 쪽(왼쪽), via 'phone'이면 PC가 꺼져 있어 이 폰이 답한 말이다.
   * state(내 말만): sent 보냄 · waiting PC 켜지면 보냄 · sending 보내는 중 · failed 못 보냄(아래 note에 이유와 [다시 보내기]).
   */
  | { kind: 'msg'; id: string; from: 'pc' | 'me'; via?: 'phone'; at: number; text?: string; card?: ChatCard; state?: 'sent' | 'waiting' | 'sending' | 'failed' }
  /** 폰에서 나눈 대화를 PC 대화에 합친 구간의 머리. from·to는 시각(ms). */
  | { kind: 'merged'; id: string; from: number; to: number }
  /** 폰에서 한 일의 확인 한 줄(예: 발급을 맡겼어요). 사라지는 토스트 대신 대화에 남긴다. */
  | { kind: 'note'; id: string; at: number; text: string; /** 못 한 일의 이유 한 줄(체크 표시 없이). retry가 있으면 [다시 보내기]가 그 글을 다시 보낸다. */ failed?: { retry?: string } }
  /** 발급 진행·결과 카드(P-04). 내용은 밀린 일 저장소의 그 일에서 그린다. */
  | { kind: 'run'; id: string; at: number; jobId: string };

/** 오전 8:10 · 오후 2:05 */
export function clock(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

/** "오전 8:10~9:40": 오전·오후가 같으면 뒤쪽은 생략한다. */
export function clockRange(from: number, to: number): string {
  const a = clock(from);
  const b = clock(to);
  return a.slice(0, 2) === b.slice(0, 2) ? `${a}~${b.slice(3)}` : `${a}~${b}`;
}

/** 말풍선 위 이름(상대 말의 묶음 첫 줄에만): PC가 답했는지 폰이 답했는지 */
export function whoOf(it: Extract<ChatItem, { kind: 'msg' }>): string {
  return it.from === 'me' ? '' : it.via === 'phone' ? '폰' : 'PC';
}

/** 내 말이 어디까지 갔는지(보냈으면 빈 글자). 시각 위에 작게 쓴다. */
export function stateOf(it: Extract<ChatItem, { kind: 'msg' }>): string {
  return it.from !== 'me' ? '' : { sent: '', waiting: 'PC 켜지면 보내요', sending: '보내는 중', failed: '못 보냈어요' }[it.state ?? 'sent'];
}

type Msg = Extract<ChatItem, { kind: 'msg' }>;
const sameSide = (a: ChatItem | undefined, b: Msg): a is Msg => a?.kind === 'msg' && a.from === b.from && (a.via ?? '') === (b.via ?? '');
const sameMinute = (a: number, b: number) => Math.floor(a / 60_000) === Math.floor(b / 60_000);

/**
 * 말풍선 묶음(카카오톡처럼): 같은 쪽이 잇달아 한 말은 붙여 그린다.
 * first: 묶음의 첫 말(상대 쪽이면 이름을 위에 쓴다). time: 시각을 쓸지(같은 분 안에서 이어지면 마지막 말에만).
 * 상태가 있는 내 말(보내는 중 등)은 늘 시각과 상태를 쓴다.
 */
export function bubbleGroup(items: readonly ChatItem[], i: number): { first: boolean; time: boolean } {
  const it = items[i];
  if (it?.kind !== 'msg') return { first: true, time: true };
  const prev = items[i - 1];
  const next = items[i + 1];
  const first = !sameSide(prev, it);
  const time = !(sameSide(next, it) && sameMinute(next.at, it.at)) || stateOf(it) !== '';
  return { first, time };
}

const KIND: Record<RecentRecord['kind'], string> = { receipt: '영수증', tax_invoice: '종이 세금계산서', invoice: '종이 계산서' };

/** 앱의 대화 줄: 이 폰에서 보낸 종이 증빙을 내가 보낸 카드로 보인다(오래된 것부터). */
export function chatFromData(data: AppData): ChatItem[] {
  return [...data.recent]
    .sort((a, b) => a.at - b.at)
    .map((r) => ({
      kind: 'msg' as const,
      id: r.msgId,
      from: 'me' as const,
      at: r.at,
      state: r.state === 'sent' ? ('sent' as const) : ('waiting' as const),
      card: { title: `${KIND[r.kind]} 보냄`, rows: [{ label: r.title, value: r.amount !== null ? `${r.amount.toLocaleString('ko-KR')}원` : '금액 없음' }] },
    }));
}
