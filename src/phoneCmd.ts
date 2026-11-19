// 폰 발급 명령(remote-envelope v1.8 cmd.run · cmd.ack · run.event, ADR-046 결정 2). 순수 모델(시험용).
// - [발급 맡기기]를 누르면 cmdId(ULID)와 입력을 봉인 상태 파일(AppData.cmds)에 먼저 저장하고, 라이브 세션이 열릴 때 보낸다.
//   다시 연결하면 같은 cmdId로 다시 보낸다. PC는 duplicate로 같은 runId를 돌려주고 지금 상태를 다시 보낸다.
// - 지금 PC는 모두 'pc_only'로 답한다: 승인은 PC 승인 바에서 한다(폰 승인 시트 없음).
// - 거래처는 PC 사본의 ref만 싣는다(사업자번호·이메일 원문 없음). 세액은 floor(공급가액/10), 작성일자는 오늘(한국 시간).
import type { CmdAckBody, CmdAckState, CmdRejectReason, PhoneIssueRequest, RunEventBody, RunPhase, RunResult } from '@sax/remote';
import type { Job } from './queue';
import { PASS_CARRIERS, STEPS, simpleAppOf, type RunView, type Step } from './run.ts';

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
  /** PC가 사람 차례로 기다린다(run.event 'turn'). code가 그 까닭. 다음 사건이 오면 풀린다. */
  turn?: boolean;
  /** 사장님이 [인증서로 다시 시도]를 눌렀다(보낼 cmd.resume, 누른 시각). 보내면 resumeSentAt. 다음 사건이 오면 둘 다 지운다. */
  resumeAt?: number;
  resumeSentAt?: number;
  /** PC가 연 간편인증 요청 자리(human.request manual simple_auth의 reqId) */
  simpleReq?: string;
  /** 보낼 간편인증 답(human.response value)과 보낸 시각. 다음 사건이 오면 지운다. */
  simpleOut?: string;
  simpleOutSentAt?: number;
  /** 요청한 인증 앱 코드(승인 대기 화면 글자) */
  simpleApp?: string;
  /** 바로 앞 간편인증 요청이 안 됐다(PC login.simple_failed) */
  simpleFailed?: boolean;
  /** PC가 알려 준 승인 마감(run.event deadline) */
  deadline?: number;
  attempt?: number;
  result?: RunResult;
  /** PC가 다른 일 중이라 거절(pc_busy)했을 때 다시 보낼 시각. 그 전까지는 기다리는 일로 보인다. */
  retryAt?: number;
  /** 다시 보낸 횟수 */
  retries?: number;
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

/** run.event를 붙인다. 같은 runId(또는 cmdId)만, 더 오래된 사건은 버린다. */
export function applyEvent(c: PhoneCmd, e: RunEventBody): PhoneCmd {
  const mine = (c.runId && e.runId === c.runId) || (e.cmdId && e.cmdId === c.cmdId);
  if (!mine) return c;
  if (c.at !== undefined && e.at < c.at) return c;
  const next: PhoneCmd = { ...c, runId: c.runId ?? e.runId, at: e.at };
  if (!next.ack || next.ack === 'rejected') next.ack = 'pc_only';
  if (e.phase) next.phase = e.phase;
  next.code = e.code;
  next.turn = e.event === 'turn' ? true : undefined;
  next.deadline = e.deadline;
  // 간편인증: 보낸 답이 있었으면 이 사건이 그 결과다. 실패면 고르기로 돌아가고 그 사실을 보인다
  if (next.simpleOutSentAt !== undefined) {
    next.simpleOut = undefined;
    next.simpleOutSentAt = undefined;
  }
  next.simpleFailed = e.code === 'login.simple_failed' ? true : e.code?.startsWith('login.simple_sent') ? false : next.simpleFailed;
  if (e.code === 'login.simple_failed') next.code = 'login.simple_auth';
  const sent = /^login\.simple_sent\.([a-z]{2,10})$/.exec(e.code ?? '');
  if (sent) next.simpleApp = sent[1];
  // 차례를 떠나면 요청 자리도 닫힌다
  if (!next.turn) next.simpleReq = undefined;
  // 다시 시도를 보낸 뒤 온 사건(새 실행의 진행이든 그대로 차례든)이면 누름을 끝낸다
  if (next.resumeSentAt !== undefined) {
    next.resumeAt = undefined;
    next.resumeSentAt = undefined;
  }
  if (e.attempt !== undefined) next.attempt = e.attempt;
  if (e.result) next.result = e.result;
  return next;
}

/** 더 기다릴 것이 없는 명령(라이브 세션을 붙잡고 있지 않는다) */
export function settled(c: PhoneCmd, now = Date.now()): boolean {
  if (c.pcOld) return true;
  if (busyWaiting(c, now)) return false;
  if (c.ack === 'rejected') return true;
  if (c.phase === 'done') return !!c.result || c.code !== 'in_doubt';
  if (c.phase === 'stopped') return c.code !== 'in_doubt';
  return false;
}

