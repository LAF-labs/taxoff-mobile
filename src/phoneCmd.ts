import type { CmdAckBody, CmdAckState, CmdRejectReason, CmdRunBody, GateRequestBody, GateResolvedBody, GateResolvedBy, GateResponseBody, PhoneAmendRequest, PhoneIssueRequest, RunEventBody, RunPhase, RunResult } from '@sax/remote';
import { amendCmd, issueCmd } from '../vendor/sax-remote/src/issue.ts';
import type { PhoneGate } from './approval';
import type { Job, NeedPcReason } from './queue';
import { PASS_CARRIERS, STEPS, simpleAppOf, type RunView, type Step } from './run.ts';

export interface PhoneCmd {
  cmdId: string;
  req: PhoneIssueRequest;
  /** 수정세금계산서(ADR-058 결정 8)면 사장님이 카드에서 고른 사유와 고친 값. 있으면 req 대신 이것을 보낸다(req는 거래처와 날짜 기록용). */
  amend?: PhoneAmendRequest;
  /** 진행 카드와 기록에 보일 제목(수정이면 "거래처 세금계산서 고치기"). 없으면 "거래처 세금계산서". */
  title?: string;
  cpName: string;
  total: number;
  createdAt: number;
  sentAt?: number;
  /** PC가 꺼져 있어 릴레이 큐에 맡긴 때. PC는 켜지자마자 큐에서 받아 시작한다. */
  queuedAt?: number;
  ack?: CmdAckState;
  runId?: string;
  reason?: CmdRejectReason;
  pcOld?: boolean;
  phase?: RunPhase;
  at?: number;
  code?: string;
  turn?: boolean;
  resumeAt?: number;
  resumeSentAt?: number;
  simpleReq?: string;
  simpleOut?: string;
  simpleOutSentAt?: number;
  simpleApp?: string;
  simpleFailed?: boolean;
  deadline?: number;
  attempt?: number;
  result?: RunResult;
  rev?: number;
  resolvedBy?: GateResolvedBy;
  gate?: CmdGate;
  answer?: CmdAnswer;
  refresh?: string;
  retryAt?: number;
  retries?: number;
}

export interface CmdGate extends PhoneGate {
  stepId: string;
}
export interface CmdAnswer {
  reqId: string;
  stepId: string;
  decision: 'approve' | 'deny';
  actionHash: string;
  sig: string;
  exp: number;
  sentAt?: number;
}

export const BUSY_RETRY_MS = 30_000;
export const BUSY_GIVE_UP_MS = 72 * 3_600_000;

export function busyWaiting(c: PhoneCmd, now = Date.now()): boolean {
  return !c.pcOld && c.ack === 'rejected' && c.reason === 'pc_busy' && now - c.createdAt < BUSY_GIVE_UP_MS;
}

export const needsRedate = (c: PhoneCmd, now = Date.now()): boolean => busyWaiting(c, now) && c.req.day !== kstDay(now);

export const retryDue = (c: PhoneCmd, now = Date.now()): boolean => busyWaiting(c, now) && !needsRedate(c, now) && (c.retryAt ?? 0) <= now;

export function forRetry(c: PhoneCmd): PhoneCmd {
  return { ...c, ack: undefined, reason: undefined, retryAt: undefined, retries: (c.retries ?? 0) + 1 };
}

export function redate(c: PhoneCmd, now = Date.now()): PhoneCmd {
  return { ...c, req: { ...c.req, day: kstDay(now) }, retryAt: now };
}

export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 거래처는 PC가 아는 ID(counterpartyRef)나, 폰에서 막 넣어 PC가 아직 모르는 등록번호와 상호(newCounterparty) 둘 중 하나. */
export type IssueTarget = Pick<PhoneIssueRequest, 'counterpartyRef' | 'newCounterparty'>;

export function issueRequest(p: { target: IssueTarget; supply: number; item: string; now?: number }): PhoneIssueRequest {
  return { ...p.target, supply: p.supply, tax: Math.floor(p.supply / 10), item: p.item.trim(), day: kstDay(p.now) };
}

/** PC에 보낼 cmd.run 본문(발급 또는 수정). */
export function cmdBody(c: PhoneCmd): CmdRunBody {
  return c.amend ? amendCmd(c.cmdId, c.amend) : issueCmd(c.cmdId, c.req);
}

const isReattach = (a: CmdAckBody): boolean => a.state === 'rejected' && a.reason === 'duplicate' && !!a.runId;

