import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Envelope, GateRequestBody, GateResponseBody, PxEnrollBody } from '../vendor/sax-remote/src/index.ts';
import type { PhoneCmd } from '../src/phoneCmd.ts';
import type { PxNative } from '../src/approvalKey.ts';

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
const { CAP, b64, fromB64, ed25519Keygen, pxIdOf, verifyApprove, verifyPxEnroll } = await import('@sax/remote');
const { deviceApprovalKey, PX_TAG } = await import('../src/approvalKey.ts');
const { APPROVE_CTX, approveMessage, sheetState, ARM_DELAY_MS } = await import('../src/approval.ts');
const { enrollPx } = await import('../src/net/pxLive.ts');
const { driveCmds } = await import('../src/net/issueLive.ts');
const { answerGate, applyEvent, applyGate, applyResolved, askRefresh, deniedByPhone, issueRequest, jobOf, markAnswered, openGate, responseDue, runViewOf, settled } = await import('../src/phoneCmd.ts');

const PC = JSON.parse(readFileSync(new URL('./fixtures/gate-vectors.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ fields: GateRequestBody['fields']; cardHashInputs: GateRequestBody['cardHashInputs']; actionHash: string }>;
};
const V = PC.vectors[0]!;

function fakeNative(o: { cancel?: boolean; fail?: string } = {}) {
  const keys = new Map<string, Uint8Array>();
  const log: string[] = [];
  const pubOf = (sk: Uint8Array) => b64(p256.getPublicKey(sk, false));
  const n: PxNative = {
    async pxPublic(tag) {
      const sk = keys.get(tag);
      return sk ? pubOf(sk) : null;
    },
    async pxCreate(tag) {
      log.push('create');
      if (!keys.has(tag)) keys.set(tag, p256.utils.randomSecretKey());
      return pubOf(keys.get(tag)!);
    },
    async pxSign(tag, dataB64) {
      log.push('sign');
      if (o.fail) throw new Error(o.fail);
      if (o.cancel) return null;
      const sk = keys.get(tag);
      if (!sk) throw new Error('px_missing');
      return b64(p256.sign(sha256(fromB64(dataB64)), sk, { prehash: false, format: 'der' }));
    },
    async pxDelete(tag) {
      log.push('delete');
      keys.delete(tag);
    },
  };
  return { n, keys, log };
}

const PAIR = '01JDPAIR000000000000000001';
const T0 = Date.parse('2026-11-19T01:00:00Z');
const CHALLENGE = b64(new Uint8Array(32).fill(7));
const gateReq = (o: Partial<GateRequestBody> = {}): GateRequestBody => ({
  runId: '01JDRUN0000000000000000001',
  stepId: 's21',
  reqId: '01JDREQ0000000000000000001',
  cardId: 'invoice.confirm',
  gateKind: 'commit',
  effects: ['issue_document', 'send'],
  fields: V.fields,
  cardHashInputs: V.cardHashInputs,
  actionHash: V.actionHash,
  requiredSigAlg: 'p256',
  challenge: CHALLENGE,
  exp: T0 + 120_000,
  ...o,
});
const cmd = (o: Partial<PhoneCmd> = {}): PhoneCmd => ({
  cmdId: '01JDCMD0000000000000000001',
  req: issueRequest({ target: { counterpartyRef: 'cp_gana' }, supply: 320_000, item: '식자재', now: T0 }),
  cpName: '가나식자재',
  total: 352_000,
  createdAt: T0,
  sentAt: T0,
  ack: 'accepted',
  runId: '01JDRUN0000000000000000001',
  phase: 'approve',
  at: T0,
  ...o,
});

describe('하드웨어 승인 키(네이티브 흉내)', () => {
  it('네이티브에 px 함수가 없으면 키가 없다(옛 빌드·Android)', () => {
    assert.equal(deviceApprovalKey(null), null);
    assert.equal(deviceApprovalKey({ pxPublic: async () => null }), null);
  });
  it('키가 없으면 만들고, 있으면 같은 공개키를 돌려준다', async () => {
    const f = fakeNative();
    const k = deviceApprovalKey(f.n)!;
    const a = await k.ensure();
    const b = await k.ensure();
    assert.equal(a!.length, 65);
    assert.deepEqual(a, b);
    assert.deepEqual(f.log, ['create']);
    assert.equal(k.hw, 'ios_se');
  });
  it('서명은 PC 검증기(verifyApprove)를 통과한다: DER → r‖s, SAX-approve-v1 ‖ CBOR', async () => {
    const f = fakeNative();
    const k = deviceApprovalKey(f.n)!;
    const pub = (await k.ensure())!;
    const g = gateReq();
    for (const decision of ['approve', 'deny'] as const) {
      const signed = await k.sign(APPROVE_CTX, approveMessage(PAIR, g.reqId, g.challenge, g.actionHash, decision));
      assert.equal(signed!.sigAlg, 'p256');
      const sig = fromB64(signed!.sig);
      assert.equal(sig.length, 64);
      const input = { pairId: PAIR, reqId: g.reqId, challenge: fromB64(g.challenge), actionHash: g.actionHash, decision };
      assert.ok(verifyApprove(pub, input, sig));
      assert.equal(verifyApprove(pub, { ...input, decision: decision === 'approve' ? 'deny' : 'approve' }, sig), false);
      assert.equal(verifyApprove(pub, { ...input, reqId: '01JDREQ0000000000000000002' }, sig), false);
      assert.equal(verifyApprove(pub, { ...input, pairId: '01JDPAIR000000000000000002' }, sig), false);
    }
  });
  it('생체 확인을 취소하면 null, 키는 그대로', async () => {
    const f = fakeNative({ cancel: true });
    const k = deviceApprovalKey(f.n)!;
    await k.ensure();
    assert.equal(await k.sign(APPROVE_CTX, new Uint8Array(4)), null);
    assert.ok(f.keys.has(PX_TAG));
  });
  it('서명이 실패하면(생체 재등록으로 키가 죽음) 키를 지운다. 잠김은 지우지 않는다', async () => {
    const dead = fakeNative({ fail: 'px_sign_failed:-25293' });
    const k = deviceApprovalKey(dead.n)!;
    await k.ensure();
    assert.equal(await k.sign(APPROVE_CTX, new Uint8Array(4)), null);
    assert.equal(dead.keys.has(PX_TAG), false);
    const locked = fakeNative({ fail: 'biometry_lockout' });
    const k2 = deviceApprovalKey(locked.n)!;
    await k2.ensure();
    assert.equal(await k2.sign(APPROVE_CTX, new Uint8Array(4)), null);
    assert.ok(locked.keys.has(PX_TAG));
  });
});

function mockChannel(script: (sent: Array<{ type: string; body: unknown }>) => Envelope[]) {
  const sent: Array<{ type: string; body: unknown }> = [];
  const inbox: Envelope[] = [];
  return {
    sent,
    inbox,
    ch: {
      closed: false,
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

describe('승인 키 알리기(px.enroll → px.ack)', () => {
  const vm = ed25519Keygen();
  const DEVICE = '3b0c9f52-7a1e-4d55-9c1e-0a8d5e2f4b11';
  it('Vm으로 서명한 알림을 보내고 PC의 답을 적는다', async () => {
    const f = fakeNative();
    const px = deviceApprovalKey(f.n)!;
    const pub = (await px.ensure())!;
    const m = mockChannel((sent) => (sent.at(-1)!.type === 'px.enroll' ? [env('phone.copy', { asOf: 1, counterparties: [] }), env('px.ack', { state: 'enrolled', pxId: pxIdOf(pub) })] : []));
    const copies: unknown[] = [];
    const r = await enrollPx(m.ch as never, [CAP.issue, CAP.approve], { pairId: PAIR, deviceId: DEVICE, vm: vm.secretKey, px, onCopy: async (c) => void copies.push(c), now: () => T0 });
    assert.deepEqual(r, { pxId: pxIdOf(pub), state: 'enrolled', at: T0 });
    assert.equal(copies.length, 1);
    const body = m.sent[0]!.body as PxEnrollBody;
    assert.equal(body.hw, 'ios_se');
    assert.deepEqual(fromB64(body.pxPub), pub);
    assert.ok(verifyPxEnroll(vm.publicKey, PAIR, DEVICE, pub, 'ios_se', fromB64(body.sig)));
    assert.equal(verifyPxEnroll(vm.publicKey, '01JDPAIR000000000000000002', DEVICE, pub, 'ios_se', fromB64(body.sig)), false);
  });
  it('PC가 approve.v1을 모르거나 키가 없으면 보내지 않는다', async () => {
    const m = mockChannel(() => []);
    const px = deviceApprovalKey(fakeNative().n)!;
    assert.equal(await enrollPx(m.ch as never, [CAP.issue], { pairId: PAIR, deviceId: DEVICE, vm: vm.secretKey, px }), null);
    assert.equal(await enrollPx(m.ch as never, [CAP.approve], { pairId: PAIR, deviceId: DEVICE, vm: vm.secretKey, px: null }), null);
    assert.equal(m.sent.length, 0);
  });
  it('PC에서 폰 승인을 꺼 두었으면 needs_pc, 다른 키의 답은 믿지 않는다', async () => {
    const px = deviceApprovalKey(fakeNative().n)!;
    const pub = (await px.ensure())!;
    const off = mockChannel(() => [env('px.ack', { state: 'needs_pc', pxId: pxIdOf(pub) })]);
    assert.equal((await enrollPx(off.ch as never, [CAP.approve], { pairId: PAIR, deviceId: DEVICE, vm: vm.secretKey, px }))!.state, 'needs_pc');
    const other = mockChannel(() => [env('px.ack', { state: 'enrolled', pxId: '00'.repeat(8) })]);
    assert.equal(await enrollPx(other.ch as never, [CAP.approve], { pairId: PAIR, deviceId: DEVICE, vm: vm.secretKey, px }), null);
  });
});

describe('승인 요청 모델', () => {
  it('gate.request가 오면 승인 대기가 되고 승인 시트가 그 값으로 열린다', () => {
    const c = applyGate(cmd({ phase: 'readback' }), gateReq());
    assert.equal(c.phase, 'approve');
    const j = jobOf(c);
    assert.equal(j.state, 'approval');
    assert.equal(j.gate!.reqId, gateReq().reqId);
    assert.deepEqual(runViewOf(c), { kind: 'running', step: 'approve', startedAt: T0, pcApproval: false });
    const st = sheetState(j.gate!, { now: T0 + ARM_DELAY_MS, openedAt: T0, attest: 'ios_se', iosAllowed: true, usedToday: 0, acked: new Set() });
    assert.equal(st.kind, 'open');
  });
  it('다른 실행·시작 게이트·Ed25519 요청은 받지 않는다', () => {
    assert.equal(applyGate(cmd(), gateReq({ runId: '01JDRUN0000000000000000009' })).gate, undefined);
    assert.equal(applyGate(cmd(), gateReq({ gateKind: 'start' })).gate, undefined);
    assert.equal(applyGate(cmd(), gateReq({ requiredSigAlg: 'ed25519' })).gate, undefined);
    assert.equal(applyGate(cmd({ runId: undefined }), gateReq()).gate, undefined);
  });
  it('답을 적으면 시트가 닫히고, 보낸 뒤에는 발급 단계로 보인다', () => {
    const g = gateReq();
    let c = applyGate(cmd(), g);
    c = answerGate(c, { reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sig: 'c2ln' }, T0 + 1000);
    assert.equal(openGate(c, T0 + 1000), null);
    assert.deepEqual(responseDue(c, T0 + 2000), { runId: g.runId, stepId: 's21', reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sigAlg: 'p256', sig: 'c2ln' });
    c = markAnswered(c, g.reqId, T0 + 2000);
    assert.equal(c.gate, undefined);
    assert.equal(responseDue(c, T0 + 2500), null);
    assert.deepEqual(runViewOf(c), { kind: 'running', step: 'issue', startedAt: T0 });
    assert.equal(jobOf(c).state, 'running');
    assert.equal(settled(c), false);
  });
  it('다른 요청의 답, 값이 다른 답, 마감 뒤의 답은 적지 않는다', () => {
    const g = gateReq();
    const c = applyGate(cmd(), g);
    assert.equal(answerGate(c, { reqId: 'other', decision: 'approve', actionHash: g.actionHash, sig: 's' }, T0).answer, undefined);
    assert.equal(answerGate(c, { reqId: g.reqId, decision: 'approve', actionHash: 'ab'.repeat(32), sig: 's' }, T0).answer, undefined);
    assert.equal(answerGate(c, { reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sig: 's' }, g.exp + 1).answer, undefined);
  });
  it('답을 못 보내고 마감이 지나면 보내지 않고 다시 요청할 수 있다', () => {
    const g = gateReq();
    let c = answerGate(applyGate(cmd(), g), { reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sig: 's' }, T0);
    assert.equal(responseDue(c, g.exp + 1), null);
    assert.equal(openGate(c, g.exp + 1)!.reqId, g.reqId);
    assert.equal(jobOf(c).state, 'approval');
    c = askRefresh(c, g.exp + 1);
    assert.equal(c.refresh, g.reqId);
    assert.equal(c.answer, undefined);
    assert.equal(askRefresh(applyGate(cmd(), g), T0).refresh, undefined);
    const next = applyGate(c, gateReq({ reqId: '01JDREQ0000000000000000002', exp: g.exp + 120_000 }));
    assert.equal(next.gate!.reqId, '01JDREQ0000000000000000002');
    assert.equal(next.refresh, undefined);
  });
  it('승인 단계를 지나거나 PC가 폰 승인을 거두면 받은 요청을 지운다', () => {
    const c = applyGate(cmd(), gateReq());
    assert.equal(applyEvent(c, { runId: c.runId!, event: 'phase', at: T0 + 1, phase: 'issue' }).gate, undefined);
    assert.equal(applyEvent(c, { runId: c.runId!, event: 'phase', at: T0 + 1, phase: 'stopped' }).gate, undefined);
    const pc = applyEvent(c, { runId: c.runId!, event: 'phase', at: T0 + 1, phase: 'approve', code: 'pc_only' });
    assert.equal(pc.gate, undefined);
    assert.deepEqual(runViewOf(pc), { kind: 'running', step: 'approve', startedAt: T0, pcApproval: true });
    assert.ok(applyEvent(c, { runId: c.runId!, event: 'phase', at: T0 + 1, phase: 'approve' }).gate);
  });
  it('PC가 폰으로 보내지 않은 이유를 일에 싣는다(승인은 PC에서)', () => {
    const of = (code: string) => jobOf(cmd({ code }));
    assert.equal(of('pc_first').reason, 'firstCounterparty');
    assert.equal(of('pc_limit').reason, 'dailyLimit');
    assert.equal(of('pc_key').reason, 'notApprover');
    assert.equal(of('pc_first').state, 'running');
    assert.equal(jobOf(cmd()).reason, undefined);
  });
  it('폰에서 거절해 보낸 명령은 끝난 것으로 본다', () => {
    const g = gateReq();
    let c = answerGate(applyGate(cmd(), g), { reqId: g.reqId, decision: 'deny', actionHash: g.actionHash, sig: 's' }, T0);
    assert.equal(deniedByPhone(c), false);
    assert.equal(settled(c), false);
    c = markAnswered(c, g.reqId, T0 + 1);
    assert.ok(deniedByPhone(c));
    assert.ok(settled(c));
  });
});

function store(init: PhoneCmd[]) {
  let cs = init;
  return { get: () => cs, io: { cmds: () => cs, save: async (f: (x: PhoneCmd[]) => PhoneCmd[]) => void (cs = f(cs)) } };
}

describe('라이브 세션: 승인 요청을 받고 서명한 답을 보낸다(mock)', () => {
  it('cmd.run → accepted → gate.request → (승인) gate.response → 발급 끝. PC 검증기가 서명을 받는다', async () => {
    const f = fakeNative();
    const px = deviceApprovalKey(f.n)!;
    const pub = (await px.ensure())!;
    const now = Date.now();
    const g = gateReq({ exp: now + 120_000 });
    const c0 = cmd({ sentAt: undefined, ack: undefined, runId: undefined, phase: undefined, at: undefined, createdAt: now });
    const s = store([c0]);
    let answered = false;
    const m = mockChannel((sent) => {
      const last = sent.at(-1)!;
      if (last.type === 'cmd.run')
        return [
          env('cmd.ack', { cmdId: c0.cmdId, state: 'accepted', runId: g.runId }),
          env('run.event', { runId: g.runId, cmdId: c0.cmdId, event: 'phase', at: now + 1, phase: 'approve' }),
          env('gate.request', g),
        ];
      if (last.type === 'gate.response') return [env('run.event', { runId: g.runId, event: 'phase', at: now + 3, phase: 'done', result: { approvalNo: 'A1', total: 352_000 } })];
      return [];
    });
    const io = {
      ...s.io,
      cmds: () => {
        const cs = s.get();
        const open = cs[0] && openGate(cs[0]);
        if (open && !answered) {
          answered = true;
          void px.sign(APPROVE_CTX, approveMessage(PAIR, open.reqId, open.challenge, open.actionHash, 'approve')).then((signed) =>
            s.io.save((xs) => xs.map((x) => answerGate(x, { reqId: open.reqId, decision: 'approve', actionHash: open.actionHash, sig: signed!.sig }))),
          );
        }
        return cs;
      },
    };
    const r = await driveCmds(m.ch as never, [CAP.issue, CAP.approve], io, 5000);
    assert.equal(r, 'settled');
    assert.deepEqual(m.sent.map((x) => x.type), ['cmd.run', 'gate.response']);
    const res = m.sent[1]!.body as GateResponseBody;
    assert.deepEqual({ ...res, sig: '' }, { runId: g.runId, stepId: 's21', reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sigAlg: 'p256', sig: '' });
    assert.ok(verifyApprove(pub, { pairId: PAIR, reqId: g.reqId, challenge: fromB64(g.challenge), actionHash: g.actionHash, decision: 'approve' }, fromB64(res.sig)));
    assert.equal(s.get()[0]!.phase, 'done');
    assert.equal(s.get()[0]!.gate, undefined);
  });
  it('PC가 approve.v1을 알리지 않으면 gate.request를 받지 않고 답도 보내지 않는다', async () => {
    const now = Date.now();
    const g = gateReq({ exp: now + 120_000 });
    const s = store([cmd({ createdAt: now, sentAt: now, at: now, answer: { reqId: g.reqId, stepId: 's21', decision: 'approve', actionHash: g.actionHash, sig: 's', exp: g.exp } })]);
    const m = mockChannel((sent) => (sent.at(-1)!.type === 'cmd.run' ? [env('gate.request', g), env('run.event', { runId: g.runId, event: 'phase', at: now + 5, phase: 'stopped' })] : []));
    assert.equal(await driveCmds(m.ch as never, [CAP.issue], s.io, 5000), 'settled');
    assert.deepEqual(m.sent.map((x) => x.type), ['cmd.run']);
  });
  it('[PC에 다시 요청]은 gate.refresh로 가고, 새 요청이 오면 바뀐다', async () => {
    const now = Date.now();
    const old = gateReq({ exp: now - 1000 });
    const fresh = gateReq({ reqId: '01JDREQ0000000000000000002', exp: now + 120_000 });
    const s = store([askRefresh(applyGate(cmd({ createdAt: now, sentAt: now, at: now }), old))]);
    assert.equal(s.get()[0]!.refresh, old.reqId);
    const m = mockChannel((sent) => {
      const last = sent.at(-1)!;
      if (last.type === 'gate.refresh') return [env('gate.request', fresh)];
      return [];
    });
    const r = await driveCmds(m.ch as never, [CAP.issue, CAP.approve], s.io, 700);
    assert.equal(r, 'timeout');
    assert.deepEqual(m.sent.find((x) => x.type === 'gate.refresh')!.body, { runId: old.runId, reqId: old.reqId });
    assert.equal(s.get()[0]!.gate!.reqId, fresh.reqId);
    assert.equal(s.get()[0]!.refresh, undefined);
    assert.equal(jobOf(s.get()[0]!).state, 'approval');
  });
});

describe('v1.11 sync.v1: 판 번호와 다른 곳에서 닫힌 승인', () => {
  it('판 번호가 있으면 적용한 것보다 크지 않은 run.event를 PC 시계와 상관없이 버린다', () => {
    const run = '01JDRUN0000000000000000001';
    let c = applyEvent(cmd({ phase: 'prepare' }), { runId: run, event: 'phase', at: T0 + 10, phase: 'login', rev: 2 });
    assert.equal(c.rev, 2);
    assert.equal(applyEvent(c, { runId: run, event: 'phase', at: T0 + 99, phase: 'prepare', rev: 1 }).phase, 'login');
    assert.equal(applyEvent(c, { runId: run, event: 'phase', at: T0 + 99, phase: 'prepare', rev: 2 }).phase, 'login');
    c = applyEvent(c, { runId: run, event: 'phase', at: T0, phase: 'readback', rev: 5 });
    assert.deepEqual([c.phase, c.rev], ['readback', 5]);
    const old = applyEvent(cmd({ at: T0 + 10 }), { runId: run, event: 'phase', at: T0, phase: 'issue' });
    assert.equal(old.phase, 'approve');
  });
  it('gate.resolved가 오면 그 요청과 보내지 못한 답을 지워 시트를 닫는다. 다른 요청은 그대로', () => {
    const g = gateReq();
    const c = applyGate(cmd(), g);
    assert.equal(jobOf(c).state, 'approval');
    const done = applyResolved(c, { runId: g.runId, reqId: g.reqId, by: 'pc' });
    assert.equal(done.gate, undefined);
    assert.equal(done.resolvedBy, 'pc');
    assert.notEqual(jobOf(done).state, 'approval');
    const signed = answerGate(c, { reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sig: 's' }, T0);
    const r = applyResolved(signed, { runId: g.runId, reqId: g.reqId, by: 'expired' });
    assert.equal(r.answer, undefined);
    assert.equal(responseDue(r, T0 + 1), null);
    const sent = markAnswered(answerGate(c, { reqId: g.reqId, decision: 'deny', actionHash: g.actionHash, sig: 's' }, T0), g.reqId, T0 + 1);
    assert.ok(deniedByPhone(applyResolved(sent, { runId: g.runId, reqId: g.reqId, by: 'phone' })));
    assert.equal(applyResolved(c, { runId: '01JDRUN0000000000000000009', reqId: g.reqId, by: 'pc' }), c);
    assert.equal(applyResolved(c, { runId: g.runId, reqId: '01JDREQ0000000000000000009', by: 'pc' }), c);
    const asked = askRefresh(c, g.exp + 1);
    assert.equal(applyResolved(asked, { runId: g.runId, reqId: g.reqId, by: 'stopped' }).refresh, undefined);
    assert.equal(applyGate(done, gateReq({ reqId: '01JDREQ0000000000000000002' })).resolvedBy, undefined);
  });
  it('라이브 세션에서 gate.resolved를 받으면 시트가 닫힌다(approve.v1 PC)', async () => {
    const now = Date.now();
    const g = gateReq({ exp: now + 120_000 });
    const s = store([applyGate(cmd({ createdAt: now, sentAt: now, at: now }), g)]);
    let fed = false;
    const m = mockChannel(() => {
      if (fed) return [];
      fed = true;
      return [env('gate.resolved', { runId: g.runId, reqId: g.reqId, by: 'pc' })];
    });
    await driveCmds(m.ch as never, [CAP.issue, CAP.approve, CAP.sync], s.io, 700);
    assert.equal(s.get()[0]!.gate, undefined);
    assert.equal(s.get()[0]!.resolvedBy, 'pc');
  });
});

describe('라이브 세션: 답을 보내다 실패해도 세션이 죽지 않는다', () => {
  it('봉투가 규칙에 맞지 않아 던지면 그 답을 버리고 승인 요청을 다시 보인다', async () => {
    const now = Date.now();
    const g = gateReq({ exp: now + 120_000 });
    const c = answerGate(applyGate(cmd({ createdAt: now, sentAt: now, at: now }), g), { reqId: g.reqId, decision: 'approve', actionHash: g.actionHash, sig: 's' }, now);
    const s = store([c]);
    const m = mockChannel(() => []);
    const send = m.ch.send;
    m.ch.send = (type: string, body: unknown) => {
      if (type === 'gate.response') throw new Error('schema');
      return send(type, body);
    };
    assert.equal(await driveCmds(m.ch as never, [CAP.issue, CAP.approve], s.io, 400), 'timeout');
    assert.equal(s.get()[0]!.answer, undefined);
    assert.equal(openGate(s.get()[0]!)!.reqId, g.reqId);
  });
});
