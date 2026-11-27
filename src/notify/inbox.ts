import type { Job } from '../queue';
import type { NotifyKind, RunEvent } from './events';

/**
 * 알림함. 폰이 받은 알림(발급 진행, 승인 기다림, 돈 기한)을 기기 안에 모아 둔다.
 * 알림을 꺼 둬도 앱 안 기록이라 모은다. 켜고 끄는 것은 밖으로 알리는 일만 정한다.
 */
export type InboxKind = NotifyKind | 'approve' | 'money';

export interface InboxItem {
  id: string;
  at: number;
  kind: InboxKind;
  title: string;
  line: string;
  jobId?: string;
}

const DAY = 24 * 60 * 60 * 1000;
export const INBOX_KEEP_DAYS = 30;
export const INBOX_MAX = 100;

/** 같은 id는 한 번만 둔다. 새것이 위, 30일과 100건을 넘은 것은 버린다. */
export function addInbox(list: readonly InboxItem[], add: readonly InboxItem[], now: number): InboxItem[] {
  const seen = new Set(list.map((x) => x.id));
  const fresh = add.filter((x) => !seen.has(x.id) && (seen.add(x.id), true));
  if (!fresh.length) return [...list];
  return [...fresh, ...list]
    .filter((x) => now - x.at < INBOX_KEEP_DAYS * DAY)
    .sort((a, b) => b.at - a.at)
    .slice(0, INBOX_MAX);
}

export const unreadCount = (list: readonly InboxItem[] | undefined, seenAt: number | undefined): number =>
  (list ?? []).filter((x) => x.at > (seenAt ?? 0)).length;

/** 발급을 멈춘 알림에는 아무것도 발급하지 않았다는 말을 붙인다. 나머지는 앱 안 배너와 같은 줄. */
export function fromRun(ev: RunEvent, at: number): InboxItem {
  const line = ev.kind === 'stopped' || ev.kind === 'refused' ? `${ev.line}. 아무것도 발급하지 않았어요` : ev.line;
  return { id: `${ev.jobId}:${ev.kind}:${at}`, at, kind: ev.kind, title: ev.title, line, jobId: ev.jobId };
}

/** 폰에서 승인할 수 있는 일이 새로 생겼을 때. 한 일에 한 번. */
export function newApprovals(prev: readonly Job[], next: readonly Job[], at: number, won: (n: number) => string): InboxItem[] {
  const before = new Set(prev.filter((j) => j.gate && j.state === 'approval').map((j) => j.id));
  return next
    .filter((j) => j.gate && j.state === 'approval' && !before.has(j.id))
    .map((j) => ({
      id: `${j.id}:approve`,
      at,
      kind: 'approve' as const,
      title: '승인을 기다리는 발급이 있어요',
      line: j.amount !== null ? `${j.title}, ${won(j.amount)}` : j.title,
      jobId: j.id,
    }));
}

/** 돈 기한 알림은 하루 한 번, 그날 아침 알림 시각으로 남긴다. */
export function moneyItem(r: { title: string; body: string }, morning: number): InboxItem {
  const d = new Date(morning);
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return { id: `money:${day}`, at: morning, kind: 'money', title: r.title, line: r.body.replace(/ PC에서 받은 값 기준이에요\.$/, '') };
}

/** 오늘, 어제, 그 전은 "11월 22일". */
export function dayLabel(at: number, now: number): string {
  const start = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((start(now) - start(at)) / DAY);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function byDay(list: readonly InboxItem[], now: number): Array<{ label: string; items: InboxItem[] }> {
  const out: Array<{ label: string; items: InboxItem[] }> = [];
  for (const x of list) {
    const label = dayLabel(x.at, now);
    const last = out.at(-1);
    if (last?.label === label) last.items.push(x);
    else out.push({ label, items: [x] });
  }
  return out;
}
