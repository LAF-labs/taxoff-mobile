import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { jobs, requests } from './fixtures/issue-submit.ts';

const stubs = new Set(['./session', './net/pcCopy', './queueStore', './entrust']);
const subject = new URL('../src/issueSubmit.ts', import.meta.url).href;
const fixture = new URL('./fixtures/issue-submit.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(spec, ctx, next) {
    return next(ctx.parentURL === subject && stubs.has(spec) ? fixture : spec, ctx);
  },
});
const { useIssueSubmit } = await import('../src/issueSubmit.ts');
hooks.deregister();

const draft = {
  cp: null, name: '한강상회', bizNo: '107-12-34567', item: '식자재', day: '2026-11-23',
  a: { supply: 10_000, tax: 1_000, total: 11_000 }, draftId: 'draft-1',
};

describe('발급 맡기기', () => {
  it('직접 입력한 거래처에는 발급 요청이나 진행 카드를 만들지 않는다', async () => {
    const result = await useIssueSubmit()(draft);
    assert.deepEqual({ result, jobs, requests }, { result: 'recipient-not-on-pc', jobs: [], requests: [] });
  });

  it('PC 목록에 없는 거래처에도 발급 요청이나 진행 카드를 만들지 않는다', async () => {
    const cp = { id: 'cp_missing', name: draft.name, bizNo: draft.bizNo, issued: 0 };
    const result = await useIssueSubmit()({ ...draft, cp });
    assert.deepEqual({ result, jobs, requests }, { result: 'recipient-not-on-pc', jobs: [], requests: [] });
  });

  it('PC 목록의 거래처에는 기존 발급 요청을 보낸다', async () => {
    const cp = { id: 'cp_known', name: '가나식자재', bizNo: '123-45-67890', issued: 0 };
    const result = await useIssueSubmit()({ ...draft, cp });
    assert.equal(result, 'submitted');
    assert.deepEqual(requests, [{ cp, supply: 10_000, total: 11_000, item: draft.item, draftId: draft.draftId }]);
    assert.deepEqual(jobs, []);
  });
});
