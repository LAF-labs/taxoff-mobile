import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inexactNote, splitAmount } from '../src/issue.ts';

describe('부가세 포함 합계를 정확히 맞출 수 없을 때', () => {
  it('맞춘 합계와 함께 알린다', () => {
    assert.equal(inexactNote(110_010, splitAmount(110_010, 'incl')), '합계 110,010원은 정확히 맞출 수 없어 110,009원으로 했어요');
  });
  it('정확히 맞으면, 별도이면, 금액이 없으면 알리지 않는다', () => {
    assert.equal(inexactNote(110_000, splitAmount(110_000, 'incl')), null);
    assert.equal(inexactNote(110_010, splitAmount(110_010, 'excl')), null);
    assert.equal(inexactNote(0, splitAmount(0, 'incl')), null);
  });
});
