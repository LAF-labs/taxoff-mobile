import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { answerGate, askRefresh, askRetryCert, askSimple, busyWaiting, deniedByPhone, jobOf, needsRedate, redate, reentrust, settled, simpleRequestValue } from './phoneCmd';
import type { SimpleId } from './storage/state';
import { SessionContext } from './session';
import { jobTimers } from './jobTimers';
import { josa } from './ui/josa';
import { DAILY_LIMIT, type AttestState } from './approval';
import type { ChatItem } from './chat';
import { actionsFor, applyAction, startAll as startAllJobs, stateAt, type DoneJob, type Job, type JobAction, type NeedPcReason } from './queue';
import type { RunAction, RunView } from './run';
import type { Counterparty, VatMode } from './issue';

export interface ApprovalSettings {
  attest: AttestState;
  iosAllowed: boolean;
  usedToday: number;
}

interface QueueStore {
  jobs: Job[];
  last: DoneJob | null;
  act: (id: string, action: JobAction) => void;
  startAll: () => void;
  noteCmd: (jobId: string, text: string | null) => void;
  add: (job: Job, note: string) => void;
  notes: ChatItem[];
  addCard: (item: ChatItem) => void;
  markSent: (itemId: string) => void;
  draftEdits: ReadonlyMap<string, DraftEdit>;
  editDraft: (itemId: string, edit: DraftEdit) => void;
  approval: ApprovalSettings;
  sheetJob: Job | null;
  openSheet: (id: string) => void;
  closeSheet: () => void;
  decide: (id: string, decision: 'approve' | 'deny', signed?: { reqId: string; actionHash: string; sig: string }) => void;
  park: (id: string, reason: NeedPcReason) => void;
  rerequest: (id: string) => void;
  runAction: (id: string, action: RunAction) => void;
  simpleAuth: (id: string, v: SimpleId) => void;
  simpleJob: Job | null;
  closeSimple: () => void;
  focus: Job | null;
  setFocus: (id: string | null) => void;
  counterparties: Counterparty[];
  addCounterparty: (cp: Counterparty, pcOnline: boolean) => void;
  pickId: string | null;
  setPick: (id: string) => void;
  prefill: IssuePrefill | null;
  setPrefill: (p: IssuePrefill | null) => void;
  clearPick: () => void;
}

export interface DraftEdit {
  amount: number;
  vat: VatMode;
  item: string;
}

export interface IssuePrefill {
  amount: number;
  vat: 'separate' | 'included' | null;
  item: string | null;
  draftId?: string;
}

const Ctx = createContext<QueueStore | null>(null);

