// 밀린 일 가짜 저장소(기획 v2 PR 2): 메모리에만 둔다. PC와 주고받는 프로토콜이 생기면 세션으로 옮긴다.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ChatItem } from './chat';
import { applyAction, startAll as startAllJobs, type DoneJob, type Job, type JobAction } from './queue';

export interface QueueStore {
  jobs: Job[];
  /** 마지막으로 끝난 일(빈 화면 한 줄) */
  last: DoneJob | null;
  act: (id: string, action: JobAction) => void;
  startAll: () => void;
  /** 맡기고 대화에 확인 한 줄을 남긴다. */
  add: (job: Job, note: string) => void;
  /** 이 폰에서 남긴 확인 줄(홈 대화 끝에 붙는다) */
  notes: ChatItem[];
}

const Ctx = createContext<QueueStore | null>(null);

export function QueueProvider({ initial = [], last = null, notes: initialNotes = [], children }: { initial?: Job[]; last?: DoneJob | null; notes?: ChatItem[]; children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(initial);
  const [notes, setNotes] = useState<ChatItem[]>(initialNotes);
  const store = useMemo<QueueStore>(
    () => ({
      jobs,
      last,
      act: (id, action) => setJobs((js) => applyAction(js, id, action, Date.now())),
      startAll: () => setJobs((js) => startAllJobs(js, Date.now())),
      add: (job, note) => {
        setJobs((js) => [...js, job]);
        setNotes((n) => [...n, { kind: 'note', id: `note-${job.id}`, at: Date.now(), text: note }]);
      },
      notes,
    }),
    [jobs, last, notes],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useQueue(): QueueStore {
  const q = useContext(Ctx);
  if (!q) throw new Error('queue: no provider');
  return q;
}
