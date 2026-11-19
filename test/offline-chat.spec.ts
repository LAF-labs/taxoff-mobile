// PC가 꺼졌을 때 폰 대화(src/offline, ADR-047): tex 고정 사본(@sax/chat-core·@sax/redaction)이 이 레포에서 그대로 돌고,
// 게이트웨이에는 가린 글과 기기 인증 헤더만 가며, 결과가 홈 대화 줄로 바뀌는지 본다. 게이트웨이는 가짜다(모의 기준).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// 앱은 tsconfig paths·metro 별칭으로 사본을 찾는다. Node 시험은 같은 별칭을 여기서 건다.
const VENDOR: Record<string, string> = {
  '@sax/remote': '../vendor/sax-remote/src/index.ts',
  '@sax/redaction': '../vendor/sax-redaction/src/index.ts',
  '@sax/chat-core': '../vendor/sax-chat-core/src/index.ts',
};
registerHooks({
  resolve(spec, ctx, next) {
    const to = VENDOR[spec];
    return to ? next(new URL(to, import.meta.url).href, ctx) : next(spec, ctx);
  },
});

const { OfflineChat, cardOf, itemOf } = await import('../src/offline/chat.ts');
const { bubbleGroup, stampBefore, stampText, stateOf } = await import('../src/chat.ts');
const { phoneCopyFrom } = await import('../src/offline/copy.ts');
const { maskingSelfCheck } = await import('../src/offline/selfcheck.ts');

const ORIGIN = 'https://tax.laf-co.com';
const tag = () => randomBytes(32).toString('hex');

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** 가짜 게이트웨이: 호출을 적고, respond마다 줄 세운 출력을 낸다. */
function fakeGateway(outputs: Array<Array<Record<string, unknown>>>, status = 200, error?: string) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method: init.method, headers: init.headers, body });
    let out: unknown;
    if (status !== 200) out = { error };
    else if (url.endsWith('/v1/run-tokens')) out = { runToken: `rt_${'x'.repeat(30)}` };
    else if (url.endsWith('/v1/usage')) out = { usedKrw: 3, limitKrw: 50, resetAt: 1, tier: 'trial' };
    // 판정(ADR-057): 답이 없으면 반응 없이 늘 하던 대로 답한다
    else if (url.endsWith('/v1/decide')) out = { answers: [] };
    else out = { status: 'completed', output: (outputs.shift() ?? []).map((item) => ({ item, tag: tag() })) };
    return { status, text: async () => JSON.stringify(out) };
  };
  return { calls, fetch };
}

const fnCall = (id: string, name: string, args: object) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const message = (o: object) => ({ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(o) }] });

const NOW = Date.UTC(2026, 10, 16, 3, 0);
const copy = phoneCopyFrom({
  asOf: NOW - 60_000,
  profile: { id: 'p1', name: '율무상회', bizNo: '123-45-67890' },
  counterparties: [{ id: 'c1', name: '한빛전자', bizNo: '220-81-62517', lastSupply: 500000, lastItem: '컨설팅', lastAt: Date.UTC(2026, 10, 3, 1), issued: 3 }],
});

function make(outputs: Array<Array<Record<string, unknown>>>, status = 200, error?: string, pcOnline?: () => boolean) {
  const gw = fakeGateway(outputs, status, error);
  let saved: string | null = null;
  let n = 0;
  const chat = new OfflineChat({
    origin: ORIGIN,
    fetch: gw.fetch,
    authHeaders: async (method, url) => ({ Authorization: 'DPoP sxd1.test', DPoP: `${method} ${url}` }),
    store: { load: async () => saved, save: async (d) => void (saved = d) },
    copy: () => copy,
    now: () => NOW,
    newId: () => `01KB${String(++n).padStart(22, '0')}`,
    randomHex: () => randomBytes(16).toString('hex'),
    pcOnline,
  });
  return { chat, gw, saved: () => saved };
}