export function QueueProvider({
  initial = [], last = null, notes: initialNotes = [], approval: approvalProp, sheet = null, focus: initialFocus = null, counterparties: initialCps = [], pick = null, children,
}: {
  initial?: Job[]; last?: DoneJob | null; notes?: ChatItem[]; approval?: ApprovalSettings;
  sheet?: string | null;
  focus?: string | null;
  counterparties?: Counterparty[];
  pick?: string | null;
  children: ReactNode;
}) {
  const [localJobs, setJobs] = useState<Job[]>(initial);
  const sess = useContext(SessionContext);
  const cmds = sess?.data.cmds;
  const jobs = useMemo(() => [...localJobs, ...(cmds ?? []).filter((c) => !deniedByPhone(c)).map(jobOf)], [localJobs, cmds]);
  const pxOk = sess?.data.px?.state === 'enrolled';
  const left = sess?.data.pcCopy?.todayApprovalsLeft;
  const approval = useMemo<ApprovalSettings>(
    () => approvalProp ?? { attest: pxOk ? 'ios_se' : 'none', iosAllowed: true, usedToday: left === undefined ? 0 : Math.max(0, DAILY_LIMIT - left) },
    [approvalProp, pxOk, left],
  );
  const [notes, setNotes] = useState<ChatItem[]>(initialNotes);
  const [sheetId, setSheetId] = useState<string | null>(sheet);
  const [simpleId, setSimpleId] = useState<string | null>(null);
  const [usedLocal, setUsed] = useState(0);
  const used = approval.usedToday + usedLocal;
  const [focusId, setFocusId] = useState<string | null>(initialFocus);
  const [cps, setCps] = useState<Counterparty[]>(initialCps);
  const [pickId, setPickId] = useState<string | null>(pick);
  const [prefill, setPrefill] = useState<IssuePrefill | null>(null);
  const [draftEdits, setDraftEdits] = useState<ReadonlyMap<string, DraftEdit>>(new Map());
  const setRun = (id: string, f: (r: RunView | undefined, j: Job) => RunView, extra: Partial<Job> = {}) => patch(id, (j) => ({ ...j, ...extra, run: f(j.run, j) }));
  const timers = useRef(jobTimers()).current;
  useEffect(() => () => timers.clearAll(), [timers]);
  const note = (id: string, text: string) => setNotes((n) => [...n, { kind: 'note', id: `note-${id}-${Date.now()}`, at: Date.now(), text }]);
  const patch = (id: string, f: (j: Job) => Job) => setJobs((js) => js.map((j) => (j.id === id ? f(j) : j)));
  const store = useMemo<QueueStore>(
    () => ({
      jobs,
      last,
      notes,
      addCard: (item) => setNotes((n) => [...n, item]),
      markSent: (itemId) => setNotes((n) => n.map((x) => (x.id === itemId && x.kind === 'msg' && x.card ? { ...x, card: { ...x.card, sent: true } } : x))),
      draftEdits,
      editDraft: (itemId, edit) => setDraftEdits((m) => new Map(m).set(itemId, edit)),
      approval: { ...approval, usedToday: used },
      sheetJob: jobs.find((j) => j.id === sheetId && j.gate) ?? null,
      simpleJob: jobs.find((j) => j.id === simpleId) ?? null,
      closeSimple: () => setSimpleId(null),
      noteCmd: (jobId, text) => {
        const now = Date.now();
        if (text === null) setNotes((n) => [...n, { kind: 'run', id: `run-${jobId}`, at: now, jobId }]);
        else note(jobId, text);
      },
      act: (id, action) => {
        const now = Date.now();
        const j = jobs.find((x) => x.id === id);
        if (!j || !actionsFor(j, stateAt(j, now)).includes(action)) return;
        if (action === 'retry' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? reentrust(c, now) : c)) }));
          return;
        }
        if (action === 'dismiss' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmdId || !settled(c)) }));
          return;
        }
        if (action === 'redate' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? redate(c) : c)) })).then(() => sess.sync());
          return;
        }
        if (action === 'cancel' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmdId || (!!c.sentAt && !busyWaiting(c) && !needsRedate(c))) }));
          return;
        }
        if (action === 'cancel') timers.clear(id);
        setJobs((js) => applyAction(js, id, action, now));
      },
      startAll: () => setJobs((js) => startAllJobs(js, Date.now())),
      add: (job, text) => {
        const now = Date.now();
        setJobs((js) => [...js, job.state === 'running' ? { ...job, run: { kind: 'running', step: 'prepare', startedAt: now } } : job]);
        if (job.state === 'running') setNotes((n) => [...n, { kind: 'run', id: `run-${job.id}`, at: now, jobId: job.id }]);
        else note(job.id, text);
      },
      openSheet: (id) => setSheetId(id),
      closeSheet: () => setSheetId(null),
      decide: (id, decision, signed) => {
        const j = jobs.find((x) => x.id === id);
        setSheetId(null);
        if (id.startsWith('cmd-')) {
          if (!signed) return;
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? answerGate(c, { ...signed, decision }) : c)) })).then(() => sess.sync());
          if (decision === 'deny') note(id, `${j?.title ?? '세금계산서'} 발급을 거절했어요`);
          return;
        }
        if (decision === 'approve') {
          setUsed((u) => u + 1);
          const startedAt = j?.run?.startedAt ?? Date.now();
          setRun(id, () => ({ kind: 'running', step: 'issue', startedAt }), { state: 'running', gate: undefined });
          if (!j?.run) note(id, `${josa(j?.title ?? '세금계산서', '을', '를')} 승인했어요. PC가 홈택스에서 발급하고 있어요`);
        } else {
          timers.clear(id);
          setJobs((js) => js.filter((x) => x.id !== id));
          note(id, `${j?.title ?? '세금계산서'} 발급을 거절했어요`);
        }
      },
      park: (id, reason) => {
        timers.clear(id);
        setSheetId(null);
        if (id.startsWith('cmd-')) return;
        patch(id, (x) => ({ ...x, state: 'needPc', reason, gate: undefined }));
      },
      simpleAuth: (id, v) => {
        if (!id.startsWith('cmd-')) return;
        const cmdId = id.slice(4);
        const value = simpleRequestValue(v);
        if (!value) return;
        setSimpleId(null);
        void sess?.update((d) => ({ ...d, simpleId: v, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? askSimple(c, value, v.provider) : c)) })).then(() => sess?.sync());
      },
      runAction: (id, a) => {
        if (a === 'simpleAuth') return setSimpleId(id);
        if ((a === 'authDone' || a === 'resendAuth') && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess
            ?.update((d) => {
              const value = a === 'authDone' ? 'sa1:done' : d.simpleId ? simpleRequestValue(d.simpleId) : null;
              return value ? { ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? askSimple(c, value) : c)) } : d;
            })
            .then(() => sess?.sync());
          return;
        }
        if (a === 'retryCert' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? askRetryCert(c) : c)) })).then(() => sess?.sync());
          return;
        }
        const j = jobs.find((x) => x.id === id);
        if (!j?.run) return;
        const startedAt = j.run.startedAt;
        if (a === 'stop') {
          timers.clear(id);
          setJobs((js) => js.filter((x) => x.id !== id));
          note(id, `${j.title} 발급을 중지했어요. 아무것도 발급하지 않았어요`);
        } else if (a === 'reserveOnPc') {
          timers.clear(id);
          setRun(id, (r) => (r?.kind === 'stopped' ? { ...r, reserved: true } : { kind: 'stopped', step: 'login', reason: 'unknownScreen', startedAt, reserved: true }));
          note(id, `PC에서 ${josa(j.title, '을', '를')} 먼저 열어 둘게요`);
        } else if (a === 'retryPrepare' || a === 'resendAuth') {
          setRun(id, () => ({ kind: 'running', step: a === 'resendAuth' ? 'login' : 'prepare', startedAt }));
        }
      },
      counterparties: cps,
      addCounterparty: (cp, pcOnline) => {
        setCps((xs) => [...xs, { ...cp, status: pcOnline ? { kind: 'checking' } : { kind: 'waitPc' } }]);
        setPickId(cp.id);
      },
      pickId,
      setPick: (id) => setPickId(id),
      clearPick: () => setPickId(null),
      prefill,
      setPrefill,
      focus: jobs.find((j) => j.id === focusId) ?? null,
      setFocus: (id) => setFocusId(id),
      rerequest: (id) => {
        if (id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? askRefresh(c) : c)) })).then(() => sess.sync());
          return;
        }
        setSheetId(null);
      },
    }),
    [jobs, last, notes, draftEdits, sheetId, simpleId, used, focusId, cps, pickId, prefill, approval, sess],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useQueue(): QueueStore {
  const q = useContext(Ctx);
  if (!q) throw new Error('queue: no provider');
  return q;
}
