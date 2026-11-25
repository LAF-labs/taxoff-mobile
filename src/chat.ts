import type { AmendCard, ReactionId } from '@sax/chat-core';
import type { AppData, RecentRecord } from './storage/state';
import type { Thumb } from './capture/thumb';

export interface ChatCard {
  title: string;
  rows: Array<{ label: string; value: string; strong?: boolean }>;
  note?: string;
  draft?: {
    id: string; counterpartyId: string; amount: number; vat: 'separate' | 'included' | null; item: string | null;
    phone?: { name: string; bizNo: string; edit?: boolean; draftId?: string };
  };
  /** 수정세금계산서 카드(ADR-058). 사장님이 고친 상태를 그대로 담아 대화 기록에 남긴다. */
  amend?: { id: string; card: AmendCard };
  sent?: boolean;
  photo?: { thumb: Thumb; msgId?: string };
}

export type ChatItem =
  | { kind: 'msg'; id: string; from: 'pc' | 'me'; via?: 'phone'; at: number; text?: string; card?: ChatCard; state?: 'sent' | 'waiting' | 'sending' | 'failed'; reaction?: ReactionId; replyTo?: { text: string; mine: boolean }; myReaction?: string }
  | { kind: 'merged'; id: string; from: number; to: number }
  | { kind: 'note'; id: string; at: number; text: string; failed?: { retry?: string } }
  | { kind: 'run'; id: string; at: number; jobId: string };

export function clock(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

export function clockRange(from: number, to: number): string {
  const a = clock(from);
  const b = clock(to);
  return a.slice(0, 2) === b.slice(0, 2) ? `${a}~${b.slice(3)}` : `${a}~${b}`;
}

export function stateOf(it: Extract<ChatItem, { kind: 'msg' }>): string {
  return it.from === 'me' && it.state === 'waiting' ? 'PC 켜지면 보내요' : '';
}

const atOf = (it: ChatItem) => (it.kind === 'merged' ? it.from : it.at);
const dayKey = (ts: number) => new Date(ts).toDateString();
const STAMP_GAP_MS = 30 * 60_000;
const GROUP_GAP_MS = 2 * 60_000;

export function stampBefore(items: readonly ChatItem[], i: number, now = Date.now()): string | null {
  const it = items[i];
  if (!it) return null;
  const prev = items[i - 1];
  const t = atOf(it);
  if (prev && dayKey(atOf(prev)) === dayKey(t) && t - atOf(prev) <= STAMP_GAP_MS) return null;
  return stampText(t, now);
}

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
  if (a.reaction) return false;
  const later = Math.max(i, j);
  return Math.abs(b.at - a.at) <= GROUP_GAP_MS && stampBefore(items, later) === null;
};

export function bubbleGroup(items: readonly ChatItem[], i: number): { first: boolean; last: boolean } {
  return { first: !joins(items, i - 1, i), last: !joins(items, i, i + 1) };
}

const KIND: Record<RecentRecord['kind'], string> = { receipt: '영수증', tax_invoice: '종이 세금계산서', invoice: '종이 계산서' };

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
