// 폰 발급 명령(remote-envelope v1.8 cmd.run · cmd.ack · run.event, ADR-046 결정 2). 순수 모델(시험용).
// - [발급 맡기기]를 누르면 cmdId(ULID)와 입력을 봉인 상태 파일(AppData.cmds)에 먼저 저장하고, 라이브 세션이 열릴 때 보낸다.
//   다시 연결하면 같은 cmdId로 다시 보낸다. PC는 duplicate로 같은 runId를 돌려주고 지금 상태를 다시 보낸다.
// - 지금 PC는 모두 'pc_only'로 답한다: 승인은 PC 승인 바에서 한다(폰 승인 시트 없음).
// - 거래처는 PC 사본의 ref만 싣는다(사업자번호·이메일 원문 없음). 세액은 floor(공급가액/10), 작성일자는 오늘(한국 시간).
import type { CmdAckBody, CmdAckState, CmdRejectReason, PhoneIssueRequest, RunEventBody, RunPhase, RunResult } from '@sax/remote';
import type { Job } from './queue';
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

export function applyAck(c: PhoneCmd, a: CmdAckBody): PhoneCmd {
  if (a.cmdId !== c.cmdId) return c;
  if (isReattach(a)) return { ...c, ack: c.ack && c.ack !== 'rejected' ? c.ack : 'pc_only', runId: a.runId, reason: undefined };
  // 이미 진행 중인 명령에 늦게 온 거절은 덮지 않는다
  if (a.state === 'rejected' && c.phase) return c;
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
  if (e.attempt !== undefined) next.attempt = e.attempt;
  if (e.result) next.result = e.result;
  return next;
}

/** 더 기다릴 것이 없는 명령(라이브 세션을 붙잡고 있지 않는다) */
export function settled(c: PhoneCmd): boolean {
  if (c.pcOld) return true;
  if (c.ack === 'rejected') return true;
  if (c.phase === 'done') return !!c.result || c.code !== 'in_doubt';
  if (c.phase === 'stopped') return c.code !== 'in_doubt';
  return false;
}

export const REJECT_LINE: Record<CmdRejectReason | 'pc_old', string> = {
  playbook_unavailable: 'PC에 발급 절차가 아직 준비되지 않았어요. 아무것도 발급하지 않았어요.',
  input_invalid: 'PC가 입력값을 받지 않았어요. 금액과 품목을 다시 확인해 주세요.',
  counterparty_unknown: 'PC에서 이 거래처를 찾지 못했어요. PC의 거래처 목록을 확인해 주세요.',
  duplicate: '같은 요청이 이미 PC에 있어요.',
  pc_busy: 'PC가 다른 일을 하고 있어요. 끝나면 다시 맡겨 주세요.',
  hometax_paused: '홈택스 차단 신호로 PC가 발급을 쉬고 있어요. 아무것도 발급하지 않았어요.',
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
    default:
      return { kind: 'running', step: c.phase, startedAt, pcApproval: true };
  }
}

/** 밀린 일·대화 카드가 보는 일 한 건 */
export function jobOf(c: PhoneCmd): Job {
  const run = runViewOf(c);
  const title = `${c.cpName} 세금계산서`;
  const base = { id: `cmd-${c.cmdId}`, title, amount: c.total, createdAt: c.createdAt, pcOnly: true };
  if (!run) return { ...base, state: 'entrusted' };
  const state: Job['state'] = run.kind === 'done' ? 'done' : run.kind === 'verify' ? 'verify' : run.kind === 'refused' || run.kind === 'stopped' ? 'needPc' : 'running';
  return { ...base, state, run };
}
