// 홈 대화(기획 v2): PC 에이전트와 나누는 하나의 대화. 이 PR은 화면만 바꾼다(새 프로토콜 없음).
// 앱에서는 이 폰에 남은 기록(보낸 종이 증빙)과 이 폰에서 적은 말로만 줄을 만들고, PC 답은 갤러리 가짜 데이터에만 있다.
import type { AppData, RecentRecord } from './storage/state';

/** 카드 답(묶음 면). 줄은 라벨·값 두 칸. */
export interface ChatCard {
  title: string;
  rows: Array<{ label: string; value: string; strong?: boolean }>;
  note?: string;
}

export type ChatItem =
  | { kind: 'msg'; id: string; from: 'pc' | 'me'; at: number; text?: string; card?: ChatCard; state?: 'sent' | 'waiting' }
  /** 폰에서 나눈 대화를 PC 대화에 합친 구간의 머리. from·to는 시각(ms). */
  | { kind: 'merged'; id: string; from: number; to: number }
  /** 폰에서 한 일의 확인 한 줄(예: 발급을 맡겼어요). 사라지는 토스트 대신 대화에 남긴다. */
  | { kind: 'note'; id: string; at: number; text: string }
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
