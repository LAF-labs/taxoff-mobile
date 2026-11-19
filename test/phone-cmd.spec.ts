// 폰 발급 명령(remote-envelope v1.8 cmd.run · cmd.ack · run.event): 모델과 라이브 세션 구동. 채널은 가짜(mock).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import type { Envelope } from '../vendor/sax-remote/src/index.ts';
import type { PhoneCmd } from '../src/phoneCmd.ts';

const VENDOR: Record<string, string> = {
  '@sax/remote': '../vendor/sax-remote/src/index.ts',
  '@sax/redaction': '../vendor/sax-redaction/src/index.ts',
  '@sax/chat-core': '../vendor/sax-chat-core/src/index.ts',
};
registerHooks({
  resolve(spec, ctx, next) {
    const to = VENDOR[spec];
    return to ? next(new URL(to, import.meta.url).href, ctx) : next(spec, ctx);
  },
});
const { CAP, checkIssueRequest } = await import('@sax/remote');
const { driveCmds, trimCmds } = await import('../src/net/issueLive.ts');
const { PHONE_CAPS } = await import('../src/net/pcCopy.ts');
const { PC_TURN, STOP_COPY, actionsOf, pcTurnOf } = await import('../src/run.ts');
const { actionFor } = await import('../src/queue.ts');
const { BUSY_GIVE_UP_MS, BUSY_RETRY_MS, REJECT_LINE, applyAck, applyEvent, askRetryCert, canRetryCert, busyWaiting, issueRequest, jobOf, kstDay, needsRedate, redate, retryDue, runViewOf, settled } = await import('../src/phoneCmd.ts');

const T0 = Date.parse('2026-11-17T01:00:00Z');
const cmd = (o: Partial<PhoneCmd> = {}): PhoneCmd => ({
  cmdId: '01JDCMD0000000000000000001',
  req: issueRequest({ ref: 'cp_gana', supply: 1_230_005, item: ' 식자재 ', now: T0 }),
  cpName: '가나식자재',
  total: 1_353_005,
  createdAt: T0,
  ...o,
});

describe('발급 명령 입력', () => {
  it('세액은 공급가액 10% 버림, 작성일자는 오늘(한국 시간), 품목은 다듬는다', () => {
    const r = cmd().req;
    assert.deepEqual(r, { counterpartyRef: 'cp_gana', supply: 1_230_005, tax: 123_000, item: '식자재', day: '2026-11-17' });
    assert.equal(checkIssueRequest(r), null);
    // UTC 15시 = 한국 다음 날 0시
    assert.equal(kstDay(Date.parse('2026-11-17T15:00:00Z')), '2026-11-18');
  });
  it('hello에 copy.v1과 issue.v1을 알린다', () => {
    assert.deepEqual([...PHONE_CAPS].sort(), [CAP.copy, CAP.issue].sort());
  });
});