export const REJECT_LINE: Record<CmdRejectReason | 'pc_old', string> = {
  playbook_unavailable: 'PC에 발급 절차가 아직 준비되지 않았어요. 아무것도 발급하지 않았어요.',
  input_invalid: 'PC가 이 내용을 받지 않았어요. 금액과 품목을 다시 확인해 주세요.',
  counterparty_unknown: '이 거래처를 찾지 못했어요. 아무것도 발급하지 않았어요. 거래처를 다시 골라 주세요.',
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
  // [인증서로 다시 시도]·간편인증 답을 보냈고 PC 답을 기다린다: 로그인 중으로 보인다
  if (c.turn && (c.resumeAt !== undefined || c.simpleOut !== undefined)) return { kind: 'running', step: 'login', startedAt, pcApproval: true };
  // PC가 간편인증 요청을 보냈다: 인증 앱 승인 대기(남은 시간)
  if (c.turn && c.code?.startsWith('login.simple_sent')) {
    const a = simpleAppOf(c.simpleApp ?? '');
    return { kind: 'myTurn', step: 'login', auth: { method: 'simple', app: a?.app ?? '인증 앱', pc: true, ...(c.deadline ? { deadline: c.deadline } : {}) }, startedAt };
  }
  // PC가 사람 차례로 기다린다(예: 공동인증서 로그인이 안 돼 간편인증 화면을 열어 둠). "진행 중"으로 두지 않는다.
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
          emailSent: !!c.result.emailSent,
          issuedAt: c.at ?? Date.now(),
          doc: { name: `세금계산서_${c.cpName.replace(/\s+/g, '')}_${c.req.day.replace(/-/g, '')}.pdf`, issuedOn: c.req.day, uri: '' },
        },
      };
    case 'stopped':
      // PC는 run.event code로 'in_doubt'만 보낸다. 코드가 없거나 모르는 코드면 이유 없이 멈춤(이유는 PC에서)
      return { kind: 'stopped', step: 'prepare', reason: 'pcStopped', startedAt };
    default:
      return { kind: 'running', step: c.phase, startedAt, pcApproval: true };
  }
}

/** 폰 [인증서로 다시 시도]를 받을 수 있는 차례(PC가 공동인증서 로그인 실패로 기다린다) */
export const canRetryCert = (c: PhoneCmd): boolean => !!c.turn && c.code === 'login.simple_auth' && !!c.runId && c.resumeAt === undefined;

/** [인증서로 다시 시도]를 누름: 다음 라이브 세션에서 cmd.resume을 보낸다 */
export function askRetryCert(c: PhoneCmd, now = Date.now()): PhoneCmd {
  return canRetryCert(c) ? { ...c, resumeAt: now, resumeSentAt: undefined } : c;
}

/** PC가 연 간편인증 요청 자리를 붙인다(human.request manual simple_auth). 같은 runId만. */
export function applyHumanRequest(c: PhoneCmd, b: { runId?: unknown; reqId?: unknown; kind?: unknown; prompt?: unknown }): PhoneCmd {
  if (!c.runId || b.runId !== c.runId || b.kind !== 'manual' || b.prompt !== 'simple_auth' || typeof b.reqId !== 'string') return c;
  return { ...c, simpleReq: b.reqId };
}

/** 간편인증 요청 값(human.response value, 64자 안). 이름에 ':'는 넣지 않는다. */
export function simpleRequestValue(id: { provider: string; name: string; birth: string; phone: string; carrier?: string }): string | null {
  const name = id.name.trim().replace(/:/g, '');
  const pass = id.provider === 'pass';
  if (pass ? !PASS_CARRIERS.some((c) => c.code === id.carrier) : id.carrier !== undefined) return null;
  const v = `sa1:req:${id.provider}${pass ? `-${id.carrier}` : ''}:${id.birth}:${id.phone}:${name}`;
  return simpleAppOf(id.provider) && /^\d{8}$/.test(id.birth) && /^01\d{8,9}$/.test(id.phone) && name && v.length <= 64 ? v : null;
}

/** 간편인증 요청을 보낼 차례로 둔다(request) 또는 [승인했어요](done) */
export function askSimple(c: PhoneCmd, value: string, app?: string): PhoneCmd {
  if (!c.turn || !c.simpleReq) return c;
  return { ...c, simpleOut: value, simpleOutSentAt: undefined, ...(app ? { simpleApp: app } : {}) };
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
  const state: Job['state'] = run.kind === 'done' ? 'done' : run.kind === 'verify' ? 'verify' : run.kind === 'refused' || run.kind === 'stopped' ? 'needPc' : 'running';
  return { ...base, state, run };
}
