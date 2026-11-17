import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXPIRE_MS, applyAction, groupJobs, queueCounts, startAll, stateAt, type Job } from '../src/queue.ts';
import { findByBizNo, findDuplicate, recentCounterparties, searchCounterparties, splitAmount, type Counterparty } from '../src/issue.ts';

const now = 1_800_000_000_000;
const job = (id: string, state: Job['state'], ageH = 1): Job => ({ id, title: id, amount: 1000, createdAt: now - ageH * 3_600_000, state });

describe('밀린 일(P-13)', () => {
  it('시작 전인 일은 72시간이 지나면 만료', () => {
    assert.equal(stateAt(job('a', 'entrusted', 71), now), 'entrusted');
    assert.equal(stateAt(job('a', 'entrusted', 72), now), 'expired');
    assert.equal(stateAt(job('a', 'phoneWaiting', 80), now), 'expired');
    assert.equal(stateAt(job('a', 'running', 80), now), 'running');
    // PC가 가져가 시작 답을 기다리는 일은 만료되지 않는다
    assert.equal(stateAt(job('a', 'confirmStart', 100), now), 'confirmStart');
    assert.equal(EXPIRE_MS, 259_200_000);
  });
  it('사장님이 할 일부터 묶는다', () => {
    const g = groupJobs([job('e', 'entrusted'), job('c', 'confirmStart'), job('x', 'entrusted', 100), job('ap', 'approval')], now);
    assert.deepEqual(g.map((x) => x.state), ['confirmStart', 'approval', 'entrusted', 'expired']);
  });
  it('홈 건수: 승인 대기와 나머지(만료 제외)', () => {
    assert.deepEqual(queueCounts([job('a', 'approval'), job('b', 'entrusted'), job('c', 'entrusted', 90), job('d', 'running')], now), { approvals: 1, backlog: 2 });
  });
  it('취소·다시 맡기기·모두 시작', () => {
    const js = [job('a', 'entrusted'), job('b', 'entrusted', 90), job('c', 'confirmStart')];
    assert.deepEqual(applyAction(js, 'a', 'cancel', now).map((j) => j.id), ['b', 'c']);
    const r = applyAction(js, 'b', 'retry', now).find((j) => j.id === 'b')!;
    assert.equal(stateAt(r, now), 'entrusted');
    assert.equal(startAll(js, now).find((j) => j.id === 'c')!.state, 'running');
  });
});

describe('발급 작성(P-10)', () => {
  it('부가세 별도: 세액은 10% 버림', () => {
    assert.deepEqual(splitAmount(1_230_000, 'excl'), { supply: 1_230_000, tax: 123_000, total: 1_353_000 });
    assert.deepEqual(splitAmount(12_345, 'excl'), { supply: 12_345, tax: 1_234, total: 13_579 });
  });
  it('부가세 포함: 합계가 맞는 공급가액을 찾는다', () => {
    assert.deepEqual(splitAmount(1_353_000, 'incl'), { supply: 1_230_000, tax: 123_000, total: 1_353_000 });
    for (const n of [1, 11, 100, 13_579, 999_999]) {
      const a = splitAmount(n, 'incl');
      assert.equal(a.supply + a.tax, n);
    }
    assert.deepEqual(splitAmount(0, 'incl'), { supply: 0, tax: 0, total: 0 });
  });
  it('부가세 포함: 정확히 못 맞추는 합계는 세액 규칙을 지키고 아래로 맞춘다', () => {
    for (const n of [10, 21, 32, 43]) {
      const a = splitAmount(n, 'incl');
      assert.equal(a.inexact, true, `n=${n}`);
      assert.equal(a.tax, Math.floor(a.supply / 10), `n=${n}`);
      assert.equal(a.total, a.supply + a.tax, `n=${n}`);
      assert.equal(a.total, n - 1, `n=${n}`);
    }
    assert.deepEqual(splitAmount(10, 'incl'), { supply: 9, tax: 0, total: 9, inexact: true });
    assert.equal(splitAmount(1_353_000, 'incl').inexact, undefined);
  });
  const cps: Counterparty[] = [
    { id: '1', name: '가나식자재', bizNo: '123-45-67890', lastAt: 5, issued: 3 },
    { id: '2', name: '동네마트', bizNo: '220-81-12345', lastAt: 9, issued: 1 },
    { id: '3', name: '새거래처', bizNo: '101-01-00001', issued: 0 },
  ];
  it('최근 거래처와 찾기', () => {
    assert.deepEqual(recentCounterparties(cps).map((c) => c.id), ['2', '1']);
    assert.deepEqual(searchCounterparties(cps, '마트').map((c) => c.id), ['2']);
    assert.deepEqual(searchCounterparties(cps, '2208').map((c) => c.id), ['2']);
    assert.deepEqual(searchCounterparties(cps, ' '), []);
  });
  it('같은 사업자번호 거래처(하이픈 무시)', () => {
    assert.equal(findByBizNo(cps, '2208112345')?.id, '2');
    assert.equal(findByBizNo(cps, '220-81-1234'), null);
  });
  it('오늘 같은 곳 같은 금액이면 중복', () => {
    const t = [{ counterpartyId: '1', total: 1_353_000, at: 1 }];
    assert.ok(findDuplicate(t, '1', 1_353_000));
    assert.equal(findDuplicate(t, '1', 1_000), null);
  });
});
