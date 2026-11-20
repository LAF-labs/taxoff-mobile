// 라이브 세션에서 폰 발급 명령을 보내고 진행을 받는다(remote-envelope v1.8 cmd.run → cmd.ack · run.event).
// - 보낼 명령은 이미 봉인 상태 파일에 cmdId와 함께 저장돼 있다. 다시 연결할 때마다 같은 cmdId로 다시 보낸다.
// - 끝나지 않은 명령이 있는 동안 세션을 붙잡고 지켜본다(최대 WATCH_MS). 끊기면 다음 연결 때 PC가 지금 상태를 다시 보낸다.
// - PC가 issue.v1을 알리지 않으면 보내지 않고 "PC 앱을 새 버전으로" 상태로 둔다.
// - 폰 승인(v1.10, ADR-052): PC가 approve.v1을 알렸으면 gate.request를 받아 명령에 붙이고(승인 시트가 뜬다),
//   사장님이 서명한 답(gate.response)과 [PC에 다시 요청](gate.refresh)을 이 세션으로 보낸다.
// - v1.11(sync.v1): PC가 승인 요청을 다른 곳에서 닫으면 gate.resolved가 온다. 받은 요청을 지워 시트를 바로 닫는다.
import { CAP, issueCmd, type Channel, type CmdAckBody, type GateRequestBody, type GateResolvedBody, type PhoneCopyBody, type RunEventBody } from '@sax/remote';
import { applyAck, applyEvent, applyGate, applyHumanRequest, applyResolved, busyWaiting, forRetry, markAnswered, responseDue, retryDue, settled, type PhoneCmd } from '../phoneCmd.ts';

const WATCH_MS = 10 * 60_000;
const TICK_MS = 2_000;
/** 승인 요청이 열려 있는 동안: 사장님의 답을 바로 보내려고 더 자주 본다 */
const GATE_TICK_MS = 300;

interface CmdIo {
  cmds: () => PhoneCmd[];
  save: (f: (cs: PhoneCmd[]) => PhoneCmd[]) => Promise<void>;
  /** 세션 중에 다시 온 사본 */
  onCopy?: (c: PhoneCopyBody) => Promise<void>;
  /** 잠그면 거짓(키가 지워지기 전에 멈춘다) */
  alive?: () => boolean;
  now?: () => number;
}

type Ch = Pick<Channel, 'send' | 'recv' | 'closed'>;