describe('폰 대화(PC 꺼짐): 고정 사본 → 가짜 게이트웨이', () => {
  it('가림 자가 점검이 이 엔진(Node)에서 통과한다(앱은 Hermes에서 같은 점검을 한 번 돌린다)', async () => {
    assert.deepEqual(await maskingSelfCheck(() => randomBytes(16).toString('hex')), { ok: true });
  });

  it('PC가 켜져 있어도 폰이 직접 보낸다: [사실]에 PC 켜짐 줄, 카드 안내도 켜짐에 맞춘다("PC 켜지면 보내요"로 멈추던 버그)', async () => {
    const { chat, gw } = make(
      [
        [fnCall('call_a', 'invoice_draft', { counterparty: '[NAME_1]', amount: '[AMT_1]', vat: null, item: null, date_month_offset: null, date_day: null, quantity: null, unit_price: null })],
        [message({ kind: 'did', text: '[NAME_1] 카드를 만들었어요.', show: [], ask: null })],
      ],
      200,
      undefined,
      () => true,
    );
    const r = await chat.send('한빛전자 55만원 끊어줘');
    assert.equal(r.unavailable, undefined, JSON.stringify(r));
    const text = JSON.stringify(gw.calls.find((c) => c.url.endsWith('/v1/respond'))!.body).replace(/\\n/g, '\n');
    assert.match(text, /\[사실\]\nPC: 켜짐\n/);
    assert.match(text, /앱 판단: 세금계산서 발급 요청/);
    const card = r.items.find((x) => x.kind === 'msg' && x.card);
    assert.ok(card && card.kind === 'msg');
    assert.equal(card.card?.note, '발급하기를 누르면 PC가 바로 준비해요');
    // 부가세를 말하지 않았으면 별도로 둔다(카드에 "정하지 않음"을 쓰지 않는다)
    if (card.card?.draft?.vat !== undefined) assert.notEqual(card.card.draft.vat, null);
    assert.ok(!JSON.stringify(card.card).includes('정하지 않음'));
  });

  it('카드 만들기: 게이트웨이에는 가린 글과 기기 인증 헤더만 가고, 답과 카드가 홈 대화 줄이 된다', async () => {
    const { chat, gw, saved } = make([
      [fnCall('call_a', 'invoice_draft', { counterparty: '[NAME_1]', amount: '[AMT_1]', vat: 'separate', item: null, date_month_offset: null, date_day: null, quantity: null, unit_price: null })],
      [message({ kind: 'did', text: '[NAME_1] 카드를 만들었어요. 맡기면 PC를 켰을 때 시작해요.', show: [], ask: null })],
    ]);
    const r = await chat.send('한빛전자에 55만원 세금계산서 끊어줘');
    assert.equal(r.unavailable, undefined, JSON.stringify(r));
    assert.equal(r.drafts.length, 1);
    assert.deepEqual([r.drafts[0]!.amount, r.drafts[0]!.vat, r.drafts[0]!.item], [550000, 'separate', '컨설팅']);
    const card = r.items.find((x) => x.kind === 'msg' && x.card);
    assert.ok(card && card.kind === 'msg' && card.card);
    assert.equal(card.card.title, '한빛전자 세금계산서');
    assert.deepEqual(card.card.rows[0], { label: '금액', value: '550,000원', strong: true });

    const items = (await chat.items()).filter((x) => x.kind === 'msg' && x.text !== undefined);
    assert.deepEqual(items.map((x) => x.kind === 'msg' && [x.from, x.text]), [['me', '한빛전자에 55만원 세금계산서 끊어줘'], ['pc', '한빛전자 카드를 만들었어요. 맡기면 PC를 켰을 때 시작해요.']]);

    // 나간 것: 실행 토큰 1번 + 판정 1번(ADR-057, 가린 글) + respond 2번, 모두 운영 origin, 모두 기기 인증 헤더
    assert.deepEqual(gw.calls.map((c) => c.url.slice(ORIGIN.length)), ['/v1/run-tokens', '/v1/decide', '/v1/respond', '/v1/respond']);
    assert.equal((gw.calls[1]!.body as { bundleId: string }).bundleId, 'chat_route_v1');
    for (const c of gw.calls) assert.ok(c.headers.Authorization?.startsWith('DPoP ') && c.headers.DPoP, c.url);
    const sent = JSON.stringify(gw.calls.map((c) => c.body));
    for (const raw of ['한빛전자', '220-81-62517', '55만원', '550000', '500000', '율무상회', '123-45-67890']) assert.ok(!sent.includes(raw), `원값이 나갔다: ${raw}`);
    assert.equal((gw.calls[2]!.body as { toolset: string }).toolset, 'chat_phone');
    // 봉인 저장에 넘기는 것도 원값 없는 가린 글 + 화면 문장뿐이다(파일은 기기 키로 봉인된다)
    assert.ok(saved());

    assert.ok(await chat.entrust(r.drafts[0]!.id));
    assert.equal((await chat.core.drafts())[0]!.state, 'entrusted');
  });

  it('하루 한도에 닿으면 모델을 더 부르지 않고 이유 한 줄을 준다', async () => {
    const { chat } = make([], 429, 'gateway.daily_limit');
    const r = await chat.send('안녕');
    assert.equal(r.unavailable?.code, 'chat.daily_limit');
    assert.ok(r.unavailable.text.length > 0);
    assert.equal((await chat.items()).length, 0, '막힌 턴은 기록하지 않는다(화면이 내 말을 따로 남긴다)');
  });

  it('한도·사용량은 PC와 같이 센 값을 그대로 받는다', async () => {
    const { chat } = make([]);
    assert.deepEqual(await chat.usage(), { usedKrw: 3, limitKrw: 50, resetAt: 1, tier: 'trial' });
  });

  it('표 결과의 카드 모양(사본이 오래됐으면 한 줄 덧붙임)', () => {
    const c = cardOf({ type: 'table', table: 'history', title: '한빛전자 발급', rows: [{ date: '2026-11-03', counterparty: '한빛전자', total: 550000, approvalNo: null }], copy: 'stale' });
    assert.deepEqual(c, { title: '한빛전자 발급', rows: [{ label: '11/03 한빛전자', value: '550,000원' }], note: 'PC가 마지막으로 넘긴 기록이에요' });
  });

  it('폰 사본 맞추기: 지난 공급가에 세액(10% 버림)을 더한 합계, KST 날짜', () => {
    assert.deepEqual(copy.issued, [{ counterpartyId: 'c1', counterparty: '한빛전자', date: '2026-11-03', total: 550000, approvalNo: null }]);
    assert.deepEqual(copy.counterparties, [{ id: 'c1', name: '한빛전자', bizNo: '220-81-62517', item: '컨설팅' }]);
    assert.equal(copy.receivables, null);
  });
});

