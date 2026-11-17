// 갤러리 견본: public/sample-invoice.jpg(가짜 사업자로 그린 종이 세금계산서)와 그 OCR 상자.
import { paperTaxInvoice } from '../test/fixtures/invoice-boxes';
import type { AccountDevice } from '../src/devices';

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
