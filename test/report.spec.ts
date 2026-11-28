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

const { decodeEnvelope, encodeEnvelope, makeEnvelope, reportDocHtml, ulid } = await import('@sax/remote');
const { clampMonth, monthsFor, partnerMonths, periodText, reportDocOf, reportFileName, reportView, reportWait, spanText, topOf } = await import('../src/report.ts');
const { newerCopy } = await import('../src/net/pcCopy.ts');
type Copy = import('@sax/remote').CopyReport;
type Month = Copy['months'][number];

const L = (a: number | null, p = false) => ({ a, p });
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const month = (m: string, i: number): Month => ({
  month: m,
  sales: { inv: L(1_000_000 * (i + 1)), cr: L(i === 10 ? null : 10_000), card: L(20_000), cash: L(i === 11 ? 5_000 : null) },
  purchase: { inv: L(300_000), card: L(40_000), cr: L(2_000), rcpt: L(0), pay: L(i >= 10 ? 600_000 : null) },
  ...(i >= 9 ? { bank: { in: 900_000, out: 700_000, done: true, bin: { receivable: 800_000, interest: 100_000 }, bout: { payable: 400_000, payroll: 300_000 } } } : {}),
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `거래처${i + 1}`, n: 1, a: 1_000 * (n - i), pct: 10, left: i === 0 ? 2_500 : 0, i: i === 0 ? 0 : undefined })).map(({ i, ...r }) => (i === undefined ? r : { ...r, i }));
const COPY: Copy = {
  month: '2026-11',
  today: '2026-11-25',
  bankTo: '2026-11-24',
  hometaxTo: '2026-11-25',
  months: MONTHS.map(month),
  windows: ([1, 3, 6, 12] as const).map((w) => ({
    months: w,
    ps: { rows: rows(8), rest: { k: 3, n: 4, a: 900, pct: 3 }, total: 40_000 },
    pp: { rows: [], rest: null, total: 0 },
    is: { rows: [{ name: '유지보수', n: 6, a: 15_600_000, pct: 37 }, { name: null, n: 1, a: 10, pct: 0 }], rest: null, total: 15_600_010 },
    ip: { rows: [], rest: null, total: 0 },
  })),
  balances: [
    { bank: '우리은행', last4: '1234', a: 21_480_300, d: '2026-11-24' },
    { bank: '국민은행', last4: '5678', a: null },
  ],
  pm: [{ m: [0, 0, 0, 0, 0, 0, 100, 200, 300, 400, 500, 8_000], d: 32 }],
  biz: { name: '가나상사', bizNo: '123-45-67890' },
};

