import { CAP, type Channel, type CmdAckBody, type Envelope, type GateRequestBody, type GateResolvedBody, type PhoneCopyBody, type RunEventBody } from '@sax/remote';
import { applyAck, cmdBody, applyEvent, applyGate, applyHumanRequest, applyResolved, busyWaiting, forRetry, markAnswered, offlineNeedsRedate, responseDue, retryDue, settled, type PhoneCmd } from '../phoneCmd.ts';
import { applyBookAck, bookOpen, bookReady, bookRun, linkBook, type BookCmd } from '../book.ts';

const WATCH_MS = 10 * 60_000;
const TICK_MS = 2_000;
const GATE_TICK_MS = 300;
/** 거래처를 저장한 PC는 같은 연결로 새 사본을 보낸다. 그 사본을 받을 때까지만 더 기다린다. */
const COPY_AFTER_SAVE_MS = 3_000;

interface CmdIo {
  cmds: () => PhoneCmd[];
  save: (f: (cs: PhoneCmd[]) => PhoneCmd[]) => Promise<void>;
  onCopy?: (c: PhoneCopyBody) => Promise<void>;
  /** 폰에서 넣고 고친 거래처(ADR-066). 발급보다 먼저 보낸다. */
  book?: { list: () => BookCmd[]; save: (f: (bs: BookCmd[]) => BookCmd[]) => Promise<void> };
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
  const book = io.book;
  const books = () => book?.list() ?? [];
  const canDrive = (c: PhoneCmd, at: number) => !settled(c, at) && !offlineNeedsRedate(c, at);
  const open = io.cmds().filter((c) => canDrive(c, now()));
  if (!open.length && !books().some(bookReady)) return 'none';
  const ids = new Set<string>();
  const bookIds = new Set<string>();
  const t0 = now();
  let copyBy = 0;
  /** 보낼 수 있는 거래처 명령을 보낸다. 넣기 답을 받은 뒤 이어 고친 명령도 여기서 나간다. */
  const sendBooks = async () => {
    if (!book) return;
    for (const b of books().filter((x) => bookReady(x) && !bookIds.has(x.cmdId))) {
      bookIds.add(b.cmdId);
      try {
        ch.send('cmd.run', bookRun(b));
      } catch {
        await book.save((bs) => bs.map((x) => (x.cmdId === b.cmdId ? { ...x, failed: 'input_invalid' as const } : x)));
        continue;
      }
      if (!b.sentAt) await book.save((bs) => bs.map((x) => (x.cmdId === b.cmdId ? { ...x, sentAt: now() } : x)));
    }
  };
  if (book && books().some(bookReady)) {
    if (!peerCaps.includes(CAP.book)) {
      await book.save((bs) => bs.map((b) => (bookOpen(b) ? { ...b, failed: 'pc_old' as const } : b)));
    } else await sendBooks();
  }
  if (!peerCaps.includes(CAP.issue) || (!peerCaps.includes(CAP.book) && open.some((c) => !!c.req.newCounterparty))) {
    // 옛 PC: 발급을 못 받거나, 등록번호로 가리킨 새 거래처를 모른다.
    const old = new Set(open.filter((c) => !peerCaps.includes(CAP.issue) || !!c.req.newCounterparty).map((c) => c.cmdId));
    await io.save((cs) => cs.map((c) => (old.has(c.cmdId) ? { ...c, pcOld: true } : c)));
    if (!peerCaps.includes(CAP.issue) && !bookIds.size) return 'pc_old';
  }
  const send = async (c: PhoneCmd) => {
    requireLink();
    ids.add(c.cmdId);
    let body: ReturnType<typeof cmdBody>;
    try {
      body = cmdBody(c);
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
  for (const c of io.cmds().filter((x) => !settled(x, now()))) {
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
    const booksDone = books().every((b) => !bookOpen(b) || (!bookIds.has(b.cmdId) && !(b.after && bookIds.has(b.after)))) && (!copyBy || now() >= copyBy);
    if (booksDone && !io.cmds().some((c) => ids.has(c.cmdId) && canDrive(c, now()))) return 'settled';
    if (ch.closed) return 'closed';
    if (io.alive && !io.alive()) return 'closed';
    const left = deadline - now();
    if (left <= 0) return 'timeout';
    const waiting = approves && io.cmds().some((c) => !!c.gate || (!!c.answer && !c.answer.sentAt) || !!c.refresh);
    const e = await ch.recv(Math.min(left, waiting ? GATE_TICK_MS : TICK_MS));
    if (!e) continue;
    if (e.type === 'cmd.ack' && book && bookIds.has((e.body as CmdAckBody).cmdId)) {
      const a = e.body as CmdAckBody;
      await book.save((bs) => linkBook(bs.map((x) => applyBookAck(x, a, now())), null));
      if (a.state === 'saved') {
        copyBy = now() + COPY_AFTER_SAVE_MS;
        await sendBooks();
      }
      continue;
    }
    await applyIncoming(e, approves, io);
    if (e.type === 'phone.copy') copyBy = 0;
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
