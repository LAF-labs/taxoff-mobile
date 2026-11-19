// PC 다시 붙기 시점(src/net/reconnect.ts): 망 바뀜 판단, 실패 뒤 늘려 가는 기다림과 지터.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failed, JITTER, netChanged, RETRY_FIRST_MS, retryDelay } from '../src/net/reconnect.ts';

const wifi = { type: 'wifi', reachable: true };
const lte = { type: 'cellular', reachable: true };
const none = { type: 'none', reachable: false };

describe('망 바뀜', () => {
  it('와이파이에서 LTE로, 끊겼다 이어지면 다시 붙는다', () => {
    assert.equal(netChanged(wifi, lte), true);
    assert.equal(netChanged(lte, wifi), true);
    assert.equal(netChanged(none, wifi), true);
    assert.equal(netChanged({ type: 'wifi', reachable: false }, wifi), true);
  });
  it('처음 받은 상태, 같은 망, 끊긴 쪽으로의 변화는 붙지 않는다', () => {
    assert.equal(netChanged(null, wifi), false);
    assert.equal(netChanged(wifi, wifi), false);
    assert.equal(netChanged(wifi, none), false);
    assert.equal(netChanged(wifi, { type: 'cellular', reachable: false }), false);
    // 닿는지 아직 모름(null)에서 닿음으로는 변화가 아니다(앱을 열 때 이미 붙는다)
    assert.equal(netChanged({ type: 'wifi', reachable: null }, wifi), false);
  });
});

describe('실패 뒤 기다림', () => {
  it('3초에서 두 배씩 늘려 최대 60초', () => {
    const mid = () => 0.5;
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map((n) => retryDelay(n, 60_000, mid)), [3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000]);
    assert.equal(RETRY_FIRST_MS, 3_000);
  });
  it('지터는 ±20% 안이고 최대를 넘지 않는다', () => {
    assert.equal(retryDelay(1, 60_000, () => 0), Math.round(3_000 * (1 - JITTER)));
    assert.ok(retryDelay(1, 60_000, () => 0.999) <= 3_000 * (1 + JITTER));
    assert.equal(retryDelay(9, 60_000, () => 0.999), 60_000);
    for (let i = 0; i < 200; i++) {
      const d = retryDelay(3, 60_000);
      assert.ok(d >= 12_000 * 0.8 && d <= 12_000 * 1.2, String(d));
    }
  });
  it('붙었거나 큐로 맡겼으면 실패가 아니다', () => {
    assert.deepEqual((['online', 'queued', 'unpaired', 'offline', 'stale', 'connecting'] as const).map(failed), [false, false, false, true, true, true]);
  });
});
