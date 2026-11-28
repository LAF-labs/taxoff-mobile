import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

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

const { CAP, encodeEnvelope, makeEnvelope } = await import('@sax/remote');
const { PHONE_CAPS, chatCopyOf, counterpartiesOf, newerCopy, receiveCopy } = await import('../src/net/pcCopy.ts');
type Body = import('@sax/remote').PhoneCopyBody;
type Ch = Parameters<typeof receiveCopy>[0];

const BODY: Body = {
  asOf: Date.parse('2026-11-17T10:00:00+09:00'),
  counterparties: [
    { ref: 'cp_12', name: '가나식자재', bizNo: '211-09-87654', emailHint: 'ta***@gana.example', phoneApprovable: false, last: { supply: 800_000, vatMode: 'excl', item: '과일', day: '2026-11-10' } },
    { ref: 'cp_7', name: '한빛전자', phoneApprovable: false },
  ],
  money: {
    asOf: Date.parse('2026-11-17T10:00:00+09:00'),
    accounts: 1,
    receivable: { unpaidCount: 2, unpaidTotal: 1_760_000, overdueCount: 0, overdueTotal: 0, dueSoonCount: 1, dueSoonTotal: 880_000, reviewCount: 0 },
    payable: { unpaidCount: 0, unpaidTotal: 0, overdueCount: 0, overdueTotal: 0, dueSoonCount: 0, dueSoonTotal: 0, reviewCount: 0 },
  },
};

function fakeChannel(envs: Array<{ type: string; body: unknown }>): Ch {
  const q = [...envs];
  return { closed: false, recv: async () => q.shift() ?? null } as unknown as Ch;
}

describe('폰 사본 받기', () => {
  it('폰은 hello에 copy.v1·issue.v1을 알리고, PC가 보낸 사본 봉투는 스키마를 지난다', () => {
    assert.deepEqual(PHONE_CAPS, [CAP.copy, CAP.issue, CAP.sync, CAP.issued, CAP.book, CAP.amend, CAP.report, CAP.docs, CAP.reportV2, CAP.reportV3, CAP.cpTel]);
    assert.ok(encodeEnvelope(makeEnvelope('phone.copy', BODY, { pairId: '01JD0000000000000000000000', from: 'desktop', seq: 1 })));
  });
  it('PC가 copy.v1을 알렸으면 phone.copy를 받고, 그 앞의 다른 봉투는 건너뛴다', async () => {
    const got = await receiveCopy(fakeChannel([{ type: 'ping', body: {} }, { type: 'phone.copy', body: BODY }]), [CAP.copy]);
    assert.deepEqual(got, BODY);
  });
  it('PC가 copy.v1을 알리지 않았거나 오지 않으면 기다리지 않고 null', async () => {
    assert.equal(await receiveCopy(fakeChannel([{ type: 'phone.copy', body: BODY }]), [CAP.cash]), null);
    assert.equal(await receiveCopy(fakeChannel([]), [CAP.copy], 50), null);
  });
  it('늦게 온 옛 사본은 새 사본을 덮지 않는다', () => {
    const old = { ...BODY, asOf: BODY.asOf - 1 };
    assert.equal(newerCopy(BODY, old), BODY);
    assert.equal(newerCopy(old, BODY), BODY);
    assert.equal(newerCopy(null, BODY), BODY);
  });
  it('거래처: 최근 발급은 그날 정오(KST)로, 이메일 힌트는 넣지 않는다', () => {
    const [a, b] = counterpartiesOf(BODY);
    assert.deepEqual(a, { id: 'cp_12', name: '가나식자재', bizNo: '211-09-87654', issued: 1, lastSupply: 800_000, lastItem: '과일', lastAt: Date.parse('2026-11-10T12:00:00+09:00') });
    assert.deepEqual(b, { id: 'cp_7', name: '한빛전자', bizNo: '', issued: 0 });
    assert.ok(!JSON.stringify(counterpartiesOf(BODY)).includes('***'));
  });
  it('대화 사본: 최근 발급 합계는 세액 포함, 받을 돈 목록은 사본에 없음(null), 사업자번호 없으면 null', () => {
    const c = chatCopyOf(BODY)!;
    assert.equal(c.asOf, BODY.asOf);
    assert.equal(c.profile, null);
    assert.deepEqual(c.issued, [{ counterpartyId: 'cp_12', counterparty: '가나식자재', date: '2026-11-10', total: 880_000, approvalNo: null }]);
    assert.equal(c.receivables, null);
    assert.equal(c.counterparties[1]!.bizNo, null);
    assert.equal(chatCopyOf(null), null);
  });
});