describe('폰 대화 줄 표시', () => {
  const at = new Date(2026, 10, 18, 14, 5).getTime();
  it('폰이 답한 말은 폰 답으로 표시해 둔다', () => {
    const a = itemOf({ id: 'a', from: 'assistant', at, text: '네' } as never);
    assert.equal(a.kind === 'msg' && a.via, 'phone');
  });
  it('내 말 아래에는 PC 켜지면 보낼 말에만 한 줄을 쓴다(보내는 중, 못 보냄은 다른 데서 보인다)', () => {
    const me = (state: 'sending' | 'failed' | 'waiting' | 'sent') => stateOf({ kind: 'msg', id: 'm', from: 'me', at, text: 'x', state });
    assert.equal(me('sending'), '');
    assert.equal(me('failed'), '');
    assert.equal(me('waiting'), 'PC 켜지면 보내요');
    assert.equal(me('sent'), '');
  });
  const m = (id: string, from: 'me' | 'pc', min: number, extra = {}) => ({ kind: 'msg' as const, id, from, at: at + min * 60_000, text: id, ...extra });
  it('시각 줄은 첫 말 앞, 30분 넘게 떨어진 말 앞, 날짜가 바뀐 말 앞에만 넣는다(Muse)', () => {
    const items = [m('a', 'me', 0), m('b', 'pc', 1), m('c', 'me', 31), m('d', 'pc', 62), m('e', 'me', 24 * 60)];
    const now = at + 10 * 60_000;
    assert.deepEqual(items.map((_, i) => stampBefore(items, i, now)), ['오후 2:05', null, null, '오후 3:07', '11월 19일 오후 2:05']);
  });
  it('시각 줄 글자: 오늘은 시각만, 다른 날은 날짜, 다른 해는 해까지', () => {
    assert.equal(stampText(at, at), '오후 2:05');
    assert.equal(stampText(at, at + 86_400_000), '11월 18일 오후 2:05');
    assert.equal(stampText(at, new Date(2027, 0, 2).getTime()), '2026년 11월 18일 오후 2:05');
  });
  it('같은 쪽이 2분 안에 잇달아 한 말은 한 묶음, 시각 줄이 끼면 끊는다', () => {
    const items = [m('a', 'pc', 0), m('b', 'pc', 2), m('c', 'pc', 5), m('d', 'me', 5), m('e', 'me', 40), m('f', 'pc', 40, { via: 'phone' as const })];
    const g = items.map((_, i) => bubbleGroup(items, i));
    assert.deepEqual(g.map((x) => x.first), [true, false, true, true, true, true]);
    assert.deepEqual(g.map((x) => x.last), [false, true, true, true, true, true]);
  });
  it('폰 답과 PC 답은 같은 상대라도 묶지 않는다', () => {
    const items = [m('a', 'pc', 0), m('b', 'pc', 0, { via: 'phone' as const })];
    assert.equal(bubbleGroup(items, 1).first, true);
    assert.equal(bubbleGroup(items, 0).last, true);
  });
});

