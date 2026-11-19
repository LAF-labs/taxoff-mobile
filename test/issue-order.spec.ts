import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderedCounterparties, type Counterparty } from '../src/issue.ts';

const DAY = 86_400_000;
const at = (d: number) => Date.parse('2026-11-19T03:00:00Z') - d * DAY;
const cp = (id: string, issued: number, lastAt?: number): Counterparty => ({ id, name: id, bizNo: '', issued, lastAt });

describe('발급 시트 거래처 순서', () => {
  it('최근 발급이 앞, 같은 날이면 자주 발급한 곳, 그다음 받은 순서', () => {
    const got = orderedCounterparties([cp('old', 30, at(20)), cp('none-a', 0), cp('today-few', 1, at(0)), cp('today-many', 9, at(0)), cp('none-b', 0), cp('mid', 2, at(3))]);
    assert.deepEqual(got.map((c) => c.id), ['today-many', 'today-few', 'mid', 'old', 'none-a', 'none-b']);
  });
  it('PC 사본처럼 건수가 같으면 PC가 보낸 순서를 지킨다', () => {
    const got = orderedCounterparties([cp('b', 1, at(2)), cp('a', 1, at(2)), cp('c', 0)]);
    assert.deepEqual(got.map((c) => c.id), ['b', 'a', 'c']);
  });
});
