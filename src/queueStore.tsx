// 밀린 일 가짜 저장소(기획 v2 PR 2·5): 메모리에만 둔다. PC와 주고받는 프로토콜이 생기면 세션으로 옮긴다.
// 승인 시트(P-03)도 여기서 연다: 승인 대기 일에 PC 승인 요청(gate)이 붙어 있으면 그 일의 시트를 띄운다.
// simulate(갤러리·시연 전용): PC가 켜져 맡긴 발급이 준비 → 홈택스 로그인 → 값 확인을 지나 "PC가 승인 요청함"이 되고 시트가 뜬다.
//   승인하면 발급 → 확인 → 결과 카드. simulate='inDoubt'이면 발급 뒤 응답이 끊겨 확인 중(조회 n회째) → 확인 필요로 간다.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { answerGate, askRefresh, busyWaiting, deniedByPhone, jobOf, redate, settled } from './phoneCmd';
import { SessionContext } from './session';
import { jobTimers } from './jobTimers';
import { josa } from './ui/josa';
import { DAILY_LIMIT, GATE_TTL_MS, buildGate, type AttestState, type PhoneGate, type READBACK_KEYS } from './approval';
import type { ChatItem } from './chat';
import { applyAction, startAll as startAllJobs, type DoneJob, type Job, type JobAction, type NeedPcReason } from './queue';
import type { IssueResult, RunAction, RunView } from './run';
import type { Counterparty } from './issue';
import sampleDoc from '../assets/sample/tax-invoice.pdf';
import { b64, randomBytes } from '../vendor/sax-remote/src/index.ts';

export type Readback = Record<(typeof READBACK_KEYS)[number], string>;

export interface ApprovalSettings {
  attest: AttestState;
  /** iPhone(앱 무결성만)을 승인 기기로 받는지. ADR-046 결정 4 채택(tex #403)으로 기본은 받는다. false는 정책으로 막은 경우 */
  iosAllowed: boolean;
  usedToday: number;
}

export interface QueueStore {
  jobs: Job[];
  /** 마지막으로 끝난 일(빈 화면 한 줄) */
  last: DoneJob | null;
  act: (id: string, action: JobAction) => void;
  startAll: () => void;
  /** 폰 발급 명령(AppData.cmds)의 진행 카드를 대화에 붙인다(cmd.run을 보낸 뒤). 맡겨 둔 것이면 확인 한 줄. */
  noteCmd: (jobId: string, text: string | null) => void;
  /** 맡기고 대화에 확인 한 줄을 남긴다. readback은 시연(simulate)에서 PC가 되읽을 값. */
  add: (job: Job, note: string, readback?: Readback) => void;
  /** 이 폰에서 남긴 확인 줄(홈 대화 끝에 붙는다) */
  notes: ChatItem[];
  approval: ApprovalSettings;
  /** 승인 시트가 열린 일 */
  sheetJob: Job | null;
  openSheet: (id: string) => void;
  closeSheet: () => void;
  /** 승인: 진행 중으로(결과가 오기 전), 거절: 밀린 일에서 뺀다. 폰 발급 명령(cmd-)은 서명한 답(signed)을 PC로 보낸다. */
  decide: (id: string, decision: 'approve' | 'deny', signed?: { reqId: string; actionHash: string; sig: string }) => void;
  /** 폰에서 승인할 수 없어 PC 앞 필요로 둔다. */
  park: (id: string, reason: NeedPcReason) => void;
  /** 만료된 승인 요청을 PC에 다시 요청(시연에서는 새 마감으로 다시 온다). */
  rerequest: (id: string) => void;
  /** 진행 카드의 동작(다시 준비·다시 요청·중지·PC에서 열기 예약) */
  runAction: (id: string, action: RunAction) => void;
  /** 진행·결과·서류 화면이 보는 일 */
  focus: Job | null;
  setFocus: (id: string | null) => void;
  /** 거래처(이 폰에서 만든 것. PC 사본은 ADR-046 결정 5 뒤) */
  counterparties: Counterparty[];
  /** 등록증으로 만든 거래처를 더하고 발급 작성에서 골라 둔다. PC가 켜져 있으면 휴·폐업 확인 중, 꺼져 있으면 켜지면 확인. */
  addCounterparty: (cp: Counterparty, pcOnline: boolean) => void;
  /** 발급 작성이 열릴 때 골라 둘 거래처 */
  pickId: string | null;
  setPick: (id: string) => void;
  /** 대화 카드에서 [발급 맡기기]로 열 때 발급 작성에 채워 둘 값(거래처는 pickId) */
  prefill: IssuePrefill | null;
  setPrefill: (p: IssuePrefill | null) => void;
  clearPick: () => void;
}

