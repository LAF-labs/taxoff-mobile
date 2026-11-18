// 계정에 연결된 기기(src/devices.ts, ADR-048 결정 1·6): 목록 읽기, 화면 줄, 정지 규칙, 이 폰 나가기.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_DESKTOPS, MAX_MOBILES } from '../vendor/sax-remote/src/index.ts';
import { DevicesError, devicesClient, devicesErrorText, devicesView, isStopped, leaveThisPhone, parseDevices, stopConfirm, type AccountDevice } from '../src/devices.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dev = (n: number, role: 'desktop' | 'mobile', over: Partial<AccountDevice> = {}): AccountDevice => ({
  deviceId: id(n), role, platform: role === 'desktop' ? 'darwin' : 'ios', name: '', state: 'active', registeredAt: n, deleteAfter: null, ...over,
});
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe('기기 목록 읽기', () => {
  it('서버 줄에서 쓰는 칸만 남기고 키는 버린다. 끊긴 기기는 뺀다', () => {
    const got = parseDevices({
      devices: [
        { deviceId: id(1), role: 'desktop', platform: 'darwin', name: '사무실 맥', state: 'active', registeredAt: 10, Sx: 'k', Vx: 'k', holdUntil: null, deleteAfter: null },
        { deviceId: id(2), role: 'mobile', platform: 'ios', name: ` ${'가'.repeat(60)} `, state: 'suspended', registeredAt: 20, deleteAfter: NOW + DAY },
        { deviceId: id(3), role: 'mobile', platform: 'android', name: '옛 폰', state: 'revoked', registeredAt: 5, deleteAfter: null },
      ],
    });
    assert.deepEqual(got, [
      { deviceId: id(1), role: 'desktop', platform: 'darwin', name: '사무실 맥', state: 'active', registeredAt: 10, deleteAfter: null },
      { deviceId: id(2), role: 'mobile', platform: 'ios', name: ` ${'가'.repeat(39)}`.trim(), state: 'suspended', registeredAt: 20, deleteAfter: NOW + DAY },
    ]);
    assert.ok(!JSON.stringify(got).includes('Sx'));
  });

  it('모양이 다른 줄이 하나라도 있으면 통째로 받지 않는다', () => {
    const ok = { deviceId: id(1), role: 'desktop', platform: 'darwin', name: 'a', state: 'active', registeredAt: 1, deleteAfter: null };
    for (const bad of [{ ...ok, deviceId: 'x' }, { ...ok, role: 'server' }, { ...ok, state: 'gone' }, { ...ok, registeredAt: '1' }, { ...ok, deleteAfter: 'soon' }, null]) {
      assert.equal(parseDevices({ devices: [ok, bad] }), null);
    }
    assert.equal(parseDevices({}), null);
    assert.equal(parseDevices(null), null);
    assert.equal(parseDevices({ devices: Array.from({ length: 65 }, () => ok) }), null);
    assert.deepEqual(parseDevices({ devices: [] }), []);
  });
});