describe('cmd.ack · run.event → 진행 화면', () => {
  it('보내기 전은 맡김, 보냈고 답이 없으면 준비 중(취소 불가)', () => {
    assert.equal(jobOf(cmd()).state, 'entrusted');
    const sent = jobOf(cmd({ sentAt: T0 }));
    assert.equal(sent.state, 'running');
    assert.equal(sent.pcOnly, true);
  });
  it('pc_only → 단계 따라가기, 승인 단계는 PC 승인 바 안내', () => {
    let c = applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' });
    assert.deepEqual(runViewOf(c), { kind: 'running', step: 'prepare', startedAt: T0, pcApproval: true });
    for (const phase of ['login', 'readback', 'approve'] as const) {
      c = applyEvent(c, { runId: 'run1', event: 'phase', at: T0 + 1000 * (['login', 'readback', 'approve'].indexOf(phase) + 1), phase });
    }
    assert.deepEqual(runViewOf(c), { kind: 'running', step: 'approve', startedAt: T0, pcApproval: true });
    c = applyEvent(c, { runId: 'run1', event: 'phase', at: T0 + 9000, phase: 'done', result: { approvalNo: '20261117-41000000-00000001', total: 1_353_005, emailSent: true } });
    const v = runViewOf(c);
    assert.equal(v?.kind, 'done');
    assert.equal(v?.kind === 'done' && v.result.approvalNo, '20261117-41000000-00000001');
    assert.equal(v?.kind === 'done' && v.result.emailSent, true);
    assert.equal(settled(c), true);
    assert.equal(jobOf(c).state, 'done');
  });
  it('다른 run의 사건과 더 오래된 사건은 버린다', () => {
    const c = applyEvent(applyAck(cmd(), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }), { runId: 'run1', event: 'phase', at: T0 + 5000, phase: 'issue' });
    assert.equal(applyEvent(c, { runId: 'other', event: 'phase', at: T0 + 9000, phase: 'done' }).phase, 'issue');
    assert.equal(applyEvent(c, { runId: 'run1', event: 'phase', at: T0 + 1000, phase: 'login' }).phase, 'issue');
  });
  it('결과 모름(in_doubt)은 확인 중이고 끝나지 않은 것으로 본다. 다시 발급하는 동작이 없다', () => {
    const c = applyEvent(applyAck(cmd(), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }), { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'verify', code: 'in_doubt', attempt: 2 });
    assert.deepEqual(runViewOf(c), { kind: 'inDoubt', tries: 2, startedAt: T0 });
    assert.equal(settled(c), false);
  });
  it('멈춤: 코드 없음·모르는 코드는 이유 없는 멈춤, in_doubt는 확인 중', () => {
    const base = applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' });
    const stop = (code?: string) => runViewOf(applyEvent(base, { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'stopped', code }));
    assert.deepEqual(stop(), { kind: 'stopped', step: 'prepare', reason: 'pcStopped', startedAt: T0 });
    assert.deepEqual(stop('date_mismatch'), { kind: 'stopped', step: 'prepare', reason: 'pcStopped', startedAt: T0 });
    assert.deepEqual(runViewOf(applyEvent(base, { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'verify', code: 'in_doubt', attempt: 1 })), { kind: 'inDoubt', tries: 1, startedAt: T0 });
    assert.match(STOP_COPY.pcStopped.line, /아무것도 발급하지 않았어요/);
  });
  it('PC 사람 차례(turn)는 "진행 중"이 아니라 내 차례로, 다음 사건이 오면 풀린다', () => {
    const base = applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' });
    const t = applyEvent(base, { runId: 'run1', event: 'turn', at: T0 + 1, phase: 'login', code: 'login.simple_auth' });
    assert.deepEqual(runViewOf(t), { kind: 'myTurn', step: 'login', auth: { method: 'pc', code: 'login.simple_auth' }, startedAt: T0 });
    assert.equal(jobOf(t).state, 'running');
    assert.equal(settled(t), false);
    assert.deepEqual(actionsOf(runViewOf(t)!), ['retryCert', 'close']);
    assert.deepEqual(actionsOf(runViewOf(applyEvent(base, { runId: 'run1', event: 'turn', at: T0 + 1, phase: 'login', code: 'portal.captcha' }))!), ['close']);
    assert.match(pcTurnOf('login.simple_auth').line, /공동인증서/);
    for (const t of [...Object.values(PC_TURN), pcTurnOf()]) assert.doesNotMatch(t.line + t.short, /(?<!다른 )PC(에서| 화면| 홈택스| 창)/, '폰은 PC 화면으로 보내지 않는다');
    assert.equal(pcTurnOf('모르는.코드').short, '예상 밖 화면에서 멈췄어요');
    const back = applyEvent(t, { runId: 'run1', event: 'phase', at: T0 + 2, phase: 'login' });
    assert.deepEqual(runViewOf(back), { kind: 'running', step: 'login', startedAt: T0, pcApproval: true });
  });
  it('거절 이유는 한 줄 문구로, 같은 runId의 duplicate는 다시 붙기', () => {
    for (const reason of ['playbook_unavailable', 'input_invalid', 'counterparty_unknown', 'hometax_paused'] as const) {
      const c = applyAck(cmd(), { cmdId: cmd().cmdId, state: 'rejected', reason });
      assert.deepEqual(runViewOf(c), { kind: 'refused', reason, startedAt: T0 });
      assert.ok(REJECT_LINE[reason].length > 0);
      assert.equal(settled(c), true);
    }
    assert.ok(REJECT_LINE.pc_busy.length > 0);
    const again = applyAck(cmd({ ack: 'pc_only', runId: 'run1', phase: 'readback', at: T0 }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'duplicate', runId: 'run1' });
    assert.equal(again.ack, 'pc_only');
    assert.equal(again.phase, 'readback');
    assert.equal(settled(again), false);
  });
  it('끝난 명령은 최근 20개만 남기고 끝나지 않은 명령은 지우지 않는다', () => {
    const done = Array.from({ length: 25 }, (_, i) => cmd({ cmdId: `D${i}`, createdAt: T0 + i, ack: 'rejected', reason: 'input_invalid' }));
    const open = cmd({ cmdId: 'OPEN', createdAt: 0 });
    const kept = trimCmds([open, ...done]);
    assert.equal(kept.length, 21);
    assert.ok(kept.some((c) => c.cmdId === 'OPEN'));
  });
});