export function applyAck(c: PhoneCmd, a: CmdAckBody, now = Date.now()): PhoneCmd {
  if (a.cmdId !== c.cmdId) return c;
  if (isReattach(a)) return { ...c, ack: c.ack && c.ack !== 'rejected' ? c.ack : 'pc_only', runId: a.runId, reason: undefined };
  if (a.state === 'rejected' && c.phase) return c;
  if (a.state === 'rejected' && a.reason === 'pc_busy') return { ...c, ack: 'rejected', reason: 'pc_busy', runId: a.runId ?? c.runId, retryAt: now + BUSY_RETRY_MS };
  return { ...c, ack: a.state, runId: a.runId ?? c.runId, reason: a.state === 'rejected' ? a.reason : undefined };
}

export function applyEvent(c: PhoneCmd, e: RunEventBody): PhoneCmd {
  const mine = (c.runId && e.runId === c.runId) || (e.cmdId && e.cmdId === c.cmdId);
  if (!mine) return c;
  if (e.rev !== undefined && c.rev !== undefined) {
    if (e.rev <= c.rev) return c;
  } else if (c.at !== undefined && e.at < c.at) return c;
  const next: PhoneCmd = { ...c, runId: c.runId ?? e.runId, at: e.at, rev: e.rev ?? c.rev };
  if (!next.ack || next.ack === 'rejected') next.ack = 'pc_only';
  if (e.phase) next.phase = e.phase;
  next.code = e.code;
  if ((e.phase && e.phase !== 'approve') || (e.phase === 'approve' && e.code)) {
    next.gate = undefined;
    next.refresh = undefined;
  }
  next.turn = e.event === 'turn' ? true : undefined;
  next.deadline = e.deadline;
  if (next.simpleOutSentAt !== undefined) {
    next.simpleOut = undefined;
    next.simpleOutSentAt = undefined;
  }
  next.simpleFailed = e.code === 'login.simple_failed' ? true : e.code?.startsWith('login.simple_sent') ? false : next.simpleFailed;
  if (e.code === 'login.simple_failed') next.code = 'login.simple_auth';
  const sent = /^login\.simple_sent\.([a-z]{2,10})$/.exec(e.code ?? '');
  if (sent) next.simpleApp = sent[1];
  if (!next.turn) next.simpleReq = undefined;
  if (next.resumeSentAt !== undefined) {
    next.resumeAt = undefined;
    next.resumeSentAt = undefined;
  }
  if (e.attempt !== undefined) next.attempt = e.attempt;
  if (e.result) next.result = e.result;
  return next;
}

const PC_CODE_REASON: Readonly<Record<string, NeedPcReason>> = { pc_first: 'firstCounterparty', pc_limit: 'dailyLimit', pc_key: 'notApprover', pc_only: 'notApprover' };

export function applyGate(c: PhoneCmd, g: GateRequestBody): PhoneCmd {
  if (!c.runId || g.runId !== c.runId) return c;
  if (g.gateKind !== 'commit' || g.requiredSigAlg !== 'p256') return c;
  if (c.answer?.sentAt && c.answer.reqId === g.reqId) return c;
  const gate: CmdGate = { stepId: g.stepId, reqId: g.reqId, fields: g.fields, cardHashInputs: g.cardHashInputs, actionHash: g.actionHash, challenge: g.challenge, exp: g.exp };
  return { ...c, gate, answer: undefined, refresh: undefined, resolvedBy: undefined, phase: 'approve', code: c.code && c.code in PC_CODE_REASON ? undefined : c.code };
}

export function applyResolved(c: PhoneCmd, r: GateResolvedBody): PhoneCmd {
  if (!c.runId || r.runId !== c.runId) return c;
  const ours = c.gate?.reqId === r.reqId || c.refresh === r.reqId || c.answer?.reqId === r.reqId;
  if (!ours) return c;
  const answer = c.answer?.reqId === r.reqId && !c.answer.sentAt ? undefined : c.answer;
  return { ...c, gate: c.gate?.reqId === r.reqId ? undefined : c.gate, refresh: c.refresh === r.reqId ? undefined : c.refresh, answer, resolvedBy: r.by };
}

export function openGate(c: PhoneCmd, now = Date.now()): CmdGate | null {
  if (!c.gate) return null;
  if (c.answer && c.answer.reqId === c.gate.reqId && (c.answer.sentAt || now <= c.answer.exp)) return null;
  return c.gate;
}