describe('화면 줄과 정지 규칙', () => {
  it('이 폰과 이 폰이 연결한 PC가 맨 위. 이름이 없으면 종류로, 정지된 기기는 남은 날을 보인다', () => {
    const v = devicesView(
      [
        dev(1, 'desktop', { name: '집 PC', platform: 'win32' }),
        dev(2, 'desktop'),
        dev(3, 'mobile', { name: '직원 폰', platform: 'android', state: 'suspended', deleteAfter: NOW + 3 * DAY - 1000 }),
        dev(4, 'mobile', { name: '내 아이폰' }),
        dev(5, 'mobile', { platform: 'android', state: 'pending' }),
      ],
      { selfId: id(4), pairedPcId: id(2), now: NOW },
    );
    assert.deepEqual(v.pcs.map((r) => [r.label, r.sub, r.paired]), [['Mac', '쓰는 중 · 이 폰과 연결됨', true], ['집 PC', '쓰는 중', false]]);
    assert.deepEqual(v.phones.map((r) => [r.label, r.sub, r.self, r.attention]), [
      ['이 폰', '지금 쓰는 폰', true, false], ['직원 폰', '정지됨 · 3일 뒤 끊겨요', false, true], ['Android 폰', '연결하는 중', false, false],
    ]);
    assert.deepEqual([v.pcCount, v.phoneCount, v.pcFull, v.phoneFull], [`2대 · ${MAX_DESKTOPS}대까지`, `3대 · ${MAX_MOBILES}대까지`, false, true]);
  });

  it('이 폰은 정지 대상이 아니다. 이미 정지된 기기와 마지막 남은 PC는 정지할 수 없다', () => {
    const one = devicesView([dev(1, 'desktop'), dev(2, 'desktop', { state: 'suspended', deleteAfter: NOW - 1 }), dev(3, 'mobile'), dev(4, 'mobile')], { selfId: id(3), pairedPcId: id(1), now: NOW });
    assert.deepEqual(one.pcs.map((r) => [r.canStop, r.stopBlocked, r.sub]), [[false, 'last_pc', '쓰는 중 · 이 폰과 연결됨'], [false, 'already', '정지됨 · 곧 끊겨요']]);
    assert.deepEqual(one.phones.map((r) => [r.self, r.canStop, r.stopBlocked]), [[true, false, null], [false, true, null]]);
    const two = devicesView([dev(1, 'desktop'), dev(2, 'desktop'), dev(3, 'mobile')], { selfId: id(3), pairedPcId: null, now: NOW });
    assert.deepEqual(two.pcs.map((r) => r.canStop), [true, true]);
    // 연결 중인 PC는 활성 PC 수에 들지 않지만 정지는 할 수 있다(모르는 기기가 붙으려 할 때)
    const pend = devicesView([dev(1, 'desktop'), dev(2, 'desktop', { state: 'pending' })], { selfId: id(9), pairedPcId: id(1), now: NOW });
    assert.deepEqual(pend.pcs.map((r) => [r.canStop, r.stopBlocked]), [[false, 'last_pc'], [true, null]]);
  });

  it('확인 창과 오류 글은 값을 넣지 않고 무엇이 일어나는지 말한다', () => {
    assert.deepEqual(stopConfirm({ label: '직원 폰', role: 'mobile' }).title, '직원 폰 정지');
    assert.match(stopConfirm({ label: '집 PC', role: 'desktop' }).body, /이 PC는 바로 .* 7일 뒤/);
    for (const c of ['account.last_desktop', 'account.device_not_found', 'policy.rate_limited', 'account.device_suspended', 'devices.unreachable', 'zzz.unknown']) assert.ok(devicesErrorText(c).length > 5, c);
    assert.notEqual(devicesErrorText('account.last_desktop'), devicesErrorText('zzz.unknown'));
    // PC에는 정지 풀기·되돌리기가 없다: 문구가 그런 길을 안내하지 않는다
    assert.equal(devicesErrorText('account.device_suspended'), '이 폰은 다른 기기에서 정지했거나 연결을 끊었어요. 다시 쓰려면 PC와 다시 연결해 주세요.');
    assert.doesNotMatch(stopConfirm({ label: '집 PC', role: 'desktop' }).body, /풀 수|되돌릴/);
    assert.deepEqual([isStopped('account.device_suspended'), isStopped('account.unauthorized')], [true, false]);
  });
});