describe('폰 월 리포트 사본 읽기(tex ADR-068 결정 8)', () => {
  it('PC가 보낸 사본은 봉투 검증을 지나고, 그 밖 칸 없이 그대로 돌아온다', () => {
    const env = makeEnvelope('phone.copy', { asOf: 1, counterparties: [], report: COPY }, { pairId: ulid(), from: 'desktop', seq: 1 });
    assert.deepEqual(decodeEnvelope(encodeEnvelope(env))?.body, env.body);
  });

  it('기간 합은 PC 엔진과 같은 규칙: 모르는 달이 있으면 일부, 넣지 않은 현금매출과 급여는 합계를 막지 않는다', () => {
    const one = reportView(COPY, '2026-11', 1);
    assert.deepEqual(one.sales.inv, { amount: 12_000_000, partial: false });
    assert.deepEqual(one.sales.cash, { amount: 5_000, partial: false });
    assert.deepEqual(one.sales.total, { amount: 12_000_000 + 10_000 + 20_000 + 5_000, partial: false });
    const three = reportView(COPY, '2026-11', 3);
    // 10월 현금영수증을 받지 못함: 아는 두 달만 더하고 일부로 표시, 합계도 일부
    assert.deepEqual(three.sales.cr, { amount: 20_000, partial: true });
    assert.equal(three.sales.total.partial, true);
    assert.deepEqual(three.purchase.pay, { amount: 1_200_000, partial: false });
    assert.equal(three.purchase.total.partial, false, '급여가 없는 달은 합계를 일부로 만들지 않는다');
    assert.deepEqual(three.bank, { in: 2_700_000, out: 2_100_000, net: 600_000 });
    assert.deepEqual(three.bankOut, [{ key: 'payable', label: '매입 결제', amount: 1_200_000 }, { key: 'payroll', label: '급여', amount: 900_000 }]);
    assert.deepEqual(three.bankIn.map((x) => x.label), ['받을 돈', '이자']);
    // 6월부터 8월은 계좌가 없다: 기간 안에 계좌가 하나도 없으면 통장은 null(0으로 보이지 않는다)
    assert.equal(reportView(COPY, '2026-08', 3).bank, null);
  });

  it('막대는 6칸(1년이면 12칸), 고른 기간 밖은 흐리게, 고른 달 표시', () => {
    const v = reportView(COPY, '2026-11', 3);
    assert.deepEqual(v.chart.map((c) => [c.label, c.inWindow, c.on]), [['6월', false, false], ['7월', false, false], ['8월', false, false], ['9월', true, false], ['10월', true, false], ['11월', true, true]]);
    const y = reportView(COPY, '2026-11', 12);
    assert.deepEqual(y.chart.map((c) => c.label), ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    assert.ok(y.chart.every((c) => c.inWindow));
    assert.equal(y.chart[1]!.sales.total.amount, 2_000_000 + 30_000);
  });

  it('앞 달로는 막대 칸을 채울 수 있는 데까지만, 1년은 마지막 달 하나. 순위는 마지막 달에만 있다', () => {
    assert.deepEqual(monthsFor(COPY, 1), MONTHS.slice(5));
    assert.deepEqual(monthsFor(COPY, 12), ['2026-11']);
    assert.equal(clampMonth(COPY, '2026-03', 1), '2026-05');
    assert.equal(clampMonth(COPY, '2026-09', 12), '2026-11');
    assert.equal(reportView(COPY, '2026-05', 1).first, true);
    const past = reportView(COPY, '2026-10', 1);
    assert.equal(past.latest, false);
    assert.equal(past.ranks, null);
    assert.ok(reportView(COPY, '2026-11', 1).ranks);
  });

  it('카드 순위: 위 다섯 줄, 나머지는 사본의 10줄 밖 묶음까지 더한 "그 밖에" 한 줄, 거래처 줄은 12달 값을 붙인다', () => {
    const r = reportView(COPY, '2026-11', 1).ranks!;
    const top = topOf(r.ps);
    assert.deepEqual(top.rows.map((x) => x.name), ['거래처1', '거래처2', '거래처3', '거래처4', '거래처5']);
    assert.deepEqual(top.rest, { name: '그 밖에 6곳', n: 7, amount: 3_000 + 2_000 + 1_000 + 900, share: 6_900 / 40_000 });
    assert.equal(top.more, true);
    assert.deepEqual(r.ps.rows[0]!.pm, COPY.pm![0]);
    assert.equal(r.ps.rows[0]!.left, 2_500);
    assert.equal(r.ps.rows[1]!.pm, undefined);
    assert.equal(r.is.rows[1]!.name, '품목 없음');
    assert.deepEqual(topOf(r.is), { rows: r.is.rows, rest: null, more: false });
  });

  it('거래처 시트: 사본 마지막 달에서 거꾸로 여섯 달, 기간 글', () => {
    assert.deepEqual(partnerMonths(COPY, COPY.pm![0]!), [
      { label: '11월', amount: 8_000 },
      { label: '10월', amount: 500 },
      { label: '9월', amount: 400 },
      { label: '8월', amount: 300 },
      { label: '7월', amount: 200 },
      { label: '6월', amount: 100 },
    ]);
    assert.equal(spanText('2026-11', 1), '11월');
    assert.equal(spanText('2026-02', 3), '12월부터 2월');
  });

  it('PDF는 PC와 같은 이름과 묶음. 앞 달은 순위 묶음을 빼고 "없음"으로 그리지 않는다', () => {
    assert.equal(periodText('2026-11', 3), '2026년 9월부터 11월');
    assert.equal(periodText('2026-02', 6), '2025년 9월부터 2026년 2월');
    assert.equal(reportFileName('2026-11', 1), '택스오프 리포트 2026년 11월.pdf');
    const now = Date.parse('2026-11-25T20:52:00+09:00');
    const doc = reportDocOf(COPY, reportView(COPY, '2026-11', 1), now);
    assert.equal(doc.bizName, '가나상사');
    assert.equal(doc.made, '2026년 11월 25일 20:52');
    assert.equal(doc.bankTo, '11월 24일까지');
    assert.equal(doc.balanceDay, '11월 24일');
    assert.deepEqual(doc.partnersSale?.rest, { name: '그 밖에 3곳', count: 4, amount: 900, share: 0.03 });
    assert.equal(doc.partnersSale?.count, 8 + 4);
    const html = reportDocHtml(doc);
    for (const want of ['가나상사 리포트', '2026년 11월', '많이 판 거래처', '거래처1', '많이 판 품목', '계좌 잔액', '확인 못 함']) assert.ok(html.includes(want), want);
    const past = reportDocOf(COPY, reportView(COPY, '2026-10', 1), now);
    assert.equal(past.partnersSale, null);
    const pastHtml = reportDocHtml(past);
    assert.ok(!pastHtml.includes('많이 판 거래처') && !pastHtml.includes('많이 판 품목'));
    assert.ok(pastHtml.includes('2026년 10월'));
  });

  it('리포트가 없을 때: PC가 켜져 있으면 "PC가 켜지면"이라고 하지 않고 옛 PC와 못 만든 것을 가른다', () => {
    const base = { asOf: 1, counterparties: [] };
    assert.equal(reportWait('offline', { ...base, reportCap: true }), 'off');
    assert.equal(reportWait('connecting', null), 'off');
    assert.equal(reportWait('online', null), 'loading');
    assert.equal(reportWait('online', base), 'loading', '이번 연결의 사본이 오기 전(저장된 옛 사본)');
    assert.equal(reportWait('online', { ...base, reportCap: false }), 'pc_old');
    assert.equal(reportWait('online', { ...base, reportCap: true }), 'not_made');
  });

  it('새 사본에 리포트가 없으면(PC가 읽지 못했거나 한 프레임에 넣으려 뺌) 같은 PC의 마지막 리포트를 둔다', () => {
    const have = { asOf: 1, counterparties: [], report: COPY, ownerDesktopDeviceId: 'pc1' };
    assert.equal(newerCopy(have, { asOf: 2, counterparties: [], ownerDesktopDeviceId: 'pc1' }).report, COPY);
    assert.equal(newerCopy(have, { asOf: 2, counterparties: [], ownerDesktopDeviceId: 'pc2' }).report, undefined, '다른 PC의 리포트는 잇지 않는다');
  });
});
