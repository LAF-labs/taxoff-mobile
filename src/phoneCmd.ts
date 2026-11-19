// 폰 발급 명령(remote-envelope v1.8 cmd.run · cmd.ack · run.event, ADR-046 결정 2). 순수 모델(시험용).
// - [발급 맡기기]를 누르면 cmdId(ULID)와 입력을 봉인 상태 파일(AppData.cmds)에 먼저 저장하고, 라이브 세션이 열릴 때 보낸다.
//   다시 연결하면 같은 cmdId로 다시 보낸다. PC는 duplicate로 같은 runId를 돌려주고 지금 상태를 다시 보낸다.
// - 승인(ADR-052, v1.10): 이 폰의 승인 키를 PC가 받았으면 PC는 'accepted'로 답하고 승인 단계에서 gate.request를 보낸다.
//   폰은 승인 시트를 띄우고 하드웨어 키로 서명한 gate.response를 보낸다. 그 밖에는 'pc_only'다(승인은 PC 승인 바에서).
//   PC가 폰으로 보내지 않는 건(처음 거래처·오늘 한도 등)은 run.event.code(pc_*)로 이유가 온다.
// - 거래처는 PC 사본의 ref만 싣는다(사업자번호·이메일 원문 없음). 세액은 floor(공급가액/10), 작성일자는 오늘(한국 시간).
import type { CmdAckBody, CmdAckState, CmdRejectReason, GateRequestBody, GateResolvedBody, GateResolvedBy, GateResponseBody, PhoneIssueRequest, RunEventBody, RunPhase, RunResult } from '@sax/remote';
import type { PhoneGate } from './approval';
import type { Job, NeedPcReason } from './queue';
import type { RunView } from './run';

export interface PhoneCmd {
  cmdId: string;
  req: PhoneIssueRequest;
  /** 화면용: 거래처 이름과 합계 */
  cpName: string;
  total: number;
  createdAt: number;
  /** 처음 보낸 시각(아직 못 보냈으면 없음) */
  sentAt?: number;
  ack?: CmdAckState;
  runId?: string;
  reason?: CmdRejectReason;
  /** PC가 issue.v1을 알리지 않았다(폰 발급 명령을 모르는 PC) */
  pcOld?: boolean;
  phase?: RunPhase;
  /** 마지막 run.event 시각(PC 시계) */
  at?: number;
  code?: string;
  attempt?: number;
  result?: RunResult;
  /** v1.11: 적용한 가장 큰 run.event.rev(sync.v1 PC). 이보다 크지 않은 run.event는 버린다. */
  rev?: number;
  /** v1.11: 승인 요청이 다른 곳에서 닫힌 까닭(gate.resolved). 다음 승인 요청이 오면 지운다. */
  resolvedBy?: GateResolvedBy;
  /** PC가 보낸 승인 요청(gate.request). 승인 단계를 지나면 지운다. */
  gate?: CmdGate;
  /** 사장님의 답(서명 포함). 보내면 sentAt이 붙고 gate를 지운다. 마감 전에 못 보내면 버린다(발급되지 않는다). */
  answer?: CmdAnswer;
  /** [PC에 다시 요청]을 누른 승인 요청의 reqId(아직 gate.refresh를 보내지 않았다) */
  refresh?: string;
  /** PC가 다른 일 중이라 거절(pc_busy)했을 때 다시 보낼 시각. 그 전까지는 기다리는 일로 보인다. */
  retryAt?: number;
  /** 다시 보낸 횟수 */
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
  /** r‖s 64바이트 base64 */
  sig: string;
  exp: number;
  sentAt?: number;
}

/** PC가 다른 일 중일 때 다시 보내는 간격과, 그만두는 때(맡긴 지 72시간, 밀린 일 만료와 같다) */
export const BUSY_RETRY_MS = 30_000;
export const BUSY_GIVE_UP_MS = 72 * 3_600_000;

/** PC가 다른 일 중이라 받지 않았고 아직 다시 보낼 수 있는 명령. 끝난 것이 아니다: 저절로 이어서 한다. */
export function busyWaiting(c: PhoneCmd, now = Date.now()): boolean {
  return !c.pcOld && c.ack === 'rejected' && c.reason === 'pc_busy' && now - c.createdAt < BUSY_GIVE_UP_MS;
}

