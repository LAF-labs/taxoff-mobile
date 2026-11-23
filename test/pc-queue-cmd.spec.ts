import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entrustNote } from '../src/net/pcWhy.ts';
import { cmdsToQueue, type PhoneCmd } from '../src/phoneCmd.ts';

const NOW = Date.UTC(2026, 10, 23, 3);
const cmd = (o: Partial<PhoneCmd> = {}): PhoneCmd => ({ cmdId: `c${Math.random()}`, req: { counterpartyRef: 'cp', supply: 1000, tax: 100, item: '물품', day: '2026-11-23' }, cpName: 'A상사', total: 1100, createdAt: NOW, ...o });

describe('PC가 꺼져 있을 때 맡긴 발급을 큐로', () => {
  it('PC에 닿지 않았고 큐에도 없는 것만 넣는다', () => {
    const fresh = cmd();
    const sent = cmd({ sentAt: NOW });
    const acked = cmd({ ack: 'accepted' });
    const queued = cmd({ queuedAt: NOW - 1000 });
    const old = cmd({ queuedAt: NOW - 25 * 3_600_000 });
    assert.deepEqual(cmdsToQueue([fresh, sent, acked, queued, old], 86_400_000, NOW).map((c) => c.cmdId), [fresh.cmdId, old.cmdId]);
  });
});

describe('맡긴 발급의 한 줄', () => {
  it('PC가 꺼져 있으면 켜지는 대로 발급하고, 연결이 풀렸으면 다시 연결하라고 한다', () => {
    assert.equal(entrustNote('online', 'A상사 세금계산서 1,100원'), null);
    assert.equal(entrustNote('offline', 'A상사 세금계산서 1,100원'), 'A상사 세금계산서 1,100원을 맡겼어요. PC가 켜지면 바로 발급해요');
    assert.equal(entrustNote('relink', 'A상사 세금계산서 1,100원'), 'A상사 세금계산서 1,100원을 이 폰에 두었어요. 다시 연결하면 바로 발급해요');
  });
});
