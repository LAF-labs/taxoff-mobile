// 밀린 일 가짜 저장소(기획 v2 PR 2·5): 메모리에만 둔다. PC와 주고받는 프로토콜이 생기면 세션으로 옮긴다.
// 승인 시트(P-03)도 여기서 연다: 승인 대기 일에 PC 승인 요청(gate)이 붙어 있으면 그 일의 시트를 띄운다.
// simulate(갤러리·시연 전용): PC가 켜져 맡긴 발급이 1.5초 뒤 "PC가 승인 요청함"으로 바뀌고 시트가 뜬다.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { GATE_TTL_MS, buildGate, type AttestState, type PhoneGate, type READBACK_KEYS } from './approval';
import type { ChatItem } from './chat';
import { applyAction, startAll as startAllJobs, type DoneJob, type Job, type JobAction, type NeedPcReason } from './queue';
import { b64, randomBytes } from '../vendor/sax-remote/src/index.ts';

export type Readback = Record<(typeof READBACK_KEYS)[number], string>;

export interface ApprovalSettings {
  attest: AttestState;
  /** iPhone(앱 무결성만)을 승인 기기로 받는지(ADR-046 결정 4, 제안) */
  iosAllowed: boolean;
  usedToday: number;
}

export interface QueueStore {
  jobs: Job[];
  /** 마지막으로 끝난 일(빈 화면 한 줄) */
  last: DoneJob | null;
  act: (id: string, action: JobAction) => void;
  startAll: () => void;
  /** 맡기고 대화에 확인 한 줄을 남긴다. readback은 시연(simulate)에서 PC가 되읽을 값. */
  add: (job: Job, note: string, readback?: Readback) => void;
  /** 이 폰에서 남긴 확인 줄(홈 대화 끝에 붙는다) */
  notes: ChatItem[];
  approval: ApprovalSettings;
  /** 승인 시트가 열린 일 */
  sheetJob: Job | null;
  openSheet: (id: string) => void;
  closeSheet: () => void;
  /** 승인: 진행 중으로(결과가 오기 전), 거절: 밀린 일에서 뺀다. */
  decide: (id: string, decision: 'approve' | 'deny') => void;
  /** 폰에서 승인할 수 없어 PC 앞 필요로 둔다. */
  park: (id: string, reason: NeedPcReason) => void;
  /** 만료된 승인 요청을 PC에 다시 요청(시연에서는 새 마감으로 다시 온다). */
  rerequest: (id: string) => void;
}

const Ctx = createContext<QueueStore | null>(null);

const SIM_SUPPLIER = { supplierBizNo: '123-45-67890', supplierName: '택스오프상회' };

export function QueueProvider({
  initial = [], last = null, notes: initialNotes = [], approval = { attest: 'none', iosAllowed: false, usedToday: 0 }, sheet = null, simulate = false, children,
}: {
  initial?: Job[]; last?: DoneJob | null; notes?: ChatItem[]; approval?: ApprovalSettings;
  /** 처음부터 열어 둘 승인 시트(갤러리) */
  sheet?: string | null;
  simulate?: boolean; children: ReactNode;
}) {
  const [jobs, setJobs] = useState<Job[]>(initial);
  const [notes, setNotes] = useState<ChatItem[]>(initialNotes);
  const [sheetId, setSheetId] = useState<string | null>(sheet);
  const [used, setUsed] = useState(approval.usedToday);
  const note = (id: string, text: string) => setNotes((n) => [...n, { kind: 'note', id: `note-${id}-${Date.now()}`, at: Date.now(), text }]);
  const patch = (id: string, f: (j: Job) => Job) => setJobs((js) => js.map((j) => (j.id === id ? f(j) : j)));
  const fakeGate = (readback: Readback, first = false): PhoneGate =>
    buildGate({
      readback,
      reserved: [{ key: '$first.bizNo', value: String(first) }, { key: '$first.email', value: 'false' }],
      packageDigest: 'ab'.repeat(32),
      authorizes: ['s21'],
      intentId: '01JD8Z6Q3B9K2M4N5P7R8S9T0V',
      reqId: '01JD0000000000000000000000',
      challenge: b64(randomBytes(32)),
      exp: Date.now() + GATE_TTL_MS,
    });

  const store = useMemo<QueueStore>(
    () => ({
      jobs,
      last,
      notes,
      approval: { ...approval, usedToday: used },
      sheetJob: jobs.find((j) => j.id === sheetId && j.gate) ?? null,
      act: (id, action) => setJobs((js) => applyAction(js, id, action, Date.now())),
      startAll: () => setJobs((js) => startAllJobs(js, Date.now())),
      add: (job, text, readback) => {
        setJobs((js) => [...js, job]);
        note(job.id, text);
        if (simulate && readback && job.state === 'running') {
          setTimeout(() => {
            patch(job.id, (j) => ({ ...j, state: 'approval', gate: fakeGate({ ...readback, ...SIM_SUPPLIER }) }));
            setSheetId(job.id);
          }, 1500);
        }
      },
      openSheet: (id) => setSheetId(id),
      closeSheet: () => setSheetId(null),
      decide: (id, decision) => {
        const j = jobs.find((x) => x.id === id);
        setSheetId(null);
        if (decision === 'approve') {
          setUsed((u) => u + 1);
          patch(id, (x) => ({ ...x, state: 'running', gate: undefined }));
          note(id, `${j?.title ?? '세금계산서'}을 승인했어요. PC가 홈택스에서 발급하고 있어요`);
        } else {
          setJobs((js) => js.filter((x) => x.id !== id));
          note(id, `${j?.title ?? '세금계산서'} 발급을 거절했어요`);
        }
      },
      park: (id, reason) => {
        setSheetId(null);
        patch(id, (x) => ({ ...x, state: 'needPc', reason, gate: undefined }));
      },
      rerequest: (id) => {
        if (!simulate) return setSheetId(null);
        patch(id, (x) => (x.gate ? { ...x, gate: { ...x.gate, challenge: b64(randomBytes(32)), exp: Date.now() + GATE_TTL_MS } } : x));
      },
    }),
    [jobs, last, notes, sheetId, used, approval.attest, approval.iosAllowed, simulate],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useQueue(): QueueStore {
  const q = useContext(Ctx);
  if (!q) throw new Error('queue: no provider');
  return q;
}
