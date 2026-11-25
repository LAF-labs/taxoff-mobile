import { paperTaxInvoice } from '../test/fixtures/invoice-boxes';
import type { AccountDevice } from '../src/devices';
import type { ChatItem } from '../src/chat';
import type { OfflineChatView } from '../src/offline/useOfflineChat';

export const SAMPLE_INVOICE = paperTaxInvoice();
export const SAMPLE_SHOT = { uri: '/sample-invoice.jpg', width: 1520, height: 1040, capturedAt: Date.now() };

const DAY = 86_400_000;
export const DEVICE_SELF = '00000000-0000-4000-8000-0000000000a1';
export const DEVICE_PC_PAIRED = 'dev-01HZX9K2Q4';
const dev = (n: number, role: AccountDevice['role'], platform: string, name: string, daysAgo: number, extra: Partial<AccountDevice> = {}): AccountDevice => ({
  deviceId: `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`, role, platform, name, state: 'active', registeredAt: Date.now() - daysAgo * DAY, deleteAfter: null, ...extra,
});
const self = (): AccountDevice => dev(0xa1, 'mobile', 'ios', 'iPhone', 12);
const pcPaired = (): AccountDevice => ({ ...dev(0xb1, 'desktop', 'win32', '사무실 PC', 30), deviceId: DEVICE_PC_PAIRED });
export const DEVICES_NORMAL = (): AccountDevice[] => [pcPaired(), dev(0xb2, 'desktop', 'darwin', '집 맥북', 8), self(), dev(0xa2, 'mobile', 'android', '', 3)];
export const DEVICES_FULL = (): AccountDevice[] => [
  pcPaired(), dev(0xb2, 'desktop', 'darwin', '집 맥북', 8), dev(0xb3, 'desktop', 'win32', '세무 담당 노트북', 2),
  self(), dev(0xa2, 'mobile', 'android', '', 3), dev(0xa3, 'mobile', 'ios', '직원 아이폰', 1, { state: 'pending' }),
];
export const DEVICES_SUSPENDED = (): AccountDevice[] => [
  pcPaired(), dev(0xb2, 'desktop', 'darwin', '집 맥북', 8, { state: 'suspended', deleteAfter: Date.now() + 5 * DAY + 3_600_000 }),
  self(), dev(0xa2, 'mobile', 'android', '잃어버린 폰', 40, { state: 'suspended', deleteAfter: Date.now() + 1_800_000 }),
];

