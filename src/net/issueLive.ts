import { CAP, issueCmd, type Channel, type CmdAckBody, type Envelope, type GateRequestBody, type GateResolvedBody, type PhoneCopyBody, type RunEventBody } from '@sax/remote';
import { applyAck, applyEvent, applyGate, applyHumanRequest, applyResolved, busyWaiting, forRetry, markAnswered, offlineNeedsRedate, responseDue, retryDue, settled, type PhoneCmd } from '../phoneCmd.ts';

const WATCH_MS = 10 * 60_000;
const TICK_MS = 2_000;
const GATE_TICK_MS = 300;

interface CmdIo {
  cmds: () => PhoneCmd[];
  save: (f: (cs: PhoneCmd[]) => PhoneCmd[]) => Promise<void>;
  onCopy?: (c: PhoneCopyBody) => Promise<void>;
  alive?: () => boolean;
  now?: () => number;
}

type Ch = Pick<Channel, 'send' | 'recv' | 'closed'>;

export async function driveCmds(ch: Ch, peerCaps: readonly string[], io: CmdIo, watchMs = WATCH_MS): Promise<'none' | 'pc_old' | 'settled' | 'closed' | 'timeout'> {
  const requireLink = () => {
    if (ch.closed) throw new Error('relay: closed');
  };
  requireLink();
  const now = io.now ?? Date.now;
  const canDrive = (c: PhoneCmd, at: number) => !settled(c, at) && !offlineNeedsRedate(c, at);
  const open = io.cmds().filter((c) => canDrive(c, now()));
  if (!open.length) return 'none';
  const ids = new Set<string>();
  if (!peerCaps.includes(CAP.issue)) {
    const old = new Set(open.map((c) => c.cmdId));
    await io.save((cs) => cs.map((c) => (old.has(c.cmdId) ? { ...c, pcOld: true } : c)));
    return 'pc_old';
  }
  const t0 = now();
  const send = async (c: PhoneCmd) => {
    requireLink();
    ids.add(c.cmdId);
    let body: ReturnType<typeof issueCmd>;
    try {
      body = issueCmd(c.cmdId, c.req);
    } catch {
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, ack: 'rejected', reason: 'input_invalid' } : x)));
      return;
    }
    ch.send('cmd.run', body);
    if (!c.sentAt) await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, sentAt: now() } : x)));
  };
  const retry = async (c: PhoneCmd) => {
    requireLink();
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
  const flushApprovals = async () => {
    if (!approves) return;
    for (const c of io.cmds()) {
      requireLink();
      const r = responseDue(c, now());
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
    for (const c of io.cmds()) {
      const at = now();
      if (!canDrive(c, at)) continue;
      if (retryDue(c, at)) await retry(c);
      else if ((!ids.has(c.cmdId) || c.sentAt === undefined) && !busyWaiting(c, at)) await send(c);
    }
    for (const c of io.cmds()) {
      if (c.resumeAt === undefined || c.resumeSentAt !== undefined || !c.runId) continue;
      requireLink();
      ids.add(c.cmdId);
      try {
        (ch.send as unknown as (t: string, b: object) => unknown)('cmd.resume', { runId: c.runId });
      } catch {
        continue;
      }
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, resumeSentAt: now() } : x)));
    }
    for (const c of io.cmds()) {
      if (c.simpleOut === undefined || c.simpleOutSentAt !== undefined || !c.simpleReq || !c.runId) continue;
      requireLink();
      ids.add(c.cmdId);
      try {
        (ch.send as unknown as (t: string, b: object) => unknown)('human.response', { runId: c.runId, stepId: 's7e', reqId: c.simpleReq, value: c.simpleOut });
      } catch {
        continue;
      }
      await io.save((cs) => cs.map((x) => (x.cmdId === c.cmdId ? { ...x, simpleOutSentAt: now() } : x)));
    }
    if (!io.cmds().some((c) => ids.has(c.cmdId) && canDrive(c, now()))) return 'settled';
    if (ch.closed) return 'closed';
    if (io.alive && !io.alive()) return 'closed';
    const left = deadline - now();
    if (left <= 0) return 'timeout';
    const waiting = approves && io.cmds().some((c) => !!c.gate || (!!c.answer && !c.answer.sentAt) || !!c.refresh);
    const e = await ch.recv(Math.min(left, waiting ? GATE_TICK_MS : TICK_MS));
    if (e) await applyIncoming(e, approves, io);
  }
}

export async function applyIncoming(e: Envelope, approves: boolean, io: Pick<CmdIo, 'save' | 'onCopy' | 'now'>): Promise<void> {
  const now = io.now ?? Date.now;
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
    const r = e.body as GateResolvedBody;
    await io.save((cs) => cs.map((c) => applyResolved(c, r)));
  } else if (e.type === 'phone.copy' && io.onCopy) {
    await io.onCopy(e.body as PhoneCopyBody);
  }
}

export function trimCmds(cs: PhoneCmd[], keep = 20): PhoneCmd[] {
  const now = Date.now();
  const done = cs.filter((c) => settled(c, now)).sort((a, b) => b.createdAt - a.createdAt).slice(0, keep);
  const keepIds = new Set(done.map((c) => c.cmdId));
  return cs.filter((c) => !settled(c, now) || keepIds.has(c.cmdId));
}