export function answerGate(c: PhoneCmd, a: { reqId: string; decision: 'approve' | 'deny'; actionHash: string; sig: string }, now = Date.now()): PhoneCmd {
  const g = openGate(c, now);
  if (!g || g.reqId !== a.reqId || g.actionHash !== a.actionHash || now > g.exp) return c;
  return { ...c, answer: { reqId: a.reqId, stepId: g.stepId, decision: a.decision, actionHash: a.actionHash, sig: a.sig, exp: g.exp } };
}

export function responseDue(c: PhoneCmd, now = Date.now()): GateResponseBody | null {
  const a = c.answer;
  if (!a || a.sentAt || !c.runId || now > a.exp) return null;
  return { runId: c.runId, stepId: a.stepId, reqId: a.reqId, decision: a.decision, actionHash: a.actionHash, sigAlg: 'p256', sig: a.sig };
}

export function markAnswered(c: PhoneCmd, reqId: string, now = Date.now()): PhoneCmd {
  if (c.answer?.reqId !== reqId) return c;
  return { ...c, answer: { ...c.answer, sentAt: now }, gate: undefined, refresh: undefined };
}

export function askRefresh(c: PhoneCmd, now = Date.now()): PhoneCmd {
  const g = openGate(c, now);
  return g && now > g.exp ? { ...c, refresh: g.reqId, answer: undefined } : c;
}

export const deniedByPhone = (c: PhoneCmd): boolean => c.answer?.decision === 'deny' && !!c.answer.sentAt;

export function settled(c: PhoneCmd, now = Date.now()): boolean {
  if (c.pcOld) return true;
  if (busyWaiting(c, now)) return false;
  if (c.ack === 'rejected') return true;
  if (deniedByPhone(c)) return true;
  if (c.phase === 'done') return !!c.result || c.code !== 'in_doubt';
  if (c.phase === 'stopped') return c.code !== 'in_doubt';
  return false;
}

export const REJECT_LINE: Record<CmdRejectReason | 'pc_old', string> = {
  playbook_unavailable: 'PC에 발급 절차가 아직 준비되지 않았어요. 아무것도 발급하지 않았어요.',
  input_invalid: 'PC가 이 내용을 받지 않았어요. 금액과 품목을 다시 확인해 주세요.',
  counterparty_unknown: '이 거래처를 찾지 못했어요. 거래처를 다시 골라 주세요.',
  duplicate: '같은 일을 이미 PC에 맡겼어요.',
  pc_busy: 'PC가 다른 일을 하고 있어요. 끝나면 다시 맡겨 주세요.',
  hometax_paused: '홈택스가 잠시 접속을 막아서 PC가 발급을 쉬고 있어요. 아무것도 발급하지 않았어요.',
  pc_old: 'PC 앱이 오래된 버전이라 폰에서 맡길 수 없어요.',
};

export function runViewOf(c: PhoneCmd): RunView | null {
  const startedAt = c.sentAt ?? c.createdAt;
  if (c.pcOld) return { kind: 'refused', reason: 'pc_old', startedAt };
  if (c.ack === 'rejected') return { kind: 'refused', reason: c.reason ?? 'input_invalid', startedAt };
  if (!c.ack) return c.sentAt ? { kind: 'running', step: 'prepare', startedAt, pcApproval: true } : null;
  if (c.turn && (c.resumeAt !== undefined || c.simpleOut !== undefined)) return { kind: 'running', step: 'login', startedAt, pcApproval: true };
  if (c.turn && c.code?.startsWith('login.simple_sent')) {
    const a = simpleAppOf(c.simpleApp ?? '');
    return { kind: 'myTurn', step: 'login', auth: { method: 'simple', app: a?.app ?? '인증 앱', pc: true, ...(c.deadline ? { deadline: c.deadline } : {}) }, startedAt };
  }
  if (c.turn && c.phase && c.phase !== 'done' && c.phase !== 'stopped') {
    const step = (STEPS as readonly string[]).includes(c.phase) ? (c.phase as Step) : 'login';
    return { kind: 'myTurn', step, auth: { method: 'pc', ...(c.code ? { code: c.code } : {}), ...(c.simpleReq ? { canSimple: true } : {}), ...(c.simpleFailed ? { failed: true } : {}) }, startedAt };
  }
  if (c.code === 'in_doubt') return c.phase === 'stopped' ? { kind: 'verify', startedAt } : { kind: 'inDoubt', tries: Math.max(1, c.attempt ?? 1), startedAt };
  switch (c.phase) {
    case undefined:
      return { kind: 'running', step: 'prepare', startedAt, pcApproval: true };
    case 'done':
      if (!c.result) return { kind: 'verify', startedAt };
      return {
        kind: 'done',
        startedAt,
        result: {
          approvalNo: c.result.approvalNo,
          counterpart: c.cpName,
          total: c.result.total,
          email: null,
          ...(c.result.emailSent === undefined ? {} : { emailSent: c.result.emailSent }),
          issuedAt: c.at ?? Date.now(),
          doc: { name: `${c.amend ? '수정세금계산서' : '세금계산서'}_${c.cpName.replace(/\s+/g, '')}_${c.req.day.replace(/-/g, '')}.pdf`, issuedOn: c.req.day, uri: '' },
        },
      };
    case 'stopped':
      return { kind: 'stopped', step: 'prepare', reason: c.code === 'app_old' ? 'appOld' : 'pcStopped', startedAt };
    case 'approve':
      if (c.answer?.sentAt && c.answer.decision === 'approve') return { kind: 'running', step: 'issue', startedAt };
      return { kind: 'running', step: 'approve', startedAt, pcApproval: !c.gate && !c.answer };
    default:
      return { kind: 'running', step: c.phase, startedAt, pcApproval: true };
  }
}