const MIN = 60_000;
export function phoneChat(state: 'empty' | 'typing' | 'reply' | 'failed' | 'limit' | 'card' | 'ask' | 'screen' | 'lunch' | 'react-working' | 'react-result' | 'react-only' | 'sales', base = Date.now()): OfflineChatView {
  const t = (m: number) => base - m * MIN;
  const ask: ChatItem = { kind: 'msg', id: 'p1', from: 'me', at: t(6), text: '동네마트에 세금계산서 발급해 줘' };
  const reply: ChatItem[] = [
    ask,
    { kind: 'msg', id: 'p2', from: 'pc', via: 'phone', at: t(6), text: '동네마트 성수점에 지난번처럼 생활용품으로 쓸게요. 공급가액은 얼마로 할까요?' },
    { kind: 'msg', id: 'p3', from: 'me', at: t(5), text: '32만원' },
    { kind: 'msg', id: 'p4', from: 'pc', via: 'phone', at: t(5), text: '부가세는 별도인가요, 포함인가요?' },
  ];
  const base0 = { available: true, busy: false, chips: [] as OfflineChatView['chips'], send: async () => {}, retry: async () => {}, react: async () => {} };
  switch (state) {
    case 'empty':
      return { ...base0, items: [] };
    case 'sales':
      return {
        ...base0,
        items: [
          { kind: 'msg', id: 's1', from: 'me', at: t(4), text: '이번 달 매출 알려줘' },
          { kind: 'msg', id: 's2', from: 'pc', via: 'phone', at: t(4), text: '이번 달은 세금계산서 14건, 합계 9,262,000원이에요.' },
          {
            kind: 'msg', id: 's3', from: 'pc', via: 'phone', at: t(4),
            card: { title: '11월 발급 14건, 공급가 8,420,000원, 합계 9,262,000원', rows: [{ label: '11/19 동네마트 성수점', value: '352,000원' }, { label: '11/17 한빛전자', value: '1,100,000원' }, { label: '11/12 서울상사', value: '330,000원' }] },
          },
          { kind: 'msg', id: 's4', from: 'me', at: t(1), text: '지난달이랑 비교하면?', replyTo: { text: '이번 달은 세금계산서 14건, 합계 9,262,000원이에요.', mine: false } },
        ],
      };
    case 'typing':
      return { ...base0, busy: true, items: [{ ...ask, id: 'pp', state: 'sending' }] };
    case 'reply':
      return { ...base0, items: reply, chips: [{ label: '별도', text: '부가세 별도로' }, { label: '포함', text: '부가세 포함으로' }] };
    case 'failed':
      return {
        ...base0,
        items: [
          { ...ask, id: 'pf', state: 'failed' },
          { kind: 'note', id: 'pn', at: t(6) + 1, text: '연결이 잠깐 끊겨서 보내지 못했어요. 다시 보내 주세요.', failed: { retry: '동네마트에 세금계산서 발급해 줘' } },
        ],
      };
    case 'card':
      return {
        ...base0,
        items: [
          { kind: 'msg', id: 'c1', from: 'me', at: t(2), text: '동네마트 32만원 끊어줘' },
          { kind: 'msg', id: 'c2', from: 'pc', via: 'phone', at: t(2), text: '동네마트 성수점 카드를 만들었어요. 맞으면 [발급하기]를 눌러 주세요.' },
          {
            kind: 'msg', id: 'c3', from: 'pc', via: 'phone', at: t(2),
            card: {
              title: '동네마트 성수점 세금계산서',
              rows: [{ label: '금액', value: '320,000원', strong: true }, { label: '부가세', value: '부가세 별도' }, { label: '품목', value: '생활용품' }],
              note: '발급하기를 누르면 PC가 바로 준비해요',
              draft: { id: 'd-sample', counterpartyId: 'dm', amount: 320_000, vat: 'separate', item: '생활용품' },
            },
          },
        ],
      };
    case 'screen':
      return {
        ...base0,
        items: [
          { kind: 'msg', id: 's1', from: 'me', at: t(1), text: '아까 받은 영수증 올릴게' },
          { kind: 'msg', id: 's2', from: 'pc', via: 'phone', at: t(1), text: '아래 단추로 바로 찍을 수 있어요. 찍으면 PC로 보내 둘게요.' },
        ],
        screens: ['capture'],
      };
    case 'react-working':
      return { ...base0, busy: true, items: [{ kind: 'msg', id: 'r1', from: 'me', at: t(0), text: '동네마트 32만원 끊어줘', state: 'sending', reaction: 'eyes' }] };
    case 'react-result':
    case 'react-only': {
      const work: ChatItem[] = [
        { kind: 'msg', id: 'r1', from: 'me', at: t(1), text: '동네마트 32만원 끊어줘', reaction: 'eyes' },
        { kind: 'msg', id: 'r2', from: 'pc', via: 'phone', at: t(1), text: '동네마트 성수점 32만원(부가세 별도) 카드를 만들었어요.' },
        {
          kind: 'msg', id: 'r3', from: 'pc', via: 'phone', at: t(1),
          card: {
            title: '동네마트 성수점 세금계산서',
            rows: [{ label: '금액', value: '320,000원', strong: true }, { label: '부가세', value: '부가세 별도' }, { label: '품목', value: '생활용품' }],
            note: '발급하기를 누르면 PC가 바로 준비해요',
            draft: { id: 'd-sample', counterpartyId: 'dm', amount: 320_000, vat: 'separate', item: '생활용품' },
          },
        },
      ];
      if (state === 'react-result') return { ...base0, items: work };
      return {
        ...base0,
        items: [
          ...work,
          { kind: 'msg', id: 'r4', from: 'me', at: t(0), text: '고마워', reaction: 'pray' },
          { kind: 'msg', id: 'r5', from: 'me', at: t(0), text: '고마워', reaction: 'pray' },
          { kind: 'msg', id: 'r6', from: 'pc', via: 'phone', at: t(0), text: '별말씀을요. 또 필요하면 불러 주세요.' },
        ],
      };
    }
    case 'lunch':
      return {
        ...base0,
        items: [
          { kind: 'msg', id: 'l1', from: 'me', at: t(1), text: '오늘 점심 뭐 먹을까?' },
          { kind: 'msg', id: 'l2', from: 'pc', via: 'phone', at: t(1), text: '날이 쌀쌀하니 뜨끈한 순댓국 어떠세요? 든든해서 오후까지 버티기 좋아요.' },
        ],
      };
    case 'ask':
      return {
        ...base0,
        items: [
          { kind: 'msg', id: 'a1', from: 'me', at: t(1), text: '5만원 끊어줘' },
          { kind: 'msg', id: 'a2', from: 'pc', via: 'phone', at: t(1), text: '어느 거래처인가요? 거래처 목록에서 골라 주세요.' },
        ],
        chips: [{ label: '동네마트 성수점', text: '동네마트 성수점' }, { label: '가나식자재', text: '가나식자재' }, { label: '한빛인쇄', text: '한빛인쇄' }],
      };
    case 'limit':
      return {
        ...base0,
        items: [
          ...reply.slice(0, 2),
          { kind: 'msg', id: 'pl', from: 'me', at: t(1), text: '32만원', state: 'failed' },
          { kind: 'note', id: 'pln', at: t(1) + 1, text: '이번 주 대화를 다 썼어요. 월요일에 다시 채워져요. 세금계산서 발급과 승인은 그대로 할 수 있어요.', failed: {} },
        ],
      };
  }
}

