import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOP_COPY, actionsOf, chipOf, elapsed, groupApprovalNo, stepOf, type RunView } from '../src/run.ts';

describe('진행·결과(P-04)', () => {
  it('결과 모름·확인 필요·발급됨에는 다시 발급하는 동작이 없다', () => {
    const states: RunView[] = [{ kind: 'inDoubt', tries: 3, startedAt: 0 }, { kind: 'verify', startedAt: 0 }];
    for (const r of states) assert.deepEqual(actionsOf(r), ['close']);
  });
  it('승인 뒤 단계에서는 중지가 없다', () => {
    assert.deepEqual(actionsOf({ kind: 'running', step: 'issue', startedAt: 0 }), ['close']);
    assert.deepEqual(actionsOf({ kind: 'running', step: 'readback', startedAt: 0 }), ['stop']);
  });
  it('중지 문구는 모두 "아무것도 발급하지 않았어요"를 담는다', () => {
    for (const c of Object.values(STOP_COPY)) assert.ok(c.line.includes('아무것도 발급하지 않았어요'));
  });
  it('폰에서 못 하는 행동은 PC에서 열기 예약, 예약하면 닫기만', () => {
    assert.deepEqual(actionsOf({ kind: 'stopped', step: 'readback', reason: 'unknownScreen', startedAt: 0 }), ['reserveOnPc', 'close']);
    assert.deepEqual(actionsOf({ kind: 'stopped', step: 'readback', reason: 'dateMismatch', startedAt: 0 }), ['retryPrepare', 'close']);
    assert.deepEqual(actionsOf({ kind: 'stopped', step: 'readback', reason: 'blocked', startedAt: 0, reserved: true }), ['close']);
  });
  it('간편인증: 앱 이름을 알 때만 여는 단추, 인증서는 PC 전용', () => {
    assert.deepEqual(actionsOf({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크' }, startedAt: 0 }), ['openApp', 'resendAuth', 'stop']);
    assert.deepEqual(actionsOf({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '모르는 앱' }, startedAt: 0 }), ['resendAuth', 'stop']);
    assert.deepEqual(actionsOf({ kind: 'myTurn', step: 'login', auth: { method: 'cert' }, startedAt: 0 }), ['reserveOnPc', 'stop']);
  });
  it('단계·칩·경과·승인번호', () => {
    assert.equal(stepOf({ kind: 'inDoubt', tries: 1, startedAt: 0 }), 'issue');
    assert.equal(chipOf({ kind: 'inDoubt', tries: 1, startedAt: 0 }).label, '확인 중');
    assert.equal(elapsed(80_000), '1분 20초');
    assert.equal(elapsed(40_000), '40초');
    assert.equal(elapsed(3_900_000), '1시간 5분');
    assert.equal(groupApprovalNo('20261116-41000000-12345678'), '2026 1116 4100 0000 1234 5678');
  });
});
