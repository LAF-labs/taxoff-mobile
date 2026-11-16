import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ARM_DELAY_MS, actionHash, dupDetail, buildGate, cardHash, gateMatches, mmss, readGate, sheetState, showValue, type GateField, type PhoneGate, type SheetContext,
} from '../src/approval.ts';

// PC 엔진(tex poc/packages/engine/src/gate.ts buildGateRequest·cardHash)으로 만든 벡터. source에 커밋이 있다.
const PC = JSON.parse(readFileSync(new URL('./fixtures/gate-vectors.json', import.meta.url), 'utf8')) as {
  source: string;
  vectors: Array<{ name: string; fields: GateField[]; cardHashInputs: PhoneGate['cardHashInputs']; cardHash: string; actionHash: string }>;
};

const CH = 'A'.repeat(43) + '=';
const gateOf = (v: (typeof PC.vectors)[number], exp = 1_000_000): PhoneGate => ({ reqId: '01JD0000000000000000000000', fields: v.fields, cardHashInputs: v.cardHashInputs, actionHash: v.actionHash, challenge: CH, exp });

describe('승인 해시(D03 §3) — PC 엔진 벡터와 같아야 한다', () => {
  for (const v of PC.vectors) {
    it(v.name, () => {
      assert.equal(cardHash(v.fields), v.cardHash);
      assert.equal(actionHash(v.cardHash, v.cardHashInputs), v.actionHash);
      assert.ok(gateMatches(gateOf(v)));
    });
  }
  it('buildGate가 PC buildGateRequest와 같은 actionHash를 낸다', () => {
    const v = PC.vectors[0]!;
    const rb = Object.fromEntries(v.fields.slice(0, 13).map((f) => [f.key, f.value])) as never;
    const g = buildGate({ readback: rb, reserved: v.fields.slice(13), ...v.cardHashInputs, reqId: 'x', challenge: CH, exp: 0 });
    assert.equal(g.cardHashInputs.readbackHash, v.cardHashInputs.readbackHash);
    assert.equal(g.actionHash, v.actionHash);
  });
  it('값·순서·키가 하나라도 바뀌면 맞지 않는다', () => {
    const v = PC.vectors[0]!;
    const changed = v.fields.map((f) => (f.key === 'totalAmount' ? { ...f, value: '352001' } : f));
    assert.equal(gateMatches({ ...gateOf(v), fields: changed }), false);
    const swapped = [v.fields[1]!, v.fields[0]!, ...v.fields.slice(2)];
    assert.equal(gateMatches({ ...gateOf(v), fields: swapped }), false);
    assert.equal(gateMatches({ ...gateOf(v), cardHashInputs: { ...v.cardHashInputs, authorizes: ['s22'] } }), false);
    assert.equal(gateMatches({ ...gateOf(v), cardHashInputs: { ...v.cardHashInputs, readbackHash: 'zz' } }), false);
  });
});

describe('승인 시트 상태', () => {
  const v = PC.vectors[0]!;
  const ctx = (o: Partial<SheetContext> = {}): SheetContext => ({ now: 10_000, openedAt: 0, attest: 'hw', iosAllowed: true, usedToday: 0, acked: new Set(), ...o });
  it('열림: 무장 지연 0.8초, 마지막 20초 강조, 만료', () => {
    const g = gateOf(v, 130_000);
    assert.deepEqual(sheetState(g, ctx({ now: ARM_DELAY_MS - 1 })), { kind: 'open', armed: false, leftMs: 130_000 - ARM_DELAY_MS + 1, urgent: false, needsAck: false });
    assert.equal((sheetState(g, ctx({ now: 115_000 })) as { urgent: boolean }).urgent, true);
    assert.deepEqual(sheetState(g, ctx({ now: 130_000 })), { kind: 'expired' });
  });
  it('멈춤 우선순위: 해시 > 모르는 항목 > 키 > iPhone > 처음 거래처 > 한도', () => {
    const g = gateOf(v);
    assert.deepEqual(sheetState({ ...g, actionHash: '0'.repeat(64) }, ctx()), { kind: 'stopped', stop: 'mismatch' });
    assert.deepEqual(sheetState(g, ctx({ attest: 'none' })), { kind: 'stopped', stop: 'noKey' });
    assert.deepEqual(sheetState(g, ctx({ attest: 'ios_app_attest', iosAllowed: false })), { kind: 'stopped', stop: 'iosDenied' });
    assert.equal(sheetState(g, ctx({ attest: 'ios_app_attest', iosAllowed: true })).kind, 'open');
    assert.deepEqual(sheetState(g, ctx({ usedToday: 5 })), { kind: 'stopped', stop: 'limit' });
    assert.deepEqual(sheetState(gateOf(PC.vectors[2]!), ctx()), { kind: 'stopped', stop: 'first' });
    assert.deepEqual(sheetState(g, ctx({ inDoubt: true })), { kind: 'inDoubt' });
  });
  it('모르는 항목은 해시가 맞아도 멈춘다', () => {
    const fields = [...v.fields, { key: 'bankAccount', value: '1234' }];
    const g = buildGate({ readback: Object.fromEntries(v.fields.slice(0, 13).map((f) => [f.key, f.value])) as never, reserved: fields.slice(13), ...v.cardHashInputs, reqId: 'x', challenge: CH, exp: 1e6 });
    assert.ok(gateMatches(g));
    assert.deepEqual(readGate(g).unknown, ['bankAccount']);
    assert.deepEqual(sheetState(g, ctx()), { kind: 'stopped', stop: 'unknown' });
  });
  it('같은 건 경고는 확인해야 승인이 켜진다', () => {
    const g = gateOf(PC.vectors[1]!);
    assert.deepEqual(readGate(g).dups.map((d) => d.key), ['$dup.businessKey']);
    assert.equal((sheetState(g, ctx()) as { needsAck: boolean }).needsAck, true);
    assert.equal((sheetState(g, ctx({ acked: new Set(['$dup.businessKey']) })) as { needsAck: boolean }).needsAck, false);
  });
  it('같은 건 둘째 줄: 값이 승인번호 끝·시각을 실어 올 때만', () => {
    assert.equal(dupDetail('committed'), undefined);
    assert.equal(dupDetail('committed;4821;10:20'), '승인번호 끝 4821 · 오전 10:20');
    assert.equal(dupDetail('committed;4821'), '승인번호 끝 4821');
    assert.equal(dupDetail('committed;;14:05'), '오후 2:05');
  });
  it('표시: 금액은 쉼표+원(띄움 없음), 남은 시간', () => {
    assert.equal(showValue('totalAmount', '1353000'), '1,353,000원');
    assert.equal(showValue('itemName', '1353000'), '1353000');
    assert.equal(mmss(120_000), '2:00');
    assert.equal(mmss(19_100), '0:20');
  });
});
