import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forgetPushToken, pushClient, PushError } from '../src/notify/pushApi.ts';
import { apnsToken, askDue, latestEntrusted, newGates, pushPlan, pushPlatform, tapKindOf, tokenHash, wakeKindOf } from '../src/notify/wake.ts';
import type { Job } from '../src/queue.ts';

const TOK = 'ab'.repeat(32);
const push = (payload: unknown) => ({ request: { trigger: { type: 'push', payload }, content: { data: {} } } });

describe('푸시 깨우기: 종류 읽기', () => {
  it('loc-key로 approve와 update를 가른다', () => {
    assert.equal(wakeKindOf(push({ aps: { alert: { 'loc-key': 'SAX_WAKE_APPROVE' }, sound: 'default' } })), 'approve');
    assert.equal(wakeKindOf(push({ aps: { alert: { 'loc-key': 'SAX_WAKE_UPDATE' } } })), 'update');
  });
  it('우리 키가 아니거나 로컬 알림이면 null', () => {
    assert.equal(wakeKindOf(push({ aps: { alert: { 'loc-key': 'OTHER' } } })), null);
    assert.equal(wakeKindOf(push({ aps: { alert: 'hi' } })), null);
    assert.equal(wakeKindOf({ request: { trigger: { type: 'date' }, content: { data: { open: 'money' } } } }), null);
    assert.equal(wakeKindOf({ request: { trigger: null, content: { data: { t: 'wake' } } } }), null);
    assert.equal(wakeKindOf(null), null);
  });
  it('Android 모양(data t=wake)도 읽는다', () => {
    assert.equal(wakeKindOf({ request: { trigger: { type: 'push', remoteMessage: { data: { t: 'wake', k: 'approve' } } } } }), 'approve');
    assert.equal(wakeKindOf({ request: { trigger: { type: 'push', remoteMessage: { data: { t: 'wake' } } } } }), 'update');
  });
});

describe('푸시 깨우기: 토큰', () => {
  it('개발 빌드는 apns_dev, 릴리스는 apns, 환경 값이 이긴다', () => {
    assert.equal(pushPlatform(true), 'apns_dev');
    assert.equal(pushPlatform(false), 'apns');
    assert.equal(pushPlatform(false, 'development'), 'apns_dev');
    assert.equal(pushPlatform(true, 'production'), 'apns');
    assert.equal(pushPlatform(true, 'nonsense'), 'apns_dev');
  });
  it('APNs 토큰 모양: 소문자 hex 64~200자', () => {
    assert.equal(apnsToken(TOK.toUpperCase()), TOK);
    assert.equal(apnsToken('ab'.repeat(31)), null);
    assert.equal(apnsToken('zz'.repeat(32)), null);
    assert.equal(apnsToken(42), null);
  });
  it('지문은 토큰과 플랫폼이 같을 때만 같다', () => {
    assert.equal(tokenHash('apns', TOK), tokenHash('apns', TOK));
    assert.notEqual(tokenHash('apns', TOK), tokenHash('apns_dev', TOK));
    assert.notEqual(tokenHash('apns', TOK), tokenHash('apns', 'cd'.repeat(32)));
    assert.match(tokenHash('apns', TOK), /^[0-9a-f]{64}$/);
    assert.ok(!tokenHash('apns', TOK).includes(TOK));
  });
});

describe('푸시 깨우기: 올리기와 지우기', () => {
  const h = tokenHash('apns', TOK);
  const base = { paired: true, perm: 'granted' as const, wakeOn: true, hash: h, last: null };
  it('연결, 허용, 스위치가 다 켜졌고 토큰이 바뀌었으면 올린다', () => {
    assert.equal(pushPlan(base), 'put');
    assert.equal(pushPlan({ ...base, last: 'old' }), 'put');
  });
  it('같은 토큰이면 다시 올리지 않는다', () => assert.equal(pushPlan({ ...base, last: h }), 'none'));
  it('토큰을 아직 못 받았으면 기다린다', () => assert.equal(pushPlan({ ...base, hash: null }), 'none'));
  it('스위치를 끄거나 OS에서 끄면 올린 것을 지운다', () => {
    assert.equal(pushPlan({ ...base, wakeOn: false, hash: null, last: h }), 'delete');
    assert.equal(pushPlan({ ...base, perm: 'denied', hash: null, last: h }), 'delete');
    assert.equal(pushPlan({ ...base, paired: false, hash: null, last: h }), 'delete');
  });
  it('올린 적이 없으면 지울 것도 없다', () => assert.equal(pushPlan({ ...base, wakeOn: false, hash: null }), 'none'));
});