/**
 * 기다리는 사이 날짜가 바뀌었다(PC는 오늘 작성일자만 받는다). 작성일자는 세금계산서 내용이라 폰이 몰래 바꾸지 않는다:
 * 다시 보내지 않고 사장님 확인([오늘 날짜로 맡기기])을 기다린다.
 */
export const needsRedate = (c: PhoneCmd, now = Date.now()): boolean => busyWaiting(c, now) && c.req.day !== kstDay(now);

/** 다시 보낼 때가 된 명령(날짜가 바뀐 것은 확인 전까지 보내지 않는다) */
export const retryDue = (c: PhoneCmd, now = Date.now()): boolean => busyWaiting(c, now) && !needsRedate(c, now) && (c.retryAt ?? 0) <= now;

/** 다시 보내기 전에 답을 지운다. 같은 cmdId, 같은 입력(PC는 거절한 cmdId를 적어 두지 않는다). */
export function forRetry(c: PhoneCmd): PhoneCmd {
  return { ...c, ack: undefined, reason: undefined, retryAt: undefined, retries: (c.retries ?? 0) + 1 };
}

/** 사장님이 [오늘 날짜로 맡기기]를 눌렀을 때만: 작성일자를 오늘로 바꾸고 바로 다시 보낼 차례로 둔다. */
export function redate(c: PhoneCmd, now = Date.now()): PhoneCmd {
  return { ...c, req: { ...c.req, day: kstDay(now) }, retryAt: now };
}

/** 오늘(한국 시간) YYYY-MM-DD */
export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function issueRequest(p: { ref: string; supply: number; item: string; now?: number }): PhoneIssueRequest {
  return { counterpartyRef: p.ref, supply: p.supply, tax: Math.floor(p.supply / 10), item: p.item.trim(), day: kstDay(p.now) };
}

/** 같은 runId로 다시 붙은 duplicate는 거절이 아니다(앞서 보낸 명령이 이미 돌고 있다). */
export const isReattach = (a: CmdAckBody): boolean => a.state === 'rejected' && a.reason === 'duplicate' && !!a.runId;

export function applyAck(c: PhoneCmd, a: CmdAckBody, now = Date.now()): PhoneCmd {
  if (a.cmdId !== c.cmdId) return c;
  if (isReattach(a)) return { ...c, ack: c.ack && c.ack !== 'rejected' ? c.ack : 'pc_only', runId: a.runId, reason: undefined };
  // 이미 진행 중인 명령에 늦게 온 거절은 덮지 않는다
  if (a.state === 'rejected' && c.phase) return c;
  if (a.state === 'rejected' && a.reason === 'pc_busy') return { ...c, ack: 'rejected', reason: 'pc_busy', runId: a.runId ?? c.runId, retryAt: now + BUSY_RETRY_MS };
  return { ...c, ack: a.state, runId: a.runId ?? c.runId, reason: a.state === 'rejected' ? a.reason : undefined };
}

/**
 * run.event를 붙인다. 같은 runId(또는 cmdId)만, 더 오래된 사건은 버린다.
 * v1.11: 판 번호(rev)가 둘 다 있으면 그것만 본다(PC 시계와 상관없이, 적용한 것보다 크지 않으면 버린다).
 * run.event는 늘 그 실행의 지금 상태 전체라 번호가 비어도 따로 받아 올 것은 없다.
 */
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
  // 승인 단계를 지났거나 PC가 폰 승인을 거뒀으면(pc_*) 받은 승인 요청을 지운다
  if ((e.phase && e.phase !== 'approve') || (e.phase === 'approve' && e.code)) {
    next.gate = undefined;
    next.refresh = undefined;
  }
  if (e.attempt !== undefined) next.attempt = e.attempt;
  if (e.result) next.result = e.result;
  return next;
}

// ---- 폰 승인(gate.request → gate.response) ----

/** PC가 폰으로 보내지 않는 이유(run.event.code) → 밀린 일 이유 */
export const PC_CODE_REASON: Readonly<Record<string, NeedPcReason>> = { pc_first: 'firstCounterparty', pc_limit: 'dailyLimit', pc_key: 'notApprover', pc_only: 'notApprover' };

