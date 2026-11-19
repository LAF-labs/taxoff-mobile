import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertLine, dueLine, dueSoon, shortWon, sortOpen, storeable, unsureLine, type CashFlowMonth, type MoneySnapshot, type ReceivableView } from '../src/money.ts';

const NB = ' ';
const rv = (o: Partial<ReceivableView>): ReceivableView => ({
  id: 'r', counterpartyId: null, cpName: '가나식자재', cpBizNo: '123-45-67890', item: null, approvalTail: '5678', writtenOn: '2026-11-02', total: 1000, received: 0, remaining: 1000,
  dueOn: null, promisedOn: null, dueIn: null, overdue: false, status: 'unpaid', via: null, offAccount: null, sources: ['hometax'], excludedReason: null, ...o,
});

describe('돈 탭 표기(11 §3.4·§3.5)', () => {
  it('억 넘으면 줄이고 그 아래는 원 단위 그대로', () => {
    assert.equal(shortWon(12_340_000), '12,340,000원');
    assert.equal(shortWon(123_456_789), `1억${NB}2,345만원`);
    assert.equal(shortWon(200_000_000), '2억원');
    assert.equal(shortWon(-150_000_000), `−1억${NB}5,000만원`);
  });
  it('알림 문구는 §3.5 초안 그대로', () => {
    assert.equal(alertLine({ id: 'a', kind: 'shortfall', gap: 1_200_000 }), '다음 30일에 낼 돈이 통장 잔액과 들어올 돈보다 1,200,000원 많아요');
    assert.equal(alertLine({ id: 'b', kind: 'slowdown', counterpartyKey: 'k', cpName: 'A상사', priorDays: 32, recentDays: 51 }), 'A상사 입금이 평소보다 늦어지고 있어요(평균 32일 → 51일)');
    assert.equal(alertLine({ id: 'c', kind: 'concentration', counterpartyKey: 'k', cpName: 'A상사', share: 0.62 }), '지난 3개월 매출의 62%가 A상사예요');
  });
  it('확인 못 함은 0이 아니라 이유 한 줄', () => {
    const m = { hasAccounts: true, complete: false, missing: [{ accountId: 'x', last4: '1234', bank: '국민', coverTo: '2026-11-05' }] } as CashFlowMonth;
    assert.equal(unsureLine(m, '2026-11-17'), `확인하지 못했어요. 국민${NB}1234 계좌 거래내역이 7일 넘게 오래됐어요`);
    assert.equal(unsureLine({ ...m, complete: true }, '2026-11-17'), null);
  });
  it('순서·7일 안·기한 줄', () => {
    const list = [rv({ id: 'a', dueIn: 5 }), rv({ id: 'b', dueIn: -12, overdue: true }), rv({ id: 'c', status: 'unknown' }), rv({ id: 'd' }), rv({ id: 'e', status: 'received' })];
    assert.deepEqual(sortOpen(list).map((v) => v.id), ['b', 'a', 'd', 'c']);
    assert.deepEqual(dueSoon(list), { count: 1, total: 1000 });
    assert.equal(dueLine(list[1]!, 'recv'), `기한${NB}12일${NB}지남`);
  });
  it('보관 전에 사업자번호·승인번호 끝·계좌 번호를 지운다', () => {
    const snap = {
      at: 0, accounts: 1, summary: {} as never, receivables: [rv({})], payables: [rv({})],
      cashflow: { alerts: [], month: { missing: [{ accountId: 'a1', last4: '1234', bank: '국민', coverTo: null }] } as never, snapshot: { balance: { total: 1, partial: false, accounts: [{ accountId: 'a1', last4: '1234', bank: '국민', balance: 1, day: null }] } } as never },
    } as MoneySnapshot;
    const s = JSON.stringify(storeable(snap));
    assert.doesNotMatch(s, /123-45-67890|1234|a1|5678/);
    assert.match(s, /가나식자재/);
  });
});
