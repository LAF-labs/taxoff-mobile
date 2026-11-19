// 갤러리 견본: public/sample-invoice.jpg(가짜 사업자로 그린 종이 세금계산서)와 그 OCR 상자.
import { paperTaxInvoice } from '../test/fixtures/invoice-boxes';
import type { AccountDevice } from '../src/devices';
import type { ChatItem } from '../src/chat';
import type { OfflineChatView } from '../src/offline/useOfflineChat';

export const SAMPLE_INVOICE = paperTaxInvoice();
export const SAMPLE_SHOT = { uri: '/sample-invoice.jpg', width: 1520, height: 1040, capturedAt: Date.now() };

// 연결된 기기 견본(가짜 기기 번호). SELF는 이 폰, PC_PAIRED는 이 폰과 연결한 PC(paired()의 desktopDeviceId와 같다).
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

// 폰 직접 대화 견본(PC가 꺼져 있을 때 폰이 답한다, ADR-047). 문구는 코어(vendor/sax-chat-core PHONE_ERROR_TEXT)와 같다.
const MIN = 60_000;
export function phoneChat(state: 'empty' | 'typing' | 'reply' | 'failed' | 'limit' | 'card' | 'ask', base = Date.now()): OfflineChatView {
  const t = (m: number) => base - m * MIN;
  const ask: ChatItem = { kind: 'msg', id: 'p1', from: 'me', at: t(6), text: '동네마트에 세금계산서 발급해 줘' };
  const reply: ChatItem[] = [
    ask,
    { kind: 'msg', id: 'p2', from: 'pc', via: 'phone', at: t(6), text: '동네마트 성수점에 지난번처럼 생활용품으로 쓸게요. 공급가액은 얼마로 할까요?' },
    { kind: 'msg', id: 'p3', from: 'me', at: t(5), text: '32만원' },
    { kind: 'msg', id: 'p4', from: 'pc', via: 'phone', at: t(5), text: '부가세는 별도인가요, 포함인가요?' },
  ];
  const base0 = { available: true, busy: false, chips: [] as OfflineChatView['chips'], send: async () => {}, retry: async () => {} };
  switch (state) {
    case 'empty':
      return { ...base0, items: [] };
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
          { kind: 'msg', id: 'c2', from: 'pc', via: 'phone', at: t(2), text: '동네마트 성수점 카드를 만들었어요. 맞으면 [발급 맡기기]를 눌러 주세요.' },
          {
            kind: 'msg', id: 'c3', from: 'pc', via: 'phone', at: t(2),
            card: {
              title: '동네마트 성수점 세금계산서',
              rows: [{ label: '금액', value: '320,000원', strong: true }, { label: '부가세', value: '정하지 않음' }, { label: '품목', value: '생활용품' }],
              note: '맡기면 PC가 바로 준비해요',
              draft: { id: 'd-sample', counterpartyId: 'dm', amount: 320_000, vat: null, item: '생활용품' },
            },
          },
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