/** 가짜 채널: 보낸 봉투를 모으고, 받을 봉투를 차례로 내준다. */
function mockChannel(script: (sent: Array<{ type: string; body: unknown }>) => Envelope[]) {
  const sent: Array<{ type: string; body: unknown }> = [];
  const inbox: Envelope[] = [];
  let closed = false;
  return {
    sent,
    close: () => (closed = true),
    ch: {
      get closed() {
        return closed;
      },
      send(type: string, body: unknown) {
        sent.push({ type, body });
        inbox.push(...script(sent));
        return {} as never;
      },
      async recv() {
        return inbox.shift() ?? null;
      },
    },
  };
}
const env = (type: string, body: unknown) => ({ type, body }) as unknown as Envelope;

function store(init: PhoneCmd[]) {
  let cs = init;
  return { get: () => cs, io: { cmds: () => cs, save: async (f: (x: PhoneCmd[]) => PhoneCmd[]) => void (cs = f(cs)) } };
}

describe('라이브 세션 구동(mock)', () => {
  it('저장된 cmdId로 cmd.run을 보내고 ack·사건을 받아 끝난다', async () => {
    const m = mockChannel(() => [
      env('cmd.ack', { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }),
      env('run.event', { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'approve' }),
      env('run.event', { runId: 'run1', event: 'phase', at: T0 + 2, phase: 'done', result: { approvalNo: 'A1', total: 1_353_005 } }),
    ]);
    const s = store([cmd()]);
    const r = await driveCmds(m.ch as never, [CAP.issue, CAP.copy], s.io, 5000);
    assert.equal(r, 'settled');
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0]!.type, 'cmd.run');
    assert.equal((m.sent[0]!.body as { cmdId: string }).cmdId, cmd().cmdId);
    assert.deepEqual((m.sent[0]!.body as { inputs: unknown }).inputs, {
      counterpart: { counterpartyRef: 'cp_gana' },
      amounts: { supply: 1_230_005, tax: 123_000 },
      items: [{ name: '식자재', supply: 1_230_005, tax: 123_000 }],
      issueDay: '2026-11-17',
    });
    assert.equal(s.get()[0]!.phase, 'done');
    assert.ok(s.get()[0]!.sentAt);
  });
  it('다시 연결하면 같은 cmdId로 다시 보내고 duplicate(같은 runId)로 이어 붙는다', async () => {
    const s = store([cmd({ sentAt: T0, ack: 'pc_only', runId: 'run1', phase: 'login', at: T0 })]);
    const m = mockChannel(() => [
      env('cmd.ack', { cmdId: cmd().cmdId, state: 'rejected', reason: 'duplicate', runId: 'run1' }),
      env('run.event', { runId: 'run1', event: 'phase', at: T0 + 10, phase: 'stopped', code: 'date_mismatch' }),
    ]);
    assert.equal(await driveCmds(m.ch as never, [CAP.issue], s.io, 5000), 'settled');
    assert.equal((m.sent[0]!.body as { cmdId: string }).cmdId, cmd().cmdId);
    assert.equal(s.get()[0]!.ack, 'pc_only');
    assert.deepEqual(runViewOf(s.get()[0]!), { kind: 'stopped', step: 'prepare', reason: 'pcStopped', startedAt: T0 });
  });
  it('[인증서로 다시 시도]: cmd.resume(같은 runId)을 한 번 보내고, 그동안 로그인 중으로 보이며, 다음 사건이 오면 누름을 끝낸다', async () => {
    const turn = applyEvent(applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }), { runId: 'run1', event: 'turn', at: T0 + 1, phase: 'login', code: 'login.simple_auth' });
    assert.ok(canRetryCert(turn));
    const asked = askRetryCert(turn, T0 + 2);
    assert.equal(canRetryCert(asked), false, '두 번 누르지 않는다');
    assert.deepEqual(runViewOf(asked), { kind: 'running', step: 'login', startedAt: T0, pcApproval: true });
    assert.equal(askRetryCert(applyEvent(turn, { runId: 'run1', event: 'phase', at: T0 + 3, phase: 'login' })).resumeAt, undefined, '차례가 아니면 받지 않는다');
    const s = store([asked]);
    const m = mockChannel((sent) => (sent.at(-1)?.type === 'cmd.resume' ? [env('run.event', { runId: 'run1', event: 'phase', at: T0 + 10, phase: 'readback' }), env('run.event', { runId: 'run1', event: 'end', at: T0 + 11, phase: 'stopped', code: 'not_issued' })] : [env('cmd.ack', { cmdId: cmd().cmdId, state: 'rejected', reason: 'duplicate', runId: 'run1' })]));
    assert.equal(await driveCmds(m.ch as never, [CAP.issue], s.io, 5000), 'settled');
    assert.deepEqual(m.sent.filter((x) => x.type === 'cmd.resume').map((x) => x.body), [{ runId: 'run1' }]);
    assert.equal(s.get()[0]!.resumeAt, undefined);
    assert.equal(s.get()[0]!.turn, undefined);
  });
  it('PC가 issue.v1을 모르면 보내지 않고 새 버전 안내', async () => {
    const m = mockChannel(() => []);
    const s = store([cmd()]);
    assert.equal(await driveCmds(m.ch as never, [CAP.copy], s.io, 5000), 'pc_old');
    assert.equal(m.sent.length, 0);
    assert.deepEqual(runViewOf(s.get()[0]!), { kind: 'refused', reason: 'pc_old', startedAt: T0 });
  });
  it('끝난 명령만 있으면 아무것도 보내지 않는다', async () => {
    const m = mockChannel(() => []);
    assert.equal(await driveCmds(m.ch as never, [CAP.issue], store([cmd({ ack: 'rejected', reason: 'input_invalid' })]).io, 5000), 'none');
    assert.equal(m.sent.length, 0);
  });
  it('세션이 끊기면 멈춘다(다음 연결 때 다시 보낸다)', async () => {
    const m = mockChannel(() => [env('cmd.ack', { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' })]);
    const s = store([cmd()]);
    let n = 0;
    const r = await driveCmds(m.ch as never, [CAP.issue], { ...s.io, alive: () => ++n < 3 }, 5000);
    assert.equal(r, 'closed');
    assert.equal(settled(s.get()[0]!), false);
  });
});

describe('밀린 일: 거절·중지된 폰 발급 명령', () => {
  it('끝난 거절·중지 줄은 [치우기]가 있다. 아직 안 보낸 명령은 [취소], 확인 필요는 [자세히]', () => {
    const refused = jobOf(applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'counterparty_unknown' }));
    assert.equal(refused.state, 'needPc');
    assert.equal(actionFor(refused, 'needPc')?.key, 'dismiss');
    const stopped = jobOf(applyEvent(applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }), { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'stopped' }));
    assert.equal(stopped.state, 'needPc');
    assert.equal(actionFor(stopped, 'needPc')?.key, 'dismiss');
    assert.equal(actionFor(jobOf(cmd()), 'entrusted')?.key, 'cancel');
    const verify = jobOf(applyEvent(applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run1' }), { runId: 'run1', event: 'phase', at: T0 + 1, phase: 'stopped', code: 'in_doubt' }));
    assert.equal(actionFor(verify, 'verify')?.key, 'progress');
  });
  it('폰 승인 한도처럼 PC 앞에서 해야 하는 일(run 없음)에는 동작이 없다', () => {
    assert.equal(actionFor({ id: 'j', title: 't', amount: 1, createdAt: T0, state: 'needPc', reason: 'dailyLimit' }, 'needPc'), null);
  });
});

