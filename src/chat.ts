// 홈 대화(기획 v2): PC 에이전트와 나누는 하나의 대화. 이 PR은 화면만 바꾼다(새 프로토콜 없음).
// 앱에서는 이 폰에 남은 기록(보낸 종이 증빙)과 이 폰에서 적은 말로만 줄을 만들고, PC 답은 갤러리 가짜 데이터에만 있다.
import type { ReactionId } from '@sax/chat-core';
import type { AppData, RecentRecord } from './storage/state';
import type { Thumb } from './capture/thumb';

/** 카드 답(묶음 면). 줄은 라벨·값 두 칸. */
export interface ChatCard {
  title: string;
  rows: Array<{ label: string; value: string; strong?: boolean }>;
  note?: string;
  /** 폰 대화가 만든 세금계산서 카드면 그 초안. 열린 카드에는 [발급 맡기기]가 붙는다. */
  draft?: {
    id: string; counterpartyId: string; amount: number; vat: 'separate' | 'included' | null; item: string | null;
    /** [+] 발급 시트에서 이 폰이 띄운 카드: 받는 곳의 상호와 등록번호(직접 입력이면 counterpartyId는 빈 글자). edit면 수정 상태로 연다. */
    phone?: { name: string; bizNo: string; edit?: boolean; /** 모델 카드에서 거래처를 다시 골라 띄웠으면 그 카드 id(맡기면 그 카드도 맡김으로) */ draftId?: string };
  };
  /** 이 폰이 띄운 카드를 맡겼다(단추 없이 값만) */
  sent?: boolean;
  /** 찍어 보낸 증빙 사진: 비율·흐린 미리보기. pending이면 원본이 아직 이 폰 보관함(outbox)에 있다(msgId로 연다). */
  photo?: { thumb: Thumb; msgId?: string };
}

export type ChatItem =
  /**
   * 말 한 줄. from 'pc'는 상대 쪽(왼쪽), via 'phone'이면 PC가 꺼져 있어 이 폰이 답한 말이다.
   * state(내 말만): sent 보냄 · waiting PC 켜지면 보냄 · sending 보내는 중 · failed 못 보냄(아래 note에 이유와 [다시 보내기]).
   */
  | { kind: 'msg'; id: string; from: 'pc' | 'me'; via?: 'phone'; at: number; text?: string; card?: ChatCard; state?: 'sent' | 'waiting' | 'sending' | 'failed'; /** 내 말에 앱이 단 반응(ADR-057, 판정이 고른 허용 목록 이름) */ reaction?: ReactionId }
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

/**
 * 내 말풍선 아래 작은 한 줄. PC가 꺼져 있어 아직 맡기지 못한 말에만 쓴다.
 * 보내는 중은 기다림 점 셋이, 못 보냄은 바로 아래 이유 줄과 [다시 보내기]가 이미 말해 주므로 쓰지 않는다.
 */
export function stateOf(it: Extract<ChatItem, { kind: 'msg' }>): string {
  return it.from === 'me' && it.state === 'waiting' ? 'PC 켜지면 보내요' : '';
}

const atOf = (it: ChatItem) => (it.kind === 'merged' ? it.from : it.at);
const dayKey = (ts: number) => new Date(ts).toDateString();
/** 시각 줄을 새로 넣는 간격(Muse와 같다) */
export const STAMP_GAP_MS = 30 * 60_000;
/** 같은 쪽 말을 한 묶음으로 붙이는 간격(Muse와 같다) */
export const GROUP_GAP_MS = 2 * 60_000;

/**
 * 시각 줄(Muse 방식): 말풍선마다 쓰지 않고 가운데 한 줄로 쓴다.
 * 대화 첫 줄 앞, 날짜가 바뀐 줄 앞, 앞 줄과 30분 넘게 떨어진 줄 앞에만. 넣지 않으면 null.
 */
export function stampBefore(items: readonly ChatItem[], i: number, now = Date.now()): string | null {
  const it = items[i];
  if (!it) return null;
  const prev = items[i - 1];
  const t = atOf(it);
  if (prev && dayKey(atOf(prev)) === dayKey(t) && t - atOf(prev) <= STAMP_GAP_MS) return null;
  return stampText(t, now);
}

/** 오늘이면 "오후 2:05", 다른 날이면 "11월 18일 오후 2:05", 다른 해면 "2025년 11월 18일 오후 2:05" */
export function stampText(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return clock(ts);
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock(ts)}`;
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

const joins = (items: readonly ChatItem[], i: number, j: number): boolean => {
  const a = items[i];
  const b = items[j];
  if (a?.kind !== 'msg' || b?.kind !== 'msg') return false;
  if (a.from !== b.from || (a.via ?? '') !== (b.via ?? '')) return false;
  // 반응이 달린 말 뒤는 붙이지 않는다(알약이 다음 말풍선에 겹치지 않게, ADR-057)
  if (a.reaction) return false;
  const later = Math.max(i, j);
  return Math.abs(b.at - a.at) <= GROUP_GAP_MS && stampBefore(items, later) === null;
};

/**
 * 말풍선 묶음(Muse 방식): 같은 쪽이 2분 안에 잇달아 한 말은, 사이에 시각 줄이 없으면 한 묶음.
 * 묶음 안은 4, 묶음 사이는 16 띄우고, 이어 붙은 귀퉁이만 덜 둥글게 그린다.
 */
export function bubbleGroup(items: readonly ChatItem[], i: number): { first: boolean; last: boolean } {
  return { first: !joins(items, i - 1, i), last: !joins(items, i, i + 1) };
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
      card: { title: `${KIND[r.kind]} 보냄`, rows: [{ label: r.title, value: r.amount !== null ? `${r.amount.toLocaleString('ko-KR')}원` : '금액 없음' }], ...(r.thumb ? { photo: { thumb: r.thumb, ...(r.state === 'sent' ? {} : { msgId: r.msgId }) } } : {}) },
    }));
}