/** gate.request를 그 실행의 명령에 붙인다. 발급 확정(commit)·P-256 요청만 받는다. 새 요청이 오면 앞 요청과 답을 버린다. */
export function applyGate(c: PhoneCmd, g: GateRequestBody): PhoneCmd {
  if (!c.runId || g.runId !== c.runId) return c;
  if (g.gateKind !== 'commit' || g.requiredSigAlg !== 'p256') return c;
  // 이미 보낸 답의 요청이 다시 오면(재전송) 무시한다
  if (c.answer?.sentAt && c.answer.reqId === g.reqId) return c;
  const gate: CmdGate = { stepId: g.stepId, reqId: g.reqId, fields: g.fields, cardHashInputs: g.cardHashInputs, actionHash: g.actionHash, challenge: g.challenge, exp: g.exp };
  return { ...c, gate, answer: undefined, refresh: undefined, resolvedBy: undefined, phase: 'approve', code: c.code && c.code in PC_CODE_REASON ? undefined : c.code };
}

/**
 * v1.11 gate.resolved: 그 승인 요청이 다른 곳에서 닫혔다(PC 승인 바, 대기 만료, 중지, 이 폰의 답).
 * 받은 요청과 다시 요청을 지워 승인 시트를 바로 닫는다. 진행(발급 중, 멈춤)은 뒤따르는 run.event가 알린다.
 * 보내지 못한 답이 있으면 버린다(PC는 닫힌 요청의 답을 받지 않는다). 이미 보낸 답은 남긴다.
 */
export function applyResolved(c: PhoneCmd, r: GateResolvedBody): PhoneCmd {
  if (!c.runId || r.runId !== c.runId) return c;
  const ours = c.gate?.reqId === r.reqId || c.refresh === r.reqId || c.answer?.reqId === r.reqId;
  if (!ours) return c;
  const answer = c.answer?.reqId === r.reqId && !c.answer.sentAt ? undefined : c.answer;
  return { ...c, gate: c.gate?.reqId === r.reqId ? undefined : c.gate, refresh: c.refresh === r.reqId ? undefined : c.refresh, answer, resolvedBy: r.by };
}

/** 아직 답하지 않은(또는 답을 못 보내고 마감이 지난) 승인 요청 */
export function openGate(c: PhoneCmd, now = Date.now()): CmdGate | null {
  if (!c.gate) return null;
  if (c.answer && c.answer.reqId === c.gate.reqId && (c.answer.sentAt || now <= c.answer.exp)) return null;
  return c.gate;
}

/** 승인 시트의 답을 적는다(보내는 것은 라이브 세션). 열린 요청의 답만 받는다. */
export function answerGate(c: PhoneCmd, a: { reqId: string; decision: 'approve' | 'deny'; actionHash: string; sig: string }, now = Date.now()): PhoneCmd {
  const g = openGate(c, now);
  if (!g || g.reqId !== a.reqId || g.actionHash !== a.actionHash || now > g.exp) return c;
  return { ...c, answer: { reqId: a.reqId, stepId: g.stepId, decision: a.decision, actionHash: a.actionHash, sig: a.sig, exp: g.exp } };
}

/** 지금 보낼 gate.response. 마감이 지난 답은 보내지 않는다(PC도 받지 않는다). */
export function responseDue(c: PhoneCmd, now = Date.now()): GateResponseBody | null {
  const a = c.answer;
  if (!a || a.sentAt || !c.runId || now > a.exp) return null;
  return { runId: c.runId, stepId: a.stepId, reqId: a.reqId, decision: a.decision, actionHash: a.actionHash, sigAlg: 'p256', sig: a.sig };
}

/** 답을 보냈다: 받은 요청을 지운다(결과는 run.event로 온다). */
export function markAnswered(c: PhoneCmd, reqId: string, now = Date.now()): PhoneCmd {
  if (c.answer?.reqId !== reqId) return c;
  return { ...c, answer: { ...c.answer, sentAt: now }, gate: undefined, refresh: undefined };
}

/** [PC에 다시 요청]: 마감이 지난 요청만 */
export function askRefresh(c: PhoneCmd, now = Date.now()): PhoneCmd {
  const g = openGate(c, now);
  return g && now > g.exp ? { ...c, refresh: g.reqId, answer: undefined } : c;
}

/** 사장님이 폰에서 거절했고 그 답을 보낸 명령(밀린 일에서 뺀다. PC는 그 실행을 멈춘다) */
export const deniedByPhone = (c: PhoneCmd): boolean => c.answer?.decision === 'deny' && !!c.answer.sentAt;