describe('PC가 다른 일 중(pc_busy): 저절로 이어서 한다', () => {
  it('거절이 아니라 기다리는 일이고, 30초 뒤 다시 보낸다. 72시간이 지나면 그만둔다', () => {
    const now = T0 + 60_000;
    const c = applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'pc_busy' }, now);
    assert.equal(c.retryAt, now + BUSY_RETRY_MS);
    assert.equal(busyWaiting(c, now), true);
    assert.equal(settled(c, now), false);
    assert.equal(settled(c, T0 + BUSY_GIVE_UP_MS), true);
  });
  it('밀린 일에서는 기다리는 일, [취소]만 있다', () => {
    const j = jobOf(applyAck(cmd({ sentAt: T0, createdAt: Date.now(), req: issueRequest({ ref: 'cp_gana', supply: 1_230_005, item: '식자재' }) }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'pc_busy' }));
    assert.equal(j.state, 'phoneWaiting');
    assert.equal(j.wait, 'pcBusy');
    assert.equal(j.run, undefined);
    assert.equal(actionFor(j, 'phoneWaiting')?.key, 'cancel');
    const old = jobOf(applyAck(cmd({ sentAt: T0, createdAt: Date.now() }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'pc_busy' }));
    assert.equal(old.wait, 'newDay');
    assert.equal(actionFor(old, 'phoneWaiting')?.key, 'redate');
  });
  it('기다리는 사이 날짜가 바뀌면 몰래 바꾸지 않고 확인을 기다린다. [오늘 날짜로 맡기기]를 눌러야 바꿔 다시 보낸다', () => {
    const nextDay = T0 + 86_400_000;
    const c = applyAck(cmd({ sentAt: T0 }), { cmdId: cmd().cmdId, state: 'rejected', reason: 'pc_busy' }, T0);
    assert.equal(needsRedate(c, nextDay), true);
    assert.equal(retryDue(c, nextDay), false);
    assert.equal(c.req.day, kstDay(T0));
    const r = redate(c, nextDay);
    assert.equal(r.req.day, kstDay(nextDay));
    assert.equal(needsRedate(r, nextDay), false);
    assert.equal(retryDue(r, nextDay), true);
  });
  it('세션 중에 다시 보낼 때가 되면 같은 cmdId, 같은 입력으로 다시 보내고 이어서 끝난다', async () => {
    let clock = T0;
    const m = mockChannel((sent) =>
      sent.length === 1
        ? [env('cmd.ack', { cmdId: cmd().cmdId, state: 'rejected', reason: 'pc_busy' })]
        : [env('cmd.ack', { cmdId: cmd().cmdId, state: 'pc_only', runId: 'run2' }), env('run.event', { runId: 'run2', event: 'phase', at: clock, phase: 'done', result: { approvalNo: 'A2', total: 1_353_005 } })],
    );
    const s = store([cmd()]);
    const r = await driveCmds(m.ch as never, [CAP.issue], { ...s.io, now: () => (clock += 5_000) }, 10 * 60_000);
    assert.equal(r, 'settled');
    assert.equal(m.sent.length, 2);
    assert.equal((m.sent[1]!.body as { cmdId: string }).cmdId, cmd().cmdId);
    assert.equal(s.get()[0]!.retries, 1);
    assert.equal(s.get()[0]!.phase, 'done');
  });
});
