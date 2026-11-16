// 밀린 일(P-13, 기획 v2 PR 2): 폰에서 PC에 맡긴 일의 로컬 모델. 아직 프로토콜 없이 화면용 상태만 있다.
// 맡긴 지 72시간이 지나도록 시작하지 못한 일은 만료로 본다(createdAt 기준, 저장하지 않고 그때그때 계산).

export const EXPIRE_MS = 72 * 3_600_000;

export type JobState =
  /** PC가 꺼져 있어 맡겨 둠 */
  | 'entrusted'
  /** 앞의 일이 시작되기를 폰에서 기다림(아직 맡기지 않음) */
  | 'phoneWaiting'
  /** PC가 켜져 시작해도 되는지 묻는 중 */
  | 'confirmStart'
  | 'running'
  | 'approval'
  /** PC 앞에서 해야 함(이유 한 줄) */
  | 'needPc'
  /** 발급됐는지 확인 필요 */
  | 'verify'
  | 'expired';

export type NeedPcReason = 'firstCounterparty' | 'dailyLimit' | 'notApprover';

export interface Job {
  id: string;
  /** "가나식자재 세금계산서" */
  title: string;
  /** 합계(원) */
  amount: number | null;
  createdAt: number;
  state: JobState;
  reason?: NeedPcReason;
}

/** 다 끝난 일 한 줄(빈 화면에 보인다) */
export interface DoneJob {
  title: string;
  finishedAt: number;
}

/** 화면에 보이는 순서: 사장님이 할 일 → PC가 하는 일 → 기다리는 일 → 끝난 일. */
export const ORDER: JobState[] = ['confirmStart', 'approval', 'needPc', 'verify', 'running', 'entrusted', 'phoneWaiting', 'expired'];

export const STATE_NAME: Record<JobState, string> = {
  entrusted: '맡김',
  phoneWaiting: '폰에 대기',
  confirmStart: '시작 확인',
  running: '진행 중',
  approval: '승인 대기',
  needPc: 'PC 앞 필요',
  verify: '확인 필요',
  expired: '만료',
};

export const STATE_LINE: Record<JobState, string> = {
  entrusted: 'PC 켜지면 시작해요',
  phoneWaiting: '앞의 일이 시작되면 이어서 맡겨요',
  confirmStart: 'PC가 켜졌어요. 시작할까요?',
  running: 'PC가 홈택스에서 하고 있어요',
  approval: '승인하면 발급해요',
  needPc: 'PC 앞에서 해야 해요',
  verify: '발급됐는지 확인이 필요해요',
  expired: '3일이 지나 취소됐어요',
};

export const REASON_LINE: Record<NeedPcReason, string> = {
  firstCounterparty: '처음 거래하는 곳',
  dailyLimit: '오늘 폰 승인 한도',
  notApprover: '이 폰은 승인 기기가 아님',
};

/** 줄마다 하나뿐인 동작. 시작 확인은 바닥 [모두 시작]이 주요 동작이고, 줄에는 건별 [빼기](글자만)만 있다. */
export type JobAction = 'cancel' | 'progress' | 'approve' | 'retry';
export const STATE_ACTION: Record<JobState, { key: JobAction; label: string } | null> = {
  entrusted: { key: 'cancel', label: '취소' },
  phoneWaiting: { key: 'cancel', label: '취소' },
  confirmStart: { key: 'cancel', label: '빼기' },
  running: { key: 'progress', label: '진행 보기' },
  approval: { key: 'approve', label: '승인 열기' },
  needPc: null,
  verify: null,
  expired: { key: 'retry', label: '다시 맡기기' },
};

/**
 * 아직 PC가 가져가지 않은 일(맡김·폰에 대기)이 72시간을 넘기면 만료.
 * 시작 확인은 PC가 이미 가져가 사장님 답을 기다리는 중이라 createdAt으로 만료시키지 않는다.
 */
export function stateAt(job: Job, now: number): JobState {
  const waiting = job.state === 'entrusted' || job.state === 'phoneWaiting';
  return waiting && now - job.createdAt >= EXPIRE_MS ? 'expired' : job.state;
}

export function groupJobs(jobs: Job[], now: number): Array<{ state: JobState; jobs: Job[] }> {
  return ORDER.map((state) => ({ state, jobs: jobs.filter((j) => stateAt(j, now) === state).sort((a, b) => a.createdAt - b.createdAt) })).filter((g) => g.jobs.length > 0);
}

/** 홈 "지금 할 일" 건수: 승인 대기, 나머지 밀린 일(만료 제외). */
export function queueCounts(jobs: Job[], now: number): { approvals: number; backlog: number } {
  let approvals = 0;
  let backlog = 0;
  for (const j of jobs) {
    const s = stateAt(j, now);
    if (s === 'approval') approvals++;
    else if (s !== 'expired') backlog++;
  }
  return { approvals, backlog };
}

/** 줄 동작 결과(취소는 지우고, 다시 맡기기는 지금 시각으로 맡김). */
export function applyAction(jobs: Job[], id: string, action: JobAction, now: number): Job[] {
  if (action === 'cancel') return jobs.filter((j) => j.id !== id);
  if (action === 'retry') return jobs.map((j) => (j.id === id ? { ...j, state: 'entrusted' as const, createdAt: now } : j));
  return jobs;
}

/** [모두 시작]: 시작 확인 중인 일을 진행 중으로. */
export function startAll(jobs: Job[], now: number): Job[] {
  return jobs.map((j) => (stateAt(j, now) === 'confirmStart' ? { ...j, state: 'running' as const } : j));
}
