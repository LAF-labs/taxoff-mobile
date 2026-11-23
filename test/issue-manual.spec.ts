import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { manualRecipientFromSearch } from '../src/issue.ts';

describe('발급 시트 직접 입력', () => {
  it('새 상호로 다시 시작하면 앞서 입력한 등록번호를 비운다', () => {
    const first = { name: '한강상회', bizNo: '234-56-78910' };
    const second = { ...first, ...manualRecipientFromSearch(' 새빛상회 ') };
    assert.deepEqual(second, { name: '새빛상회', bizNo: '' });
  });

  it('번호 검색은 등록번호만 채우고 빈 검색이나 짧은 번호는 둘 다 비운다', () => {
    assert.deepEqual(manualRecipientFromSearch(' 234 56 78910 '), { name: '', bizNo: '234-56-78910' });
    assert.deepEqual(manualRecipientFromSearch(' 234 '), { name: '', bizNo: '234' });
    assert.deepEqual(manualRecipientFromSearch(' 23 '), { name: '', bizNo: '' });
    assert.deepEqual(manualRecipientFromSearch('  '), { name: '', bizNo: '' });
  });
});
