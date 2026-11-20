import type { Job } from '../queue';
import { pcTurnOf, type RunView } from '../run.ts';

export type NotifyKind = 'myTurn' | 'done' | 'stopped' | 'verify' | 'refused';

export interface NotifyPrefs {
  run: boolean;
  money: boolean;
  wake?: boolean;
}
export const DEFAULT_PREFS: NotifyPrefs = { run: true, money: true, wake: true };
export const wakeOn = (p: NotifyPrefs | undefined): boolean => p?.wake !== false;

export interface RunEvent {
  jobId: string;
  kind: NotifyKind;
  title: string;
  line: string;
  os: { title: string; body: string };
}

function kindOf(r: RunView | undefined): NotifyKind | null {
  if (!r) return null;
  switch (r.kind) {
    case 'myTurn':
      return 'myTurn';
    case 'done':
      return 'done';
    case 'stopped':
      return 'stopped';
    case 'verify':
      return 'verify';
    case 'refused':
      return 'refused';
    default:
      return null;
  }
}

const COPY: Record<NotifyKind, { title: string; os: string }> = {
  myTurn: { title: '내 차례예요', os: '홈택스 로그인을 확인해 주세요' },
  done: { title: '세금계산서를 발급했어요', os: '승인번호를 앱에서 볼 수 있어요' },
  stopped: { title: '발급을 멈췄어요', os: '아무것도 발급하지 않았어요. 앱에서 이유를 볼 수 있어요' },
  verify: { title: '발급됐는지 확인이 필요해요', os: '홈택스 발급목록에서 직접 확인해 주세요' },
  refused: { title: 'PC가 발급을 시작하지 못했어요', os: '앱에서 이유를 볼 수 있어요' },
};

function lineOf(job: Job, kind: NotifyKind): string {
  const r = job.run;
  if (kind === 'myTurn' && r?.kind === 'myTurn') {
    if (r.auth.method === 'pc') return `${job.title}. ${pcTurnOf(r.auth.code).short}`;
    return r.auth.method === 'cert' ? `${job.title}. 인증서 비밀번호가 필요해요` : `${job.title}. 간편인증을 승인해 주세요`;
  }
  return job.title;
}

export function runEvents(prev: readonly Job[], next: readonly Job[]): RunEvent[] {
  const before = new Map(prev.map((j) => [j.id, kindOf(j.run)]));
  const out: RunEvent[] = [];
  for (const j of next) {
    const k = kindOf(j.run);
    if (!k) continue;
    if (!before.has(j.id)) continue;
    if (before.get(j.id) === k) continue;
    const c = COPY[k];
    out.push({ jobId: j.id, kind: k, title: c.title, line: lineOf(j, k), os: { title: c.title, body: c.os } });
  }
  return out;
}

export interface MoneyCounts {
  recvOverdue: number;
  recvSoon: number;
  payOverdue: number;
  paySoon: number;
}

export function moneyReminder(c: MoneyCounts): { title: string; body: string } | null {
  const parts: string[] = [];
  if (c.recvOverdue) parts.push(`기한 지난 받을 돈 ${c.recvOverdue}건`);
  if (c.payOverdue) parts.push(`기한 지난 낼 돈 ${c.payOverdue}건`);
  if (c.recvSoon) parts.push(`7일 안에 받을 돈 ${c.recvSoon}건`);
  if (c.paySoon) parts.push(`7일 안에 낼 돈 ${c.paySoon}건`);
  if (!parts.length) return null;
  const urgent = c.recvOverdue || c.payOverdue;
  return { title: urgent ? '기한 지난 돈이 있어요' : '이번 주 오갈 돈이 있어요', body: `${parts.slice(0, 2).join(', ')}${parts.length > 2 ? ` 외 ${parts.length - 2}가지` : ''}. PC에서 받은 값 기준이에요.` };
}

export function nextMorning(now: number, hour = 9): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