export async function driveCmds(ch: Ch, peerCaps: readonly string[], io: CmdIo, watchMs = WATCH_MS): Promise<'none' | 'pc_old' | 'settled' | 'closed' | 'timeout'> {
  const now = io.now ?? Date.now;
  const open = io.cmds().filter((c) => !settled(c, now()));
  if (!open.length) return 'none';
  const ids = new Set<string>();
  if (!peerCaps.includes(CAP.issue)) {
    const old = new Set(open.map((c) => c.cmdId));
    await io.save((cs) => cs.map((c) => (old.has(c.cmdId) ? { ...c, pcOld: true } : c)));
    return 'pc_old';
  }
  const t0 = now();
  const send = async (c: PhoneCmd) => {
    ids.add(c.cmdId);
    try {
      ch.send('cmd.run', issueCmd(c.cmdId, c.req));
    } catch {
      // 입력이 규칙에 맞지 않으면 보내지 않는다(PC도 input_invalid로 거절한다)
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, ack: 'rejected', reason: 'input_invalid' } : x)));
      return;
    }
    if (!c.sentAt) await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, sentAt: now() } : x)));
  };
  // PC가 다른 일 중이라 기다리는 명령은 다시 보낼 때가 된 것만 보낸다
  const retry = async (c: PhoneCmd) => {
    await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? forRetry(x) : x)));
    const fresh = io.cmds().find((x) => x.cmdId === c.cmdId);
    if (fresh) await send(fresh);
  };
  for (const c of open) {
    if (busyWaiting(c, now())) {
      if (retryDue(c, now())) await retry(c);
      else ids.add(c.cmdId);
    } else await send(c);
  }
  const deadline = t0 + watchMs;
  const approves = peerCaps.includes(CAP.approve);
  /** 사장님이 적어 둔 답과 다시 요청을 보낸다. 승인 봉투는 PC가 approve.v1을 알렸을 때만. */
  const flushApprovals = async () => {
    if (!approves) return;
    for (const c of io.cmds()) {
      const r = responseDue(c, now());
      // 보내다 던지면: 채널이 닫혔으면 그대로 두고(다음 연결에 마감 전이면 다시 보낸다), 봉투가 규칙에 안 맞으면 그 답을 버린다
      if (r) {
        try {
          ch.send('gate.response', r);
        } catch {
          if (ch.closed) return;
          await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, answer: undefined } : x)));
          continue;
        }
        await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? markAnswered(x, r.reqId, now()) : x)));
      } else if (c.refresh && c.runId) {
        try {
          ch.send('gate.refresh', { runId: c.runId, reqId: c.refresh });
        } catch {
          if (ch.closed) return;
        }
        await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, refresh: undefined } : x)));
      }
    }
  };
  for (;;) {
    await flushApprovals();
    // 지켜보는 동안 새로 맡긴 명령도 이 세션으로 보낸다
    for (const c of io.cmds()) {
      if (retryDue(c, now())) await retry(c);
      else if (!ids.has(c.cmdId) && !settled(c, now()) && !busyWaiting(c, now())) await send(c);
    }
    // [인증서로 다시 시도]: 누른 명령의 cmd.resume을 한 번 보낸다(같은 runId)
    for (const c of io.cmds()) {
      if (c.resumeAt === undefined || c.resumeSentAt !== undefined || !c.runId) continue;
      ids.add(c.cmdId);
      try {
        // cmd.resume 본문은 스키마 __body6({runId})에 있지만 사본의 Bodies 표에는 아직 없다: 봉투 검사는 스키마가 한다
        (ch.send as unknown as (t: string, b: object) => unknown)('cmd.resume', { runId: c.runId });
      } catch {
        continue;
      }
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, resumeSentAt: now() } : x)));
    }
    // 간편인증 답(요청 값 또는 승인했어요): PC가 연 reqId로 한 번 보낸다
    for (const c of io.cmds()) {
      if (c.simpleOut === undefined || c.simpleOutSentAt !== undefined || !c.simpleReq || !c.runId) continue;
      ids.add(c.cmdId);
      try {
        (ch.send as unknown as (t: string, b: object) => unknown)('human.response', { runId: c.runId, stepId: 's7e', reqId: c.simpleReq, value: c.simpleOut });
      } catch {
        continue;
      }
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, simpleOutSentAt: now() } : x)));
    }
    if (io.cmds().filter((c) => ids.has(c.cmdId)).every((c) => settled(c, now()))) return 'settled';
    if (ch.closed) return 'closed';
    if (io.alive && !io.alive()) return 'closed';
    const left = deadline - now();
    if (left <= 0) return 'timeout';
    const waiting = approves && io.cmds().some((c) => !!c.gate || (!!c.answer && !c.answer.sentAt) || !!c.refresh);
    const e = await ch.recv(Math.min(left, waiting ? GATE_TICK_MS : TICK_MS));
    if (!e) continue;
    if (e.type === 'cmd.ack') {
      const a = e.body as CmdAckBody;
      await io.save((cs) => cs.map((c) => applyAck(c, a, now())));
    } else if (e.type === 'human.request') {
      const b = e.body as { runId?: unknown; reqId?: unknown; kind?: unknown; prompt?: unknown };
      await io.save((cs) => cs.map((c) => applyHumanRequest(c, b)));
    } else if (e.type === 'run.event') {
      const ev = e.body as RunEventBody;
      await io.save((cs) => cs.map((c) => applyEvent(c, ev)));
    } else if (e.type === 'gate.request' && approves) {
      const g = e.body as GateRequestBody;
      await io.save((cs) => cs.map((c) => applyGate(c, g)));
    } else if (e.type === 'gate.resolved' && approves) {
      // v1.11: 다른 곳에서 닫힌 승인 요청(시트를 바로 닫는다)
      const r = e.body as GateResolvedBody;
      await io.save((cs) => cs.map((c) => applyResolved(c, r)));
    } else if (e.type === 'phone.copy' && io.onCopy) {
      await io.onCopy(e.body as PhoneCopyBody);
    }
  }
}

/** 보관 개수: 끝난 명령은 최근 20개만 남긴다(끝나지 않은 명령은 지우지 않는다). */
export function trimCmds(cs: PhoneCmd[], keep = 20): PhoneCmd[] {
  const done = cs.filter(settled).sort((a, b) => b.createdAt - a.createdAt).slice(0, keep);
  const keepIds = new Set(done.map((c) => c.cmdId));
  return cs.filter((c) => !settled(c) || keepIds.has(c.cmdId));
}