/** 더 기다릴 것이 없는 명령(라이브 세션을 붙잡고 있지 않는다) */
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
  counterparty_unknown: 'PC에서 이 거래처를 찾지 못했어요. PC의 거래처 목록을 확인해 주세요.',
  duplicate: '같은 일을 이미 PC에 맡겼어요. 진행은 지금 할 일에서 볼 수 있어요.',
  pc_busy: 'PC가 다른 일을 하고 있어요. 끝나면 다시 맡겨 주세요.',
  hometax_paused: '홈택스가 잠시 접속을 막아서 PC가 발급을 쉬고 있어요. 아무것도 발급하지 않았어요.',
  pc_old: 'PC 앱을 새 버전으로 올리면 폰에서 맡길 수 있어요.',
};

/** 진행 화면 모델. 보내지 못했거나 PC가 아직 답하지 않았으면 null(맡김). */
export function runViewOf(c: PhoneCmd): RunView | null {
  const startedAt = c.sentAt ?? c.createdAt;
  if (c.pcOld) return { kind: 'refused', reason: 'pc_old', startedAt };
  if (c.ack === 'rejected') return { kind: 'refused', reason: c.reason ?? 'input_invalid', startedAt };
  // 보냈지만 아직 답이 없으면 준비 중(맡김으로 두면 폰에서 취소할 수 있어 PC와 어긋난다)
  if (!c.ack) return c.sentAt ? { kind: 'running', step: 'prepare', startedAt, pcApproval: true } : null;
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
          emailSent: !!c.result.emailSent,
          issuedAt: c.at ?? Date.now(),
          doc: { name: `세금계산서_${c.cpName.replace(/\s+/g, '')}_${c.req.day.replace(/-/g, '')}.pdf`, issuedOn: c.req.day, uri: '' },
        },
      };
    case 'stopped':
      // PC는 run.event code로 'in_doubt'만 보낸다. 코드가 없거나 모르는 코드면 이유 없이 멈춤(이유는 PC에서)
      return { kind: 'stopped', step: 'prepare', reason: 'pcStopped', startedAt };
    case 'approve':
      // 승인을 보냈으면 발급 단계로 보인다(결과는 PC가 알려 준다). 폰 승인 요청을 받았으면 PC 승인 바 안내를 뺀다
      if (c.answer?.sentAt && c.answer.decision === 'approve') return { kind: 'running', step: 'issue', startedAt };
      return { kind: 'running', step: 'approve', startedAt, pcApproval: !c.gate && !c.answer };
    default:
      return { kind: 'running', step: c.phase, startedAt, pcApproval: true };
  }
}

/** 밀린 일·대화 카드가 보는 일 한 건 */
export function jobOf(c: PhoneCmd): Job {
  const title = `${c.cpName} 세금계산서`;
  const base = { id: `cmd-${c.cmdId}`, title, amount: c.total, createdAt: c.createdAt, pcOnly: true };
  // PC가 다른 일 중: 기다리는 일로 두고 저절로 다시 보낸다(취소할 수 있다, PC는 아무것도 시작하지 않았다)
  if (needsRedate(c)) return { ...base, state: 'phoneWaiting', wait: 'newDay', waitDay: c.req.day };
  if (busyWaiting(c)) return { ...base, state: 'phoneWaiting', wait: 'pcBusy' };
  const run = runViewOf(c);
  if (!run) return { ...base, state: 'entrusted' };
  // PC가 보낸 승인 요청이 열려 있으면 승인 대기([승인 열기] → 승인 시트)
  const gate = c.phase === 'approve' ? openGate(c) : null;
  if (gate && run.kind === 'running') return { ...base, state: 'approval', run, gate };
  // PC가 폰으로 보내지 않은 이유(처음 거래처·오늘 한도·승인 기기 아님). 승인은 PC 승인 바에서 한다
  const reason = c.phase === 'approve' && c.code ? PC_CODE_REASON[c.code] : undefined;
  if (reason && run.kind === 'running') return { ...base, state: 'running', run, reason };
  const state: Job['state'] = run.kind === 'done' ? 'done' : run.kind === 'verify' ? 'verify' : run.kind === 'refused' || run.kind === 'stopped' ? 'needPc' : 'running';
  return { ...base, state, run };
}
