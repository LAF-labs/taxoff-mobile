// 라이브 세션에서 폰 발급 명령을 보내고 진행을 받는다(remote-envelope v1.8 cmd.run → cmd.ack · run.event).
// - 보낼 명령은 이미 봉인 상태 파일에 cmdId와 함께 저장돼 있다. 다시 연결할 때마다 같은 cmdId로 다시 보낸다.
// - 끝나지 않은 명령이 있는 동안 세션을 붙잡고 지켜본다(최대 WATCH_MS). 끊기면 다음 연결 때 PC가 지금 상태를 다시 보낸다.
// - PC가 issue.v1을 알리지 않으면 보내지 않고 "PC 앱을 새 버전으로" 상태로 둔다.
import { CAP, issueCmd, type Channel, type CmdAckBody, type PhoneCopyBody, type RunEventBody } from '@sax/remote';
import { applyAck, applyEvent, busyWaiting, forRetry, retryDue, settled, type PhoneCmd } from '../phoneCmd.ts';

export const WATCH_MS = 10 * 60_000;
const TICK_MS = 2_000;

export interface CmdIo {
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
  for (;;) {
    // 지켜보는 동안 새로 맡긴 명령도 이 세션으로 보낸다
    for (const c of io.cmds()) {
      if (retryDue(c, now())) await retry(c);
      else if (!ids.has(c.cmdId) && !settled(c, now()) && !busyWaiting(c, now())) await send(c);
    }
    if (io.cmds().filter((c) => ids.has(c.cmdId)).every((c) => settled(c, now()))) return 'settled';
    if (ch.closed) return 'closed';
    if (io.alive && !io.alive()) return 'closed';
    const left = deadline - now();
    if (left <= 0) return 'timeout';
    const e = await ch.recv(Math.min(left, TICK_MS));
    if (!e) continue;
    if (e.type === 'cmd.ack') {
      const a = e.body as CmdAckBody;
      await io.save((cs) => cs.map((c) => applyAck(c, a, now())));
    } else if (e.type === 'run.event') {
      const ev = e.body as RunEventBody;
      await io.save((cs) => cs.map((c) => applyEvent(c, ev)));
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
