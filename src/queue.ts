
import type { PhoneGate } from './approval';
import type { RunView } from './run';

export const EXPIRE_MS = 72 * 3_600_000;

export type JobState =
  | 'entrusted'
  | 'phoneWaiting'
  | 'confirmStart'
  | 'running'
  | 'approval'
  | 'needPc'
  | 'verify'
  | 'expired'
  | 'done';

export type NeedPcReason = 'firstCounterparty' | 'dailyLimit' | 'notApprover';

export interface Job {
  id: string;
  title: string;
  amount: number | null;
  createdAt: number;
  state: JobState;
  reason?: NeedPcReason;
  gate?: PhoneGate;
  run?: RunView;
  pcOnly?: boolean;
  wait?: 'pcBusy' | 'newDay';
  waitDay?: string;
}

export interface DoneJob {
  title: string;
  finishedAt: number;
}

const ORDER: JobState[] = ['confirmStart', 'approval', 'needPc', 'verify', 'running', 'entrusted', 'phoneWaiting', 'expired', 'done'];

export type JobAction = 'cancel' | 'progress' | 'approve' | 'retry' | 'result' | 'dismiss' | 'redate';
const STATE_ACTION: Record<JobState, { key: JobAction; label: string } | null> = {
  entrusted: { key: 'cancel', label: '취소' },
  phoneWaiting: { key: 'cancel', label: '취소' },
  confirmStart: { key: 'cancel', label: '빼기' },
  running: { key: 'progress', label: '진행 보기' },
  approval: { key: 'approve', label: '승인 열기' },
  needPc: null,
  verify: { key: 'progress', label: '자세히' },
  expired: { key: 'retry', label: '다시 맡기기' },
  done: { key: 'result', label: '결과 보기' },
};

export function actionFor(job: Job, state: JobState): { key: JobAction; label: string } | null {
  if (state === 'needPc' && job.pcOnly && job.run) return { key: 'dismiss', label: '치우기' };
  if (job.wait === 'newDay') return { key: 'redate', label: '오늘 날짜로 맡기기' };
  return STATE_ACTION[state];
}

/** 카드가 이 상태에서 내미는 단추들. 큐 화면이 그리는 단추와 큐가 받아 주는 동작이 이 하나를 본다. */
export function actionsFor(job: Job, state: JobState): JobAction[] {
  const a = actionFor(job, state);
  if (!a) return [];
  return a.key === 'redate' ? ['redate', 'cancel'] : [a.key];
}

export function stateAt(job: Job, now: number): JobState {
  const waiting = job.state === 'entrusted' || job.state === 'phoneWaiting';
  return waiting && now - job.createdAt >= EXPIRE_MS ? 'expired' : job.state;
}

export function groupJobs(jobs: Job[], now: number): Array<{ state: JobState; jobs: Job[] }> {
  return ORDER.map((state) => ({ state, jobs: jobs.filter((j) => stateAt(j, now) === state).sort((a, b) => a.createdAt - b.createdAt) })).filter((g) => g.jobs.length > 0);
}

export function queueCounts(jobs: Job[], now: number): { approvals: number; backlog: number } {
  let approvals = 0;
  let backlog = 0;
  for (const j of jobs) {
    const s = stateAt(j, now);
    if (s === 'approval') approvals++;
    else if (s !== 'expired' && s !== 'done') backlog++;
  }
  return { approvals, backlog };
}

/** 카드에 없는 동작(이미 끝난 일을 다시 맡기기 등)은 받지 않는다. */
export function applyAction(jobs: Job[], id: string, action: JobAction, now: number): Job[] {
  const job = jobs.find((j) => j.id === id);
  if (!job || !actionsFor(job, stateAt(job, now)).includes(action)) return jobs;
  if (action === 'cancel') return jobs.filter((j) => j.id !== id);
  if (action === 'retry') return jobs.map((j) => (j.id === id ? { ...j, state: 'entrusted' as const, createdAt: now } : j));
  return jobs;
}

export function startAll(jobs: Job[], now: number): Job[] {
  return jobs.map((j) => (stateAt(j, now) === 'confirmStart' ? { ...j, state: 'running' as const } : j));
}