export const canRetryCert = (c: PhoneCmd): boolean => !!c.turn && c.code === 'login.simple_auth' && !!c.runId && c.resumeAt === undefined;

export function askRetryCert(c: PhoneCmd, now = Date.now()): PhoneCmd {
  return canRetryCert(c) ? { ...c, resumeAt: now, resumeSentAt: undefined } : c;
}

export function applyHumanRequest(c: PhoneCmd, b: { runId?: unknown; reqId?: unknown; kind?: unknown; prompt?: unknown }): PhoneCmd {
  if (!c.runId || b.runId !== c.runId || b.kind !== 'manual' || b.prompt !== 'simple_auth' || typeof b.reqId !== 'string') return c;
  return { ...c, simpleReq: b.reqId };
}

export function simpleRequestValue(id: { provider: string; name: string; birth: string; phone: string; carrier?: string }): string | null {
  const name = id.name.trim().replace(/:/g, '');
  const pass = id.provider === 'pass';
  if (pass ? !PASS_CARRIERS.some((c) => c.code === id.carrier) : id.carrier !== undefined) return null;
  const v = `sa1:req:${id.provider}${pass ? `-${id.carrier}` : ''}:${id.birth}:${id.phone}:${name}`;
  return simpleAppOf(id.provider) && /^\d{8}$/.test(id.birth) && /^01\d{8,9}$/.test(id.phone) && name && v.length <= 64 ? v : null;
}

export function askSimple(c: PhoneCmd, value: string, app?: string): PhoneCmd {
  if (!c.turn || !c.simpleReq) return c;
  return { ...c, simpleOut: value, simpleOutSentAt: undefined, ...(app ? { simpleApp: app } : {}) };
}

export function jobOf(c: PhoneCmd): Job {
  const title = c.title ?? `${c.cpName} 세금계산서`;
  const base = { id: `cmd-${c.cmdId}`, title, amount: c.total, createdAt: c.createdAt, pcOnly: true };
  if (needsRedate(c)) return { ...base, state: 'phoneWaiting', wait: 'newDay', waitDay: c.req.day };
  if (busyWaiting(c)) return { ...base, state: 'phoneWaiting', wait: 'pcBusy' };
  const run = runViewOf(c);
  if (!run) return { ...base, state: 'entrusted' };
  const gate = c.phase === 'approve' ? openGate(c) : null;
  if (gate && run.kind === 'running') return { ...base, state: 'approval', run, gate };
  const reason = c.phase === 'approve' && c.code ? PC_CODE_REASON[c.code] : undefined;
  if (reason && run.kind === 'running') return { ...base, state: 'running', run, reason };
  const state: Job['state'] = run.kind === 'done' ? 'done' : run.kind === 'verify' ? 'verify' : run.kind === 'refused' || run.kind === 'stopped' ? 'needPc' : 'running';
  return { ...base, state, run };
}

/** PC가 꺼져 있을 때 큐에 맡길 발급: 아직 PC에 닿지 않았고 큐에도 넣지 않은 것. 큐가 24시간 뒤 지우면 다시 넣는다. */
export function cmdsToQueue(cmds: readonly PhoneCmd[], ttlMs: number, now = Date.now()): PhoneCmd[] {
  return cmds.filter((c) => !c.sentAt && !c.ack && (!c.queuedAt || now - c.queuedAt >= ttlMs) && !settled(c, now));
}