/** 대화 카드(폰 대화 코어의 초안) → 발급 작성 */
export interface IssuePrefill {
  /** 말한 금액(원). vat가 included면 합계, 아니면 공급가 */
  amount: number;
  vat: 'separate' | 'included' | null;
  item: string | null;
  /** 폰 대화 카드 id. 발급을 맡기면 그 카드를 맡김으로 바꾼다 */
  draftId?: string;
}

/** 번들 견본 서류(다음 PR에서 PC가 보낸 암호 파일을 풀어 쓴다) */
export const SAMPLE_DOC = sampleDoc;

const Ctx = createContext<QueueStore | null>(null);

const SIM_SUPPLIER = { supplierBizNo: '123-45-67890', supplierName: '택스오프상회' };

export function QueueProvider({
  initial = [], last = null, notes: initialNotes = [], approval: approvalProp, sheet = null, simulate = false, focus: initialFocus = null, counterparties: initialCps = [], pick = null, children,
}: {
  initial?: Job[]; last?: DoneJob | null; notes?: ChatItem[]; approval?: ApprovalSettings;
  /** 처음부터 열어 둘 승인 시트(갤러리) */
  sheet?: string | null;
  simulate?: boolean | 'inDoubt';
  focus?: string | null;
  counterparties?: Counterparty[];
  pick?: string | null;
  children: ReactNode;
}) {
  const [localJobs, setJobs] = useState<Job[]>(initial);
  // 폰 발급 명령(봉인 상태 파일)은 세션에서 읽어 일로 바꿔 붙인다. 갤러리 가짜 세션에도 있다.
  const sess = useContext(SessionContext);
  const cmds = sess?.data.cmds;
  // 폰에서 거절해 그 답을 보낸 명령은 밀린 일에서 뺀다(PC가 그 실행을 멈춘다)
  const jobs = useMemo(() => [...localJobs, ...(cmds ?? []).filter((c) => !deniedByPhone(c)).map(jobOf)], [localJobs, cmds]);
  // 승인 설정: 갤러리는 값을 준다. 앱은 PC의 답으로 정한다(승인 키를 PC가 받았을 때만 승인 기기, 오늘 남은 횟수는 PC 사본).
  const pxOk = sess?.data.px?.state === 'enrolled';
  const left = sess?.data.pcCopy?.todayApprovalsLeft;
  const approval = useMemo<ApprovalSettings>(
    () => approvalProp ?? { attest: pxOk ? 'ios_se' : 'none', iosAllowed: true, usedToday: left === undefined ? 0 : Math.max(0, DAILY_LIMIT - left) },
    [approvalProp, pxOk, left],
  );
  const [notes, setNotes] = useState<ChatItem[]>(initialNotes);
  const [sheetId, setSheetId] = useState<string | null>(sheet);
  const [usedLocal, setUsed] = useState(0);
  const used = approval.usedToday + usedLocal;
  // PC가 새 승인 요청을 보내면 그 일의 시트를 띄운다(요청마다 한 번. 닫은 시트를 다시 띄우지 않는다)
  const shown = useRef(new Set<string>()).current;
  useEffect(() => {
    for (const j of jobs) {
      if (!j.id.startsWith('cmd-') || j.state !== 'approval' || !j.gate || shown.has(j.gate.reqId)) continue;
      shown.add(j.gate.reqId);
      // 열려 있던 시트의 일이 요청을 잃었으면(PC가 거뒀거나 승인 단계를 지남) 그 자리는 빈 것으로 본다
      if (j.gate.exp > Date.now()) setSheetId((cur) => (cur && jobs.some((x) => x.id === cur && x.gate) ? cur : j.id));
    }
  }, [jobs, shown]);
  const [focusId, setFocusId] = useState<string | null>(initialFocus);
  const [cps, setCps] = useState<Counterparty[]>(initialCps);
  const [pickId, setPickId] = useState<string | null>(pick);
  const [prefill, setPrefill] = useState<IssuePrefill | null>(null);
  const setRun = (id: string, f: (r: RunView | undefined, j: Job) => RunView, extra: Partial<Job> = {}) => patch(id, (j) => ({ ...j, ...extra, run: f(j.run, j) }));
  // 일별 타이머: 같은 일의 흐름을 다시 시작하면 앞 흐름을 지운다(겹치지 않게). 저장소가 사라질 때도 지운다.
  const timers = useRef(jobTimers()).current;
  useEffect(() => () => timers.clearAll(), [timers]);
  /** 시연: 준비 → 로그인 → 값 확인 → 승인 요청 */
  const drivePrepare = (id: string, readback: Readback, startedAt: number) => {
    timers.clear(id);
    setRun(id, () => ({ kind: 'running', step: 'prepare', startedAt }));
    timers.at(id, 700, () => setRun(id, () => ({ kind: 'running', step: 'login', startedAt })));
    timers.at(id, 1400, () => setRun(id, () => ({ kind: 'running', step: 'readback', startedAt })));
    timers.at(id, 2100, () => {
      setRun(id, () => ({ kind: 'running', step: 'approve', startedAt }), { state: 'approval', gate: fakeGate({ ...readback, ...SIM_SUPPLIER }) });
      setSheetId(id);
    });
  };
  const readbacks = useRef(new Map<string, Readback>()).current;
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
      noteCmd: (jobId, text) => {
        const now = Date.now();
        if (text === null) setNotes((n) => [...n, { kind: 'run', id: `run-${jobId}`, at: now, jobId }]);
        else note(jobId, text);
      },
      act: (id, action) => {
        if (action === 'dismiss' && id.startsWith('cmd-')) {
          // 끝난(거절·중지) 명령만 목록에서 지운다. 아직 PC가 들고 있을 수 있는 명령은 건드리지 않는다
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmdId || !settled(c)) }));
          return;
        }
        if (action === 'redate' && id.startsWith('cmd-')) {
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? redate(c) : c)) }));
          return;
        }
        if (action === 'cancel' && id.startsWith('cmd-')) {
          // 아직 보내지 않았거나 PC가 다른 일 중이라 기다리는 명령만 지운다(PC가 시작한 명령은 PC에서 멈춘다)
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmdId || (!!c.sentAt && !busyWaiting(c))) }));
          return;
        }
        if (action === 'cancel') timers.clear(id);
        setJobs((js) => applyAction(js, id, action, Date.now()));
      },
      startAll: () => setJobs((js) => startAllJobs(js, Date.now())),
      add: (job, text, readback) => {
        const now = Date.now();
        setJobs((js) => [...js, job.state === 'running' ? { ...job, run: { kind: 'running', step: 'prepare', startedAt: now } } : job]);
        if (job.state === 'running') setNotes((n) => [...n, { kind: 'run', id: `run-${job.id}`, at: now, jobId: job.id }]);
        else note(job.id, text);
        if (simulate && readback && job.state === 'running') {
          readbacks.set(job.id, readback);
          drivePrepare(job.id, readback, now);
        }
      },
      openSheet: (id) => setSheetId(id),
      closeSheet: () => setSheetId(null),
      decide: (id, decision, signed) => {
        const j = jobs.find((x) => x.id === id);
        setSheetId(null);
        if (id.startsWith('cmd-')) {
          // 폰 발급 명령: 서명한 답을 적어 두면 라이브 세션이 보낸다(net/issueLive.ts). 서명이 없으면 아무것도 하지 않는다
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
          if (simulate && j?.gate) {
            timers.clear(id);
            const f = Object.fromEntries(j.gate.fields.map((x) => [x.key, x.value]));
            if (simulate === 'inDoubt') {
              timers.at(id, 1200, () => setRun(id, () => ({ kind: 'inDoubt', tries: 1, startedAt }), { state: 'verify' }));
              timers.at(id, 2700, () => setRun(id, () => ({ kind: 'inDoubt', tries: 2, startedAt })));
              timers.at(id, 4200, () => setRun(id, () => ({ kind: 'inDoubt', tries: 3, startedAt })));
              timers.at(id, 5700, () => setRun(id, () => ({ kind: 'verify', startedAt })));
            } else {
              timers.at(id, 1200, () => setRun(id, () => ({ kind: 'running', step: 'verify', startedAt })));
              timers.at(id, 2200, () => setRun(id, () => ({ kind: 'done', startedAt, result: sampleResult(f) }), { state: 'done' }));
            }
          }
        } else {
          timers.clear(id);
          setJobs((js) => js.filter((x) => x.id !== id));
          note(id, `${j?.title ?? '세금계산서'} 발급을 거절했어요`);
        }
      },
      park: (id, reason) => {
        timers.clear(id);
        setSheetId(null);
        // 폰 발급 명령: 폰에서 승인할 수 없는 요청은 그대로 둔다(PC 승인 바에서 한다)
        if (id.startsWith('cmd-')) return;
        patch(id, (x) => ({ ...x, state: 'needPc', reason, gate: undefined }));
      },
      runAction: (id, a) => {
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
          const rb = readbacks.get(id);
          if (simulate && rb) drivePrepare(id, rb, startedAt);
          else setRun(id, () => ({ kind: 'running', step: a === 'resendAuth' ? 'login' : 'prepare', startedAt }));
        }
      },
      counterparties: cps,
      addCounterparty: (cp, pcOnline) => {
        setCps((xs) => [...xs, { ...cp, status: pcOnline ? { kind: 'checking' } : { kind: 'waitPc' } }]);
        setPickId(cp.id);
        // 시연: PC가 조회를 마치면 정상으로
        if (simulate && pcOnline) timers.at(cp.id, 1800, () => setCps((xs) => xs.map((c) => (c.id === cp.id ? { ...c, status: { kind: 'ok' } } : c))));
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
          // 마감이 지난 요청을 PC에 다시 달라고 한다. 새 요청이 오면 시트가 새 마감으로 바뀐다
          const cmdId = id.slice(4);
          void sess?.update((d) => ({ ...d, cmds: (d.cmds ?? []).map((c) => (c.cmdId === cmdId ? askRefresh(c) : c)) })).then(() => sess.sync());
          return;
        }
        if (!simulate) return setSheetId(null);
        patch(id, (x) => (x.gate ? { ...x, gate: { ...x.gate, challenge: b64(randomBytes(32)), exp: Date.now() + GATE_TTL_MS } } : x));
      },
    }),
    [jobs, last, notes, sheetId, used, focusId, cps, pickId, prefill, approval, simulate, sess],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 시연 결과: 게이트 값에서 거래처·합계·이메일을 가져온다(승인번호는 견본). */
function sampleResult(f: Record<string, string>): IssueResult {
  const email = f.counterpartEmail || null;
  const name = f.counterpartName ?? '거래처';
  return {
    approvalNo: '20261116-41000000-12345678',
    counterpart: name,
    total: Number(f.totalAmount ?? 0),
    email,
    emailSent: !!email,
    issuedAt: Date.now(),
    doc: { name: `세금계산서_${name.replace(/\s+/g, '')}_${(f.issueDate ?? '').replace(/-/g, '')}.pdf`, issuedOn: f.issueDate ?? '', uri: '' },
  };
}

export function useQueue(): QueueStore {
  const q = useContext(Ctx);
  if (!q) throw new Error('queue: no provider');
  return q;
}
