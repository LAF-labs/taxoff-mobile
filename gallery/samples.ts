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
            card: { title: '11월 발급 14건 · 공급가 8,420,000원 · 합계 9,262,000원', rows: [{ label: '11/19 동네마트 성수점', value: '352,000원' }, { label: '11/17 한빛전자', value: '1,100,000원' }, { label: '11/12 서울상사', value: '330,000원' }] },
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
          { kind: 'note', id: 'pln', at: t(1) + 1, text: '오늘 쓸 수 있는 AI 사용량을 다 썼어요. 새벽 4시에 다시 채워져요.', failed: {} },
        ],
      };
  }
}