describe('계정 서비스 호출', () => {
  const server = (answers: Record<string, { status: number; body: unknown }>) => {
    const calls: Array<{ method: string; url: string; auth: string | undefined }> = [];
    const http = async (r: { method: string; url: string; headers: Record<string, string> }) => {
      calls.push({ method: r.method, url: r.url, auth: r.headers.Authorization });
      return answers[`${r.method} ${new URL(r.url).pathname}`] ?? { status: 404, body: { error: 'request.not_found' } };
    };
    const auth = async (htm: string, htu: string) => ({ Authorization: `DPoP t:${htm}:${htu}` });
    return { calls, c: devicesClient(http, 'https://account.example.test/', auth) };
  };
  const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof DevicesError ? e.code : 'other'));

  it('목록·나가기·정지를 기기 토큰으로 부른다(요청마다 그 주소의 증명)', async () => {
    const s = server({
      'GET /v1/devices': { status: 200, body: { devices: [dev(1, 'desktop')] } },
      'POST /v1/devices/self/leave': { status: 204, body: null },
      [`POST /v1/devices/${id(2)}/stop`]: { status: 202, body: { deleteAfter: NOW + 7 * DAY } },
    });
    assert.equal((await s.c.list()).length, 1);
    await s.c.leave();
    assert.deepEqual(await s.c.stop(id(2)), { deleteAfter: NOW + 7 * DAY });
    assert.deepEqual(s.calls.map((c) => `${c.method} ${c.url}`), [
      'GET https://account.example.test/v1/devices', 'POST https://account.example.test/v1/devices/self/leave', `POST https://account.example.test/v1/devices/${id(2)}/stop`,
    ]);
    assert.ok(s.calls.every((c) => c.auth === `DPoP t:${c.method}:${c.url}`));
  });

  it('서버 코드는 그대로 올리고, 닿지 못하면 unreachable, 모양이 다르면 bad_response. 기기 id가 아니면 부르지 않는다', async () => {
    const s = server({
      'GET /v1/devices': { status: 200, body: { devices: [{ deviceId: 'x' }] } },
      'POST /v1/devices/self/leave': { status: 409, body: { error: 'account.last_desktop' } },
      [`POST /v1/devices/${id(2)}/stop`]: { status: 202, body: {} },
      [`POST /v1/devices/${id(3)}/stop`]: { status: 429, body: { error: 'policy.rate_limited' } },
    });
    assert.equal(await code(s.c.list()), 'devices.bad_response');
    assert.equal(await code(s.c.leave()), 'account.last_desktop');
    assert.equal(await code(s.c.stop(id(2))), 'devices.bad_response');
    assert.equal(await code(s.c.stop(id(3))), 'policy.rate_limited');
    const before = s.calls.length;
    assert.equal(await code(s.c.stop('../self/leave')), 'request.param_rejected');
    assert.equal(s.calls.length, before);
    const down = devicesClient(async () => { throw new Error('offline'); }, 'https://a.example.test', async () => ({}));
    assert.equal(await code(down.list()), 'devices.unreachable');
    // 토큰을 받는 단계에서 서버가 거절하면(정지·끊긴 폰) 그 코드가 올라온다
    const stopped = devicesClient(async () => ({ status: 200, body: {} }), 'https://a.example.test', async () => { throw Object.assign(new Error('device-auth'), { status: 403, code: 'account.device_suspended' }); });
    assert.equal(await code(stopped.list()), 'account.device_suspended');
  });
});

describe('이 폰 나가기', () => {
  it('서버에 먼저 알리고 지운다. 서버에 닿지 못하거나 늦어도 지우고, 그때는 told가 false다', async () => {
    const order: string[] = [];
    const reset = async () => void order.push('reset');
    assert.deepEqual(await leaveThisPhone({ leave: async () => void order.push('leave'), reset }), { told: true });
    assert.deepEqual(order, ['leave', 'reset']);
    assert.deepEqual(await leaveThisPhone({ leave: async () => { throw new DevicesError(0, 'devices.unreachable'); }, reset }), { told: false });
    assert.deepEqual(await leaveThisPhone({ leave: async () => { throw new DevicesError(403, 'account.device_suspended'); }, reset }), { told: false });
    const slow = await leaveThisPhone({ leave: () => new Promise<void>(() => undefined), reset, timeoutMs: 20 });
    assert.deepEqual(slow, { told: false });
    assert.equal(order.filter((x) => x === 'reset').length, 4);
  });
});
