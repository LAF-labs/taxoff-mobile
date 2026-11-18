// PC 연결 원인 코드(src/net/pcWhy.ts): "PC 꺼짐"으로 보일 때 어느 단계에서 왜 멈췄는지 남기고, 사람이 읽는 한 줄을 고른다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PC_LOG_MAX, causeOf, pcWhyText, pushWhy, statusWhileSyncing, whyCode } from '../src/net/pcWhy.ts';

describe('원인 코드', () => {
  it('기기 토큰 거절은 계정 서비스 코드와 상태를 남긴다', () => {
    const e = Object.assign(new Error('device-auth: 404 account.device_not_found'), { status: 404, code: 'account.device_not_found' });
    assert.equal(causeOf(e), 'account.device_not_found.404');
    assert.equal(whyCode('join', causeOf(e)), 'join:account.device_not_found.404');
  });
  it('릴레이·큐 오류 문자열을 코드로 바꾼다', () => {
    assert.equal(causeOf(new Error('relay: rejected')), 'relay.rejected');
    assert.equal(causeOf(new Error('relay: join timeout')), 'relay.join_timeout');
    assert.equal(causeOf(new Error('queue: bundle 404')), 'queue.bundle_404');
    assert.equal(causeOf(new TypeError('Network request failed')), 'net.unreachable');
    assert.equal(causeOf('뭔가'), 'unknown');
  });
  it('값이 섞일 수 있는 긴 문자열은 남기지 않는다', () => {
    assert.equal(causeOf(new Error('https://rooms.tax.laf-co.com/v1/mailboxes/abc?x=1 failed with token sxd1.xxxxx')), 'unknown');
    assert.equal(whyCode('peer', 'a b c'), 'peer:unknown');
  });
});

describe('연결 기록', () => {
  it('같은 원인이 이어지면 시각만 바꾸고, 최근 20개만 둔다', () => {
    let log = pushWhy(undefined, { code: 'peer:timeout', at: 1 });
    log = pushWhy(log, { code: 'peer:timeout', at: 2 });
    assert.deepEqual(log, [{ code: 'peer:timeout', at: 2 }]);
    for (let i = 0; i < 30; i++) log = pushWhy(log, { code: i % 2 ? 'peer:timeout' : 'join:relay.rejected', at: 10 + i });
    assert.equal(log.length, PC_LOG_MAX);
    assert.equal(log[log.length - 1]!.at, 39);
  });
});

describe('사람이 읽는 한 줄', () => {
  it('PC가 우편함에 없으면 PC 앱·로그인을 확인하라고 한다', () => {
    assert.match(pcWhyText('peer:timeout')!, /PC에서 앱이 켜져 있고 로그인돼/);
  });
  it('끊긴 폰은 다시 연결하라고 한다', () => {
    assert.match(pcWhyText('join:account.device_not_found.404')!, /다시 연결/);
    assert.match(pcWhyText('queue:account.device_suspended.403')!, /다시 연결/);
  });
  it('인터넷 문제는 인터넷을 말한다', () => {
    assert.match(pcWhyText('join:net.unreachable')!, /인터넷/);
  });
  it('개발 용어를 쓰지 않는다', () => {
    for (const c of ['join:relay.rejected', 'peer:timeout', 'session:no_answer', 'live:relay.closed', 'stale:no_bundle', 'queue:queue.bundle_500', 'join:account.unauthorized.401']) {
      const t = pcWhyText(c)!;
      assert.ok(t, c);
      assert.doesNotMatch(t, /relay|queue|token|Noise|우편함|릴레이|토큰|세션/i, c);
    }
    assert.equal(pcWhyText(null), null);
  });
});

describe('다시 동기화하는 동안', () => {
  it('켜짐이면 그대로 두고(깜빡이지 않게), 아니면 찾는 중', () => {
    assert.equal(statusWhileSyncing('online'), 'online');
    assert.equal(statusWhileSyncing('offline'), 'connecting');
    assert.equal(statusWhileSyncing('queued'), 'connecting');
  });
});
