import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jobTimers } from '../src/jobTimers.ts';
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
  it('간편인증 시간이 지나면 [다시 요청]이 기본', () => {
    const r: RunView = { kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크', deadline: 1000 }, startedAt: 0 };
    assert.deepEqual(actionsOf(r, 500), ['openApp', 'resendAuth', 'stop']);
    assert.deepEqual(actionsOf(r, 1000), ['resendAuth', 'stop']);
  });
  it('단계·칩·경과·승인번호', () => {
    assert.equal(stepOf({ kind: 'inDoubt', tries: 1, startedAt: 0 }), 'verify');
    assert.equal(stepOf({ kind: 'verify', startedAt: 0 }), 'verify');
    assert.equal(stepOf({ kind: 'running', step: 'issue', startedAt: 0 }), 'issue');
    assert.equal(chipOf({ kind: 'inDoubt', tries: 1, startedAt: 0 }).label, '확인 중');
    assert.equal(elapsed(80_000), '1분 20초');
    assert.equal(elapsed(40_000), '40초');
    assert.equal(elapsed(3_900_000), '1시간 5분');
    assert.equal(groupApprovalNo('20261116-41000000-12345678'), '2026 1116 4100 0000 1234 5678');
  });
});

describe('시연 타이머(일별)', () => {
  const clock = () => {
    let t = 0;
    let n = 0;
    const q = new Map<number, { at: number; f: () => void }>();
    return {
      set: (f: () => void, ms: number) => (q.set(++n, { at: t + ms, f }), n) as unknown as ReturnType<typeof setTimeout>,
      clear: (h: ReturnType<typeof setTimeout>) => void q.delete(h as unknown as number),
      run(ms: number) {
        t += ms;
        for (const [k, v] of [...q].sort((a, b) => a[1].at - b[1].at)) {
          if (v.at > t) continue;
          q.delete(k);
          v.f();
        }
      },
    };
  };
  it('같은 일의 흐름을 다시 시작하면 앞 흐름의 남은 단계는 돌지 않는다', () => {
    const c = clock();
    const tm = jobTimers(c.set, c.clear);
    const log: string[] = [];
    const drive = (tag: string) => {
      tm.clear('j');
      for (const [ms, s] of [[700, 'login'], [1400, 'readback'], [2100, 'approve']] as const) tm.at('j', ms, () => log.push(`${tag}:${s}`));
    };
    drive('a');
    c.run(800);
    drive('b');
    c.run(3000);
    assert.deepEqual(log, ['a:login', 'b:login', 'b:readback', 'b:approve']);
    assert.equal(tm.pending('j'), 0);
  });
  it('다른 일의 타이머는 건드리지 않고, 모두 지우기는 남김없이', () => {
    const c = clock();
    const tm = jobTimers(c.set, c.clear);
    const log: string[] = [];
    tm.at('x', 100, () => log.push('x'));
    tm.at('y', 100, () => log.push('y'));
    tm.clear('x');
    c.run(200);
    assert.deepEqual(log, ['y']);
    tm.at('x', 100, () => log.push('x2'));
    tm.clearAll();
    c.run(200);
    assert.deepEqual(log, ['y']);
  });
});

describe('간편인증 시트 단계', async () => {
  const { stepsOf, toId, stepOk, draftOf } = await import('../src/simpleAuth.ts');
  it('PASS면 통신사가 끼고, 모든 단계가 맞아야 보낸다', () => {
    const d = { ...draftOf(null), provider: 'kakao', name: '홍길동', birth: '1990-01-01', phone: '010-1234-5678' };
    assert.deepEqual(stepsOf(d), ['app', 'name', 'birth', 'phone']);
    assert.deepEqual(toId(d), { provider: 'kakao', name: '홍길동', birth: '19900101', phone: '01012345678' });
    assert.deepEqual(stepsOf({ ...d, provider: 'pass' }), ['app', 'carrier', 'name', 'birth', 'phone']);
    assert.equal(toId({ ...d, provider: 'pass' }), null);
    assert.deepEqual(toId({ ...d, provider: 'pass', carrier: 'ka' }), { provider: 'pass', carrier: 'ka', name: '홍길동', birth: '19900101', phone: '01012345678' });
    assert.equal(stepOk('birth', { ...d, birth: '1990-13-01' }), false);
  });
});