/**
 * 월 리포트 사본(기준판 Phone-Report 2026-11 숫자 그대로). 11월과 10월은 기준판 값, 그 밖 달은 기준판 막대 높이에서 거꾸로 셈한 값이다.
 * 거래처와 품목 이름은 지어낸 값이다.
 */
type ReportCopy = import('@sax/remote').CopyReport;
type ReportMonth = ReportCopy['months'][number];
const RM = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const SALES_T = [36_300_000, 32_100_000, 34_600_000, 38_900_000, 40_200_000, 41_500_000, 39_330_000, 43_600_000, 35_900_000, 47_000_000];
const BUY_T = [23_900_000, 21_400_000, 22_200_000, 25_200_000, 24_800_000, 26_100_000, 23_940_000, 26_500_000, 22_660_000, 29_070_000];
const ln = (a: number | null) => ({ a, p: false });
const rmonth = (month: string, i: number): ReportMonth => {
  if (month === '2026-11') {
    return {
      month,
      sales: { inv: ln(42_350_000), cr: ln(1_280_000), card: ln(4_870_000), cash: ln(null) },
      purchase: { inv: ln(18_920_000), card: ln(2_315_400), cr: ln(486_000), rcpt: ln(0), pay: ln(6_200_000) },
      bank: { in: 39_870_000, out: 31_245_600, done: true, bin: { receivable: 33_960_000, card_sales: 4_650_000, interest: 12_000, other: 1_248_000 }, bout: { payable: 16_480_000, payroll: 6_200_000, card_payment: 3_912_600, tax: 2_153_000, other: 2_500_000 } },
    };
  }
  if (month === '2026-10') {
    return {
      month,
      sales: { inv: ln(45_100_000), cr: ln(1_550_000), card: ln(4_650_000), cash: ln(null) },
      purchase: { inv: ln(21_000_000), card: ln(2_640_000), cr: ln(360_000), rcpt: ln(0), pay: ln(6_200_000) },
      bank: { in: 45_600_000, out: 35_100_000, done: true, bin: { receivable: 40_200_000, card_sales: 4_400_000, interest: 11_000, other: 989_000 }, bout: { payable: 19_800_000, payroll: 6_200_000, card_payment: 4_100_000, tax: 2_400_000, other: 2_600_000 } },
    };
  }
  const s = SALES_T[i]!;
  const b = BUY_T[i]!;
  const cr = Math.round(s * 0.03 / 1000) * 1000;
  const card = Math.round(s * 0.1 / 1000) * 1000;
  const pay = 6_200_000;
  const bc = Math.round((b - pay) * 0.09 / 1000) * 1000;
  const bcr = Math.round((b - pay) * 0.02 / 1000) * 1000;
  const bin = Math.round(s * 0.88 / 1000) * 1000;
  const bout = Math.round(b * 1.12 / 1000) * 1000;
  return {
    month,
    sales: { inv: ln(s - cr - card), cr: ln(cr), card: ln(card), cash: ln(null) },
    purchase: { inv: ln(b - pay - bc - bcr), card: ln(bc), cr: ln(bcr), rcpt: ln(0), pay: ln(pay) },
    bank: { in: bin, out: bout, done: true, bin: { receivable: bin - card, card_sales: card }, bout: { payable: bout - pay - bc, payroll: pay, card_payment: bc } },
  };
};
const PARTNERS = ['대한테크', '가나식자재', '한빛물산', '세진물산', '스마일카페', '바다수산', '푸른물류', '초록농원', '해담식당'];
const P_SHARE = [0.34, 0.22, 0.16, 0.13, 0.07, 0.032, 0.025, 0.015, 0.008];
const SUPPLIERS = ['부림철강', '미래포장', '오성전기', '제일운수', '아름인쇄', '현대타일'];
const S_SHARE = [0.41, 0.24, 0.15, 0.1, 0.06, 0.04];
const ITEMS: Array<[string, number, number]> = [['유지보수', 6, 15_600_000], ['자재 납품', 9, 11_480_000], ['물류 대행', 3, 6_250_000], ['월 구독', 12, 5_520_000], ['컨설팅', 2, 3_500_000]];
const BUY_ITEMS: Array<[string, number, number]> = [['철판', 4, 7_760_000], ['포장재', 6, 4_540_000], ['전기 공사', 1, 2_840_000], ['운송', 8, 1_890_000], ['인쇄', 2, 1_890_000]];
const MONTHS = RM.map(rmonth);
const winSum = (w: number, side: 'sales' | 'purchase') => MONTHS.slice(-w).reduce((t, m) => t + (side === 'sales' ? m.sales.inv.a! : m.purchase.inv.a!), 0);
const round = (n: number) => Math.round(n / 10_000) * 10_000;
// 거래처 시트: 대한테크 달마다(기준판 Phone-Report-Partner), 나머지는 비율대로
const DAEHAN = [9_800_000, 8_900_000, 10_100_000, 12_300_000, 11_900_000, 12_600_000, 11_200_000, 14_950_000, 12_040_000, 13_880_000, 15_620_000, 14_300_000];
const pmOf = (share: number, i: number) => (i === 0 ? DAEHAN : MONTHS.map((m) => round(m.sales.inv.a! * share)));
const buyPm = (share: number) => MONTHS.map((m) => round(m.purchase.inv.a! * share));
const window = (w: 1 | 3 | 6 | 12): ReportCopy['windows'][number] => {
  const st = winSum(w, 'sales');
  const pt = winSum(w, 'purchase');
  const ps = PARTNERS.map((name, i) => {
    const a = i === 0 ? DAEHAN.slice(-w).reduce((x, y) => x + y, 0) : w === 1 ? [9_240_000, 6_820_000, 5_410_000, 3_180_000, 1_400_000, 1_000_000, 650_000, 350_000][i - 1]! : round(st * P_SHARE[i]!);
    return { name, n: Math.max(1, Math.round((w * 3 * P_SHARE[i]!) / 0.34)), a, pct: Math.round((a / st) * 100), left: i === 0 ? 9_350_000 : i === 1 ? 4_620_000 : 0, settled: 0, i };
  });
  const pp = SUPPLIERS.map((name, i) => {
    const a = round(pt * S_SHARE[i]!);
    return { name, n: Math.max(1, Math.round(w * 2 * S_SHARE[i]! * 3)), a, pct: Math.round((a / pt) * 100), left: i === 0 ? 3_300_000 : 0, settled: 0, i: PARTNERS.length + i };
  });
  const it = (rows: Array<[string, number, number]>, total: number) => rows.map(([name, n, a]) => ({ name, n: n * w, a: w === 1 ? a : round((a / 42_350_000) * total), pct: Math.round((a / 42_350_000) * 100) }));
  return {
    months: w,
    ps: { rows: ps, rest: null, total: st },
    pp: { rows: pp, rest: null, total: pt },
    is: { rows: it(ITEMS, st), rest: null, total: st },
    ip: { rows: it(BUY_ITEMS, pt), rest: null, total: pt },
  };
};
export const SAMPLE_REPORT: ReportCopy = {
  month: '2026-11',
  today: '2026-11-25',
  bankTo: '2026-11-24',
  hometaxTo: '2026-11-25',
  months: MONTHS,
  windows: ([1, 3, 6, 12] as const).map(window),
  balances: [
    { bank: '우리은행', last4: '1234', a: 21_480_300, d: '2026-11-24' },
    { bank: '국민은행', last4: '5678', a: 6_912_000, d: '2026-11-24' },
  ],
  pm: [...P_SHARE.map((s, i) => ({ m: pmOf(s, i), d: i === 0 ? 32 : i === 1 ? 18 : i < 5 ? 25 : null })), ...S_SHARE.map((s) => ({ m: buyPm(s), d: 14 }))],
  biz: { name: '가나상사', bizNo: '123-45-67890' },
};
