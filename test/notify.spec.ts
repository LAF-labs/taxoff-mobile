import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moneyReminder, nextMorning, runEvents } from '../src/notify/events.ts';
import type { Job } from '../src/queue.ts';
import type { RunView } from '../src/run.ts';

const job = (id: string, run?: RunView): Job => ({ id, title: '가나식자재 세금계산서', amount: 1_353_000, createdAt: 0, state: 'running', run });
const running: RunView = { kind: 'running', step: 'login', startedAt: 0 };
const done: RunView = {
  kind: 'done',
  startedAt: 0,
  result: { approvalNo: '20261119-41000000-12345678', total: 1_353_000, counterpart: '가나식자재', emailed: true, doc: { name: 'a.pdf', issuedOn: '2026-11-19' } } as never,
};

describe('알림 거리', () => {
  it('진행 중에서 발급됨으로 바뀌면 한 번만 알린다', () => {
    const a = [job('1', running)];
    const b = [job('1', done)];
    const ev = runEvents(a, b);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]?.kind, 'done');
    assert.equal(runEvents(b, b).length, 0);
  });

  it('처음 보는 일이 이미 끝난 상태로 들어오면 알리지 않는다(지난 일)', () => {
    assert.equal(runEvents([], [job('1', done)]).length, 0);
  });

  it('진행 중으로 가는 것은 알리지 않는다', () => {
    assert.equal(runEvents([job('1')], [job('1', running)]).length, 0);
  });

  it('내 차례: 간편인증은 폰에서 승인, 인증서는 비밀번호를 기다린다고 쓴다(PC로 보내지 않는다)', () => {
    const simple = runEvents([job('1', running)], [job('1', { kind: 'myTurn', step: 'login', auth: { method: 'simple', app: 'kakao' }, startedAt: 0 })]);
    assert.match(simple[0]?.line ?? '', /간편인증/);
    const cert = runEvents([job('1', running)], [job('1', { kind: 'myTurn', step: 'login', auth: { method: 'cert' }, startedAt: 0 })]);
    assert.match(cert[0]?.line ?? '', /비밀번호를 기다려요/);
    assert.doesNotMatch(cert[0]?.line ?? '', /PC/);
  });

  it('OS 알림 글(잠금 화면)에는 거래처·금액이 없다', () => {
    const kinds: RunView[] = [
      done,
      { kind: 'stopped', step: 'readback', reason: 'inputMismatch', startedAt: 0 },
      { kind: 'verify', startedAt: 0 },
      { kind: 'refused', reason: 'pc_busy', startedAt: 0 },
      { kind: 'myTurn', step: 'login', auth: { method: 'simple', app: 'kakao' }, startedAt: 0 },
    ];
    for (const r of kinds) {
      const [e] = runEvents([job('1', running)], [job('1', r)]);
      assert.ok(e);
      const os = `${e.os.title} ${e.os.body}`;
      assert.doesNotMatch(os, /가나식자재|1,353,000|원/);
    }
  });

  it('돈 아침 알림: 건수만, 없으면 null', () => {
    assert.equal(moneyReminder({ recvOverdue: 0, recvSoon: 0, payOverdue: 0, paySoon: 0 }), null);
    const m = moneyReminder({ recvOverdue: 2, recvSoon: 1, payOverdue: 0, paySoon: 3 });
    assert.equal(m?.title, '기한 지난 돈이 있어요');
    assert.match(m?.body ?? '', /기한 지난 받을 돈 2건, 7일 안에 받을 돈 1건 외 1가지/);
    assert.equal(moneyReminder({ recvOverdue: 0, recvSoon: 1, payOverdue: 0, paySoon: 0 })?.title, '이번 주 오갈 돈이 있어요');
  });

  it('다음 오전 9시: 9시 전이면 오늘, 지났으면 내일', () => {
    const before = new Date(2026, 10, 19, 8, 30).getTime();
    const after = new Date(2026, 10, 19, 9, 0).getTime();
    assert.equal(nextMorning(before), new Date(2026, 10, 19, 9, 0).getTime());
    assert.equal(nextMorning(after), new Date(2026, 10, 20, 9, 0).getTime());
  });
});
