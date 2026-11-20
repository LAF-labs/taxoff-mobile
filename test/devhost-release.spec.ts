import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MobilePairing, allowDevLanHosts, b64, checkHtu, devLanHostsAllowed, encodeQr, fromB64, randomBytes, relayOrigin, relayUrl, signAcctClaim, verifyAcctClaim } from '../vendor/sax-remote/src/index.ts';
import { DEV_ACCOUNT_KEY, RELAY_ALLOWLIST, RELEASE_ACCOUNT_KEYS, resolveDevConfig } from '../src/devhost.ts';
import { ACCOUNT_KEY, mockPhone, pairOnce, pairWorld, testAcctClaim } from './remote-support.ts';

const PROD_ACCT_CLAIM_PUB = 'm505XiZjib3UhZGHVJKoS7FZ3FdVOJ0aS/XFpN4zPYQ=';
const DEV_TEST_SEED = Uint8Array.from(Buffer.from('372cad9361b4e90ef21b02dd9191bc93b1149bc015d73f783203f8a4806fa1ee', 'hex'));

const qrFor = (relayHost: string) =>
  encodeQr({ intent: 'pair', relayHost, roomId: randomBytes(16), desktopStatic: randomBytes(32), psk: randomBytes(32), exp: Math.floor(Date.now() / 1000) + 120 });

describe('릴리스 설정에서 *.local 릴레이 거절(#124)', () => {
  afterEach(() => allowDevLanHosts(false));

  it('릴리스 설정(__DEV__=false)에서 QR 릴레이 ws://x.local은 거절', () => {
    for (const isDevice of [true, false]) {
      const cfg = resolveDevConfig({ isDev: false, isDevice, envHost: 'evil.local:8787' });
      assert.deepEqual(cfg, { devLocal: false, devStack: false, devRelayHost: 'localhost:8787', allowLan: false, relayAllowlist: RELAY_ALLOWLIST, accountKeys: RELEASE_ACCOUNT_KEYS });
      allowDevLanHosts(cfg.allowLan);
      for (const host of ['x.local:8787', 'evil.local:8787', 'localhost:8787']) {
        const m = new MobilePairing({ keys: mockPhone().keys, accountKeys: [], relayAllowlist: cfg.relayAllowlist });
        assert.equal(m.scan(qrFor(host)), false, host);
        assert.equal(m.failure, 'relay_not_allowed', host);
      }
      assert.equal(devLanHostsAllowed(), false);
      assert.throws(() => relayUrl('x.local:8787', '/v1/rooms/x', true), /insecure only/);
      assert.throws(() => relayOrigin('x.local:8787', true), /insecure only/);
      assert.throws(() => checkHtu('http://x.local:8787/v1/device-tokens'), /bad htu/);
    }
  });

  it('시뮬레이터 개발 빌드: localhost만, mDNS 평문은 꺼짐', () => {
    const cfg = resolveDevConfig({ isDev: true, isDevice: false, envHost: 'mac.local:8787' });
    assert.equal(cfg.devLocal, true);
    assert.equal(cfg.allowLan, false);
    assert.deepEqual(cfg.relayAllowlist, [...RELAY_ALLOWLIST, 'localhost:8787']);
  });

  it('실기기 개발 빌드: 소문자 <이름>.local:포트만 개발 호스트, 그때만 mDNS 평문을 켠다', () => {
    const cfg = resolveDevConfig({ isDev: true, isDevice: true, envHost: 'mac-mini.local:8787' });
    assert.deepEqual(cfg, {
      devLocal: false, devStack: true, devRelayHost: 'mac-mini.local:8787', allowLan: true, relayAllowlist: [...RELAY_ALLOWLIST, 'mac-mini.local:8787'], accountKeys: [DEV_ACCOUNT_KEY],
    });
    allowDevLanHosts(cfg.allowLan);
    assert.equal(relayOrigin('mac-mini.local:8787', true), 'http://mac-mini.local:8787');
    assert.equal(checkHtu('http://mac-mini.local:8787/v1/x'), 'http://mac-mini.local:8787/v1/x');
    const m = new MobilePairing({ keys: mockPhone().keys, accountKeys: [], relayAllowlist: cfg.relayAllowlist });
    assert.equal(m.scan(qrFor('evil.local:8787')), false);
    assert.equal(m.failure, 'relay_not_allowed');
    for (const envHost of [undefined, '192.168.0.4:8787', 'evil.example:8787', 'Mac.local:8787', 'a.b.local:8787', 'mac.local']) {
      const c = resolveDevConfig({ isDev: true, isDevice: true, envHost });
      assert.equal(c.devStack, false, String(envHost));
      assert.equal(c.allowLan, false, String(envHost));
      assert.deepEqual(c.relayAllowlist, RELAY_ALLOWLIST, String(envHost));
    }
  });
});

describe('릴리스 빌드의 acct_claim 고정 키(2026-11-06 회전)', () => {
  const release = resolveDevConfig({ isDev: false, isDevice: true, envHost: undefined });
  const keys = () => release.accountKeys.map((k) => fromB64(k));

  it('릴리스 키는 운영 공개키 하나뿐이고 시험 키는 섞이지 않는다', () => {
    assert.deepEqual(release.accountKeys, [PROD_ACCT_CLAIM_PUB]);
    assert.ok(!release.accountKeys.includes(DEV_ACCOUNT_KEY));
    const k = fromB64(PROD_ACCT_CLAIM_PUB);
    assert.equal(k.length, 32);
    assert.equal(b64(k), PROD_ACCT_CLAIM_PUB, '표준 base64 정규형');
    for (const isDevice of [false, true]) {
      const d = resolveDevConfig({ isDev: true, isDevice, envHost: isDevice ? 'mac.local:8787' : undefined });
      assert.deepEqual(d.accountKeys, [DEV_ACCOUNT_KEY]);
    }
  });

  it('릴리스 키로 검증하면 시험 키·임의 키가 서명한 acct_claim은 서명 불일치로 거절', () => {
    const aik = randomBytes(32);
    const now = Date.now();
    const devSigned = signAcctClaim(DEV_TEST_SEED, { account_id: 'acc_dev', email: 'owner@example.test', aik_pub: b64(aik), iat: now, exp: now + 600_000 });
    assert.equal(verifyAcctClaim(devSigned, { accountKeys: [fromB64(DEV_ACCOUNT_KEY)], aikPub: aik }).ok, true);
    assert.deepEqual(verifyAcctClaim(devSigned, { accountKeys: keys(), aikPub: aik }), { ok: false, reason: 'signature' });
    assert.deepEqual(verifyAcctClaim(testAcctClaim(aik), { accountKeys: keys(), aikPub: aik }), { ok: false, reason: 'signature' });
  });

  it('릴리스 키를 넣은 폰은 운영 키로 서명되지 않은 PAIR_OK를 저장하지 않는다', async () => {
    const w = await pairWorld({ accountKeys: keys() });
    await assert.rejects(() => pairOnce(w));
    assert.equal(w.mob.failure, 'acct_claim_invalid');
    const ok = await pairWorld({ accountKeys: [...keys(), ACCOUNT_KEY.publicKey] });
    const { phone } = await pairOnce(ok);
    assert.equal(phone.identity.account.email, 'owner@example.test');
  });
});