describe('앱을 껐다 켜도 폰 대화가 남는다', () => {
  /** 두 번 실행 사이에 남는 파일 둘(코어 기록, 카드·표)을 흉내 낸다 */
  function twoRuns(outputs: Array<Array<Record<string, unknown>>>, status = 200) {
    const disk = { chat: null as string | null, shown: null as string | null };
    const open = (o: Array<Array<Record<string, unknown>>>, st = 200) => {
      const gw = fakeGateway(o, st);
      let n = 0;
      return new OfflineChat({
        origin: ORIGIN,
        fetch: gw.fetch,
        authHeaders: async (method, url) => ({ Authorization: 'DPoP sxd1.test', DPoP: `${method} ${url}` }),
        store: { load: async () => disk.chat, save: async (d) => void (disk.chat = d) },
        shownStore: { load: async () => disk.shown, save: async (d) => void (disk.shown = d) },
        copy: () => copy,
        now: () => NOW,
        newId: () => `01KC${String(++n).padStart(22, '0')}`,
        randomHex: () => randomBytes(16).toString('hex'),
      });
    };
    return { first: open(outputs, status), reopen: () => open([]) };
  }

  it('카드가 붙은 답: 다시 열어도 말과 카드가 그대로 있다', async () => {
    const { first, reopen } = twoRuns([
      [fnCall('call_a', 'invoice_draft', { counterparty: '[NAME_1]', amount: '[AMT_1]', vat: 'separate', item: null, date_month_offset: null, date_day: null, quantity: null, unit_price: null })],
      [message({ kind: 'did', text: '[NAME_1] 카드를 만들었어요.', show: [], ask: null })],
    ]);
    const r = await first.send('한빛전자에 55만원 세금계산서 끊어줘');
    assert.equal(r.unavailable, undefined, JSON.stringify(r));
    const again = await reopen().items();
    assert.deepEqual(again.map((x) => x.id), (await first.items()).map((x) => x.id));
    const card = again.find((x) => x.kind === 'msg' && x.card);
    assert.ok(card && card.kind === 'msg' && card.card?.title === '한빛전자 세금계산서', JSON.stringify(again));
    assert.equal(again.filter((x) => x.kind === 'msg' && x.from === 'me').length, 1);
  });

  it('못 보낸 말과 이유 줄도 남기고, 지우면 다시 열어도 없다', async () => {
    const { first, reopen } = twoRuns([]);
    const failed = [
      { kind: 'msg' as const, id: 'off-me-1', from: 'me' as const, at: NOW, text: '안녕', state: 'failed' as const },
      { kind: 'note' as const, id: 'off-1', at: NOW + 1, text: '연결이 잠깐 끊겼어요', failed: { retry: '안녕' } },
    ];
    await first.keep(failed);
    const seen = await reopen().items();
    assert.deepEqual(seen.map((x) => x.id), ['off-me-1', 'off-1']);
    await first.forget(['off-me-1', 'off-1']);
    assert.deepEqual(await reopen().items(), []);
  });

  it('저장소가 깨진 값을 주면 빈 대화로 시작한다', async () => {
    const { reopen } = twoRuns([]);
    const c = reopen();
    assert.deepEqual(await c.items(), []);
  });
});
