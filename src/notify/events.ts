// 알림 거리(순수 함수, 시험 대상). 화면·OS와 무관하게 "무엇이 바뀌었고 무엇을 알릴지"만 정한다.
// - 발급 진행: PC가 알려 준 진행(RunView)이 사장님이 알아야 할 상태로 바뀌었을 때 한 번(내 차례 · 발급됨 · 중지 · 확인 필요 · 시작 못 함).
// - 돈: 받을 돈·낼 돈의 기한 지남·7일 안 건수(PC 사본·요약). 아침 알림 한 번.
// 잠금 화면에 뜰 수 있으므로 OS 알림 글에는 거래처·금액을 넣지 않는다(앱 안 배너에만 넣는다).
import type { Job } from '../queue';
import type { RunView } from '../run';

export type NotifyKind = 'myTurn' | 'done' | 'stopped' | 'verify' | 'refused';

export interface NotifyPrefs {
  /** 발급 진행(내 차례·끝남·멈춤) */
  run: boolean;
  /** 받을 돈·낼 돈 기한(아침 9시) */
  money: boolean;
}
export const DEFAULT_PREFS: NotifyPrefs = { run: true, money: true };

export interface RunEvent {
  jobId: string;
  kind: NotifyKind;
  /** 앱 안 배너 첫 줄(굵게) */
  title: string;
  /** 앱 안 배너 둘째 줄: 거래처 · 금액이 들어갈 수 있다 */
  line: string;
  /** OS 알림(잠금 화면) 글: 거래처·금액 없음 */
  os: { title: string; body: string };
}

/** 알릴 상태: 사람이 무언가 해야 하거나(내 차례·확인 필요) 일이 끝난 것(발급됨·중지·시작 못 함) */
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

/** 배너 둘째 줄: 일 이름(거래처) · 내 차례면 무엇을 할지 */
function lineOf(job: Job, kind: NotifyKind): string {
  const r = job.run;
  if (kind === 'myTurn' && r?.kind === 'myTurn') {
    return r.auth.method === 'cert' ? `${job.title}. 인증서 비밀번호가 필요해요` : `${job.title}. 간편인증을 승인해 주세요`;
  }
  return job.title;
}

/**
 * 앞 목록과 새 목록을 견줘 새로 알릴 것만 돌려준다. 같은 일이 같은 상태에 머무는 동안은 다시 알리지 않는다.
 * 처음 보는 일이 이미 끝난 상태로 들어오면(앱을 다시 열어 사본을 받은 경우 등) 알리지 않는다: 지난 일이다.
 */
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

/** 아침 알림 글(건수만). 알릴 것이 없으면 null. */
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

/** 다음 오전 9시(기기 시각). 지금이 9시 전이면 오늘, 지났으면 내일. */
export function nextMorning(now: number, hour = 9): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
