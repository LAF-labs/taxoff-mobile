import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatDataFor, chatOwnerOf, chatWrapOf } from '../src/offline/chatKey.ts';

const pair = (o: { pairId?: string; email?: string; pc?: string } = {}) => ({ pairId: o.pairId ?? 'p1', accountEmail: o.email ?? 'boss@example.com', desktopDeviceId: o.pc ?? 'pc-A' });

describe('폰 대화 기록의 주인', () => {
  it('같은 계정과 같은 PC면 다시 연결해 pairId가 바뀌어도 기록이 이어진다', () => {
    const saved = chatWrapOf(pair({ pairId: 'p1' }), '{"msgs":[1,2,3]}');
    assert.equal(chatDataFor(saved, pair({ pairId: 'p2' })), '{"msgs":[1,2,3]}');
  });
  it('이메일의 대소문자와 앞뒤 공백은 같은 계정으로 본다', () => {
    const saved = chatWrapOf(pair({ email: 'Boss@Example.com ' }), 'x');
    assert.equal(chatDataFor(saved, pair({ pairId: 'p9', email: 'boss@example.com' })), 'x');
  });
  it('다른 PC와 연결하면 옛 기록을 쓰지 않는다', () => {
    const saved = chatWrapOf(pair(), 'x');
    assert.equal(chatDataFor(saved, pair({ pairId: 'p2', pc: 'pc-B' })), null);
  });
  it('다른 계정으로 연결하면 옛 기록을 쓰지 않는다', () => {
    const saved = chatWrapOf(pair(), 'x');
    assert.equal(chatDataFor(saved, pair({ pairId: 'p2', email: 'other@example.com' })), null);
  });
  it('주인이 없던 예전 파일은 같은 연결(pairId)일 때만 쓰고, 다시 쓰면 주인이 붙는다', () => {
    const legacy = { pairId: 'p1', data: 'old' };
    assert.equal(chatDataFor(legacy, pair({ pairId: 'p1' })), 'old');
    assert.equal(chatDataFor(legacy, pair({ pairId: 'p2' })), null);
    const rewritten = chatWrapOf(pair({ pairId: 'p1' }), 'old2');
    assert.equal(rewritten.owner, chatOwnerOf(pair()));
    assert.equal(chatDataFor(rewritten, pair({ pairId: 'p3' })), 'old2');
  });
  it('기록이 문자열이 아니면 쓰지 않는다', () => {
    assert.equal(chatDataFor({ owner: chatOwnerOf(pair()), data: 5 }, pair()), null);
  });
});