describe('푸시 깨우기: 허용 묻기', () => {
  it('맡긴 뒤 한 번, OS가 아직 안 정했을 때만', () => {
    assert.equal(askDue({ entrusted: 1, asked: false, perm: 'undetermined' }), true);
    assert.equal(askDue({ entrusted: 0, asked: false, perm: 'undetermined' }), false);
    assert.equal(askDue({ entrusted: 1, asked: true, perm: 'undetermined' }), false);
    assert.equal(askDue({ entrusted: 1, asked: false, perm: 'denied' }), false);
    assert.equal(askDue({ entrusted: 1, asked: false, perm: 'granted' }), false);
    assert.equal(askDue({ entrusted: 1, asked: false, perm: null }), false);
  });
});

describe('푸시 깨우기: 승인 시트가 안 오면', () => {
  const j = (id: string, createdAt: number): Job => ({ id, title: 't', amount: 1, createdAt, state: 'running' });
  it('폰이 맡긴 일 가운데 가장 최근 것', () => {
    assert.equal(latestEntrusted([j('cmd-a', 1), j('local-1', 9), j('cmd-b', 5)])?.id, 'cmd-b');
    assert.equal(latestEntrusted([j('local-1', 9)]), null);
  });
});

describe('푸시 토큰 서버 API', () => {
  type Req = { method: string; url: string; headers: Record<string, string>; body?: string };
  const calls: Req[] = [];
  const http = (status: number) => async (r: Req) => {
    calls.push(r);
    return { status, body: null };
  };
  const auth = async (htm: string, htu: string) => ({ Authorization: 'DPoP t', DPoP: `${htm} ${htu}` });

  it('PUT: 본문은 platform과 token, DPoP는 PUT과 그 주소', async () => {
    calls.length = 0;
    await pushClient(http(204), 'https://tax.laf-co.com/', auth).put('apns_dev', TOK);
    const r = calls[0]!;
    assert.equal(r.method, 'PUT');
    assert.equal(r.url, 'https://tax.laf-co.com/v1/push-token');
    assert.equal(r.headers.DPoP, 'PUT https://tax.laf-co.com/v1/push-token');
    assert.deepEqual(JSON.parse(r.body!), { platform: 'apns_dev', token: TOK });
  });
  it('PUT이 204가 아니면 실패', async () => {
    await assert.rejects(pushClient(http(401), 'https://x', auth).put('apns', TOK), (e) => e instanceof PushError && e.status === 401);
  });
  it('DELETE: 204와 404는 지워진 것으로 본다', async () => {
    calls.length = 0;
    await pushClient(http(204), 'https://x', auth).remove();
    await pushClient(http(404), 'https://x', auth).remove();
    assert.equal(calls[0]!.method, 'DELETE');
    assert.equal(calls[0]!.headers.DPoP, 'DELETE https://x/v1/push-token');
    await assert.rejects(pushClient(http(500), 'https://x', auth).remove());
  });
  it('나갈 때 토큰 지우기는 실패하거나 늦어도 넘어간다', async () => {
    assert.equal(await forgetPushToken(async () => {}), true);
    assert.equal(await forgetPushToken(async () => Promise.reject(new Error('x'))), false);
    assert.equal(await forgetPushToken(() => new Promise(() => {}), 20), false);
  });
});

describe('앱이 뒤에 있을 때 받은 승인 요청', () => {
  const gate = (reqId: string, exp: number) => ({ reqId, exp }) as never;
  const j = (id: string, g?: unknown, state: Job['state'] = 'approval'): Job => ({ id, title: 't', amount: 1, createdAt: 0, state, gate: g as never });
  it('폰이 맡긴 일의 새 승인 요청만, 마감 전, 한 번', () => {
    const jobs = [j('cmd-a', gate('r1', 100)), j('cmd-b', gate('r2', 10)), j('local-1', gate('r3', 100)), j('cmd-c', gate('r4', 100), 'running'), j('cmd-d')];
    assert.deepEqual(newGates(jobs, new Set(), 50).map((x) => x.id), ['cmd-a']);
    assert.deepEqual(newGates(jobs, new Set(['r1']), 50), []);
  });
  it('앱이 만든 승인 알림을 누르면 approve, 진행 알림은 아님', () => {
    const local = (data: unknown) => ({ request: { trigger: { type: 'date' }, content: { data } } });
    assert.equal(tapKindOf(local({ open: 'approve', jobId: 'cmd-a' })), 'approve');
    assert.equal(tapKindOf(local({ open: 'run', jobId: 'cmd-a' })), null);
    assert.equal(tapKindOf(push({ aps: { alert: { 'loc-key': 'SAX_WAKE_UPDATE' } } })), 'update');
  });
});
