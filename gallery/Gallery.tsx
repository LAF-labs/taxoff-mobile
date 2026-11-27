import type { PhoneCopyBody } from '@sax/remote';
import type { PhoneCmd } from '../src/phoneCmd';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { ChatItem } from '../src/chat';
import { SessionContext, useSession, type Session } from '../src/session';
import { MainScreen, type Tab } from '../src/screens/MainScreen';
import type { CustomersPreview } from '../src/screens/CustomersScreen';
import type { DocsPreview } from '../src/screens/DocsScreen';
import type { ReportPreview } from '../src/screens/ReportScreen';
import type { DocItem } from '../src/docs/box';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { UnlockHost } from '../src/screens/UnlockHost';
import { unlockDesk, type UnlockAsk } from '../src/unlock';
import { Banner } from '../src/notify/NotifyHost';
import { AskSheet } from '../src/notify/PushHost';
import { TextSizeHost } from '../src/ui/TextSizeHost';
import { LockScreen } from '../src/screens/LockScreen';
import { PairScreen } from '../src/screens/PairScreen';
import { OnboardingScreen } from '../src/screens/OnboardingScreen';
import type { BioInfo } from '../src/biometry';
import { QueueScreen } from '../src/screens/QueueScreen';
import { InboxScreen } from '../src/screens/InboxScreen';
import { unreadCount, type InboxItem } from '../src/notify/inbox';
import { Shell } from '../src/ui/float';
import { PcPill } from '../src/screens/HomeScreen';
import { counterpartiesOf } from '../src/net/pcCopy';
import { issueCard, type IssuePick, type IssueSheetPreview } from '../src/screens/IssueSheet';
import { QueueProvider, type ApprovalSettings } from '../src/queueStore';
import { ApprovalHost } from '../src/screens/ApprovalHost';
import { buildGate, type GateField, type PhoneGate } from '../src/approval';
import { useEffect } from 'react';
import { useQueue } from '../src/queueStore';
import { RunScreen } from '../src/screens/RunScreen';
import { SimpleAuthSheet, draftOf } from '../src/screens/SimpleAuthSheet';
import { BizRegScreen, type BizRegPreview } from '../src/screens/BizRegScreen';
import { PDF_LINE } from '../src/capture/pick';
import { MoneyProvider, type MarkState, type MoneyStatus } from '../src/moneyStore';
import type { CashFlowResult, MoneySnapshot, ReceivableView } from '../src/money';
import { MoneyListScreen } from '../src/screens/MoneyListScreen';
import { MarkReceivedScreen } from '../src/screens/MarkReceivedScreen';
import { DocScreen, type DocState } from '../src/screens/DocScreen';
import type { IssueResult, RunView } from '../src/run';
import type { DoneJob, Job } from '../src/queue';
import type { Counterparty } from '../src/issue';
import { CashScreen } from '../src/screens/CashScreen';
import { ConnectionScreen } from '../src/screens/ConnectionScreen';
import { CaptureScreen, formFrom, type CapturePreview } from '../src/screens/CaptureScreen';
import { MAX_FONT_SCALE, textScale, usePalette } from '../src/theme';
import { emptyData, type AppData } from '../src/storage/state';
import type { PcStatus } from '../src/net/pc';
import { DEVICES_FULL, DEVICES_NORMAL, DEVICES_SUSPENDED, DEVICE_SELF, SAMPLE_INVOICE, SAMPLE_REPORT, SAMPLE_SHOT, phoneChat } from './samples';
import type { OfflineChatView } from '../src/offline/useOfflineChat';
import { DevicesScreen, type DevicesPreview } from '../src/screens/DevicesScreen';
import { parsePaperInvoice } from '../src/capture/invoice';
import { amendCardNew, amendCardUpdate, amendSourcesOf, type AmendCard as AmendState } from '@sax/chat-core';
import { chatCopyOf } from '../src/net/pcCopy';

const DAY = 86_400_000;
const now = Date.now();
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function paired(): AppData {
  const d = emptyData();
  return {
    ...d,
    lastSeenPc: now - 3 * 60_000,
    recent: [
      { msgId: 'R1', kind: 'tax_invoice', title: '가나식자재', amount: 1_353_000, at: now - 4 * 60_000, state: 'pending' },
      { msgId: 'R2', kind: 'receipt', title: '동네마트 성수점', amount: 12_800, at: now - 3 * 3_600_000, state: 'sent' },
      { msgId: 'R3', kind: 'receipt', title: '영수증', amount: null, at: now - DAY - 600_000, state: 'sent' },
    ],
    cash: [
      { day: iso(today), amount: 184_000, msgId: 'A', state: 'sent' },
      { day: iso(new Date(now - DAY)), amount: 96_500, msgId: 'B', state: 'sent' },
      { day: iso(new Date(now - 2 * DAY)), amount: 0, msgId: 'C', state: 'queued' },
    ],
    pair: {
      pairId: 'p', desktopStatic: '', desktopVd: '', desktopDeviceId: 'dev-01HZX9K2Q4', kvPub: '', aikPub: '', cert: {} as never, certNotAfter: now + 27 * DAY,
      mbxId: '', tokRead: '', tokWrite: '', mbxEpoch: 1, relayHost: 'rooms.tax.laf-co.com', pairedAt: now - 12 * DAY, accountEmail: 'owner@example.com', desktopName: '사무실 PC',
    },
  };
}

function fake(data: AppData, pc: PcStatus, pending = { receipts: 0, cash: 0 }): Session {
  return {
    keys: {} as never, data, outbox: {} as never, pending, pc, syncing: false,
    update: async () => {}, sync: async () => {}, refreshPending: async () => {},
  };
}

const COPY_AT = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0).getTime();
const COPY: PhoneCopyBody = {
  asOf: COPY_AT,
  counterparties: [
    { ref: 'cp_gana', name: '가나식자재', bizNo: '123-45-67891', emailHint: 't***@gana.example', last: { supply: 1_230_000, vatMode: 'excl', item: '식자재', day: iso(new Date(now - 3 * DAY)) } },
    { ref: 'cp_dong', name: '동네마트 성수점', bizNo: '220-81-11111', last: { supply: 480_000, vatMode: 'excl', item: '포장 용기', day: iso(new Date(now - 9 * DAY)) } },
    { ref: 'cp_seoul', name: '서울청과', last: { supply: 2_750_000, vatMode: 'excl', item: '과일 납품', day: iso(new Date(now - 20 * DAY)) } },
    { ref: 'cp_new', name: '한빛인테리어', bizNo: '105-87-22222' },
  ],
  money: {
    asOf: COPY_AT,
    accounts: 2,
    receivable: { unpaidCount: 4, unpaidTotal: 6_820_000, overdueCount: 1, overdueTotal: 1_353_000, dueSoonCount: 2, dueSoonTotal: 3_190_000, reviewCount: 0 },
    payable: { unpaidCount: 3, unpaidTotal: 2_410_000, overdueCount: 0, overdueTotal: 0, dueSoonCount: 1, dueSoonTotal: 880_000, reviewCount: 0 },
    cashflow: { month: iso(today).slice(0, 7), complete: true, inTotal: 12_480_000, outTotal: 9_215_000, net: 3_265_000, in30: 6_820_000, out30: 2_410_000, noDueOutCount: 1, alerts: [] },
  },
};
const copyData = (c: PhoneCopyBody | null = COPY): AppData => ({ ...paired(), pcCopy: c });
const lastOn = (days: number, supply: number, item: string) => ({ supply, vatMode: 'excl' as const, item, day: iso(new Date(now - days * DAY)) });
const COPY_MANY: PhoneCopyBody = {
  asOf: COPY_AT,
  counterparties: [
    { ref: 'cp_gana', name: '가나식자재', bizNo: '123-45-67891', last: lastOn(1, 1_230_000, '식자재') },
    { ref: 'cp_dong', name: '동네마트 성수점', bizNo: '220-81-11111', last: lastOn(3, 480_000, '포장 용기') },
    { ref: 'cp_hanbit', name: '한빛인쇄', bizNo: '105-22-33445', last: lastOn(3, 450_000, '전단 인쇄') },
    { ref: 'cp_seoul', name: '서울청과', bizNo: '211-09-87654', last: lastOn(9, 2_750_000, '과일 납품') },
    { ref: 'cp_mirae', name: '미래포장', bizNo: '314-86-11223', last: lastOn(15, 2_000_000, '포장재') },
    { ref: 'cp_green', name: '그린위생', bizNo: '128-17-99001', last: lastOn(40, 150_000, '방역') },
    { ref: 'cp_dongmart2', name: '동네마트 왕십리점', bizNo: '220-81-22222' },
    { ref: 'cp_spring', name: '새봄꽃집', bizNo: '402-11-55667' },
  ],
};
const issueSheet = (issue: IssueSheetPreview, c: PhoneCopyBody = COPY_MANY, pc: PcStatus = 'online') => ({ session: fake(copyData(c), pc), node: <Main chat={[]} phone={phoneChat('empty')} issue={issue} /> });
const issueCardCase = (pick: IssuePick, pc: PcStatus = 'online') => ({ session: fake(copyData(COPY_MANY), pc), notes: [issueCard(pick, null, now - 30_000)], node: <Main chat={[]} phone={phoneChat('empty')} /> });
const cpOfCopy = (ref: string) => counterpartiesOf(COPY_MANY).find((c) => c.id === ref)!;
const COPY_UNSURE: PhoneCopyBody = {
  ...COPY,
  money: {
    ...COPY.money!,
    cashflow: { month: iso(today).slice(0, 7), complete: false, missing: ['국민 1234'], inTotal: null, outTotal: null, net: null, in30: 6_820_000, out30: null, alerts: [{ id: 'a1', kind: 'slow_collection', text: '가나식자재 입금이 평소보다 늦어지고 있어요(평균 12일 → 31일)' }] },
  },
};
const COPY_NO_ACCT: PhoneCopyBody = { ...COPY, money: { asOf: COPY_AT, accounts: 0, receivable: COPY.money!.receivable, payable: { unpaidCount: 0, unpaidTotal: 0, overdueCount: 0, overdueTotal: 0, dueSoonCount: 0, dueSoonTotal: 0, reviewCount: 0 } } };

const noop = () => {};
const FACE: BioInfo = { kind: 'faceId', enrolled: true };
function Cover() {
  const p = usePalette();
  return <View style={{ flex: 1, backgroundColor: p.canvas }} testID="privacy-cover" />;
}
const at = (h: number, m: number, dayOffset = 0) => {
  const d = new Date(now - dayOffset * DAY);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const chatOn = (d: number): ChatItem[] => [
  { kind: 'msg', id: 'c1', from: 'me', at: at(9, 2, d), text: '어제 가나식자재 세금계산서 발급됐어?' },
  {
    kind: 'msg', id: 'c2', from: 'pc', at: at(9, 2, d), text: '네, 어제 오후 4:12에 발급했고 국세청 전송까지 끝났어요.',
    card: { kind: 'done', title: '가나식자재 세금계산서', rows: [{ label: '작성일', value: '11월 24일' }, { label: '공급가액', value: '1,230,000원' }, { label: '부가세', value: '123,000원' }, { label: '합계', value: '1,353,000원', strong: true }] },
  },
  { kind: 'msg', id: 'c3', from: 'me', at: at(9, 5, d), text: '이번 달 매출 합계 알려줘' },
  {
    kind: 'msg', id: 'c4', from: 'pc', at: at(9, 5, d), text: '11월 1일부터 오늘까지예요.',
    card: { title: '11월 매출', rows: [{ label: '세금계산서 14건', value: '8,420,000원' }, { label: '현금 매출', value: '1,184,500원' }, { label: '합계', value: '9,604,500원', strong: true }], note: '부가세는 PC에서 신고 전에 한 번 더 맞춰 볼게요.' },
  },
];
const CHAT = chatOn(0);
const CHAT_OFFLINE: ChatItem[] = [
  ...CHAT,
  { kind: 'msg', id: 'c5', from: 'me', at: at(11, 40), text: '동네마트에 오늘 날짜로 세금계산서 발급해 줘. 공급가액 320,000원' },
];
const SAMPLE_THUMB = { w: 1520, h: 1040, data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAA0QDQAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb//gAPTGF2YzYzLjEuMTAyAP/bAEMACBAQExATFhYWFhYWGhgaGxsbGhoaGhsbGx0dHSIiIh0dHRsbHR0gICIiJSYlIyMiIyYmKCgoMDAuLjg4OkVFU//EAFQAAAMBAAAAAAAAAAAAAAAAAAABBAcBAQEAAAAAAAAAAAAAAAAAAAABEAEBAAMBAAAAAAAAAAAAAAAAAREh8EERAQEAAAAAAAAAAAAAAAAAAAAR/8AAEQgACwAQAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8A2rEuy7xQEpH/2Q==' };
const CHAT_MERGED: ChatItem[] = [
  ...chatOn(1),
  { kind: 'msg', id: 'm0', from: 'pc', at: at(18, 30, 1), text: '오늘 받은 종이 영수증 3장을 세무사 꾸러미에 넣었어요.' },
  { kind: 'merged', id: 'mg', from: at(8, 10), to: at(9, 40) },
  { kind: 'msg', id: 'm1', from: 'me', at: at(8, 10), card: { title: '영수증 보냄', rows: [{ label: '동네마트 성수점', value: '12,800원' }], photo: { thumb: SAMPLE_THUMB } } },
  { kind: 'msg', id: 'm2', from: 'me', at: at(8, 12), text: '이거 식자재로 넣어 줘' },
  { kind: 'msg', id: 'm3', from: 'pc', at: at(9, 38), text: '식자재(매입)로 넣었어요. 이번 달 식자재 매입은 2,140,000원이에요.' },
  { kind: 'msg', id: 'm4', from: 'me', at: at(9, 40), text: '고마워' },
];

const LONG_PC = ['네, 확인했어요.', '이번 달 발급은 14건이에요. 합계 8,420,000원이에요.', '가나식자재 입금이 평소보다 늦어요. 지난달에는 12일 걸렸는데 이번에는 31일째예요.', '영수증 3장을 세무사 꾸러미에 넣었어요.', '부가세 2기 확정 신고는 1월 25일까지예요.', '동네마트 세금계산서는 PC가 켜지면 바로 발급할게요.'];
const LONG_ME = ['고마워', '이번 달 매출 알려줘', '가나식자재 돈 들어왔어?', '영수증 넣어 줘', '신고 언제까지야?', '동네마트 발급해 줘'];
const longChat = (n: number): ChatItem[] =>
  Array.from({ length: n }, (_, i) => {
    const me = i % 2 === 0;
    const k = Math.floor(i / 2) % 6;
    return { kind: 'msg' as const, id: `L${i}`, from: me ? ('me' as const) : ('pc' as const), at: now - (n - i) * 3 * 60_000, text: `${me ? LONG_ME[k] : LONG_PC[k]} (${i + 1})` };
  });
function LongChat() {
  const gq = new URLSearchParams(typeof location !== 'undefined' && location.search ? location.search : (process.env.EXPO_PUBLIC_GALLERY ?? ''));
  const n = Number(gq.get('n')) || 24;
  const kb = gq.get('kb') ? Number(gq.get('kb')) : undefined;
  const [items, setItems] = useState(() => longChat(n));
  useEffect(() => {
    const w = globalThis as unknown as Record<string, (t: string) => void>;
    const add = (from: 'me' | 'pc') => (text: string) => setItems((x) => [...x, { kind: 'msg', id: `N${x.length}`, from, at: Date.now(), text }]);
    w.__galleryReply = add('pc');
    w.__galleryMine = add('me');
  }, []);
  return <Main chat={items} focusAfter={kb} />;
}


/** 문서함 보기용 가짜 문서(이름과 날짜만). 기준판 폰 문서함과 같은 줄. */
const docDay = (d: number) => iso(new Date(now - d * DAY));
const doc = (n: number, name: string, docType: string, issued: number, expires?: number): DocItem => ({
  docId: `gallery-doc-${String(n).padStart(10, '0')}`, name, docType, issuedOn: docDay(issued), expiresOn: expires === undefined ? null : docDay(expires), bytes: 1, sha256: '',
});
const DOCS: DocItem[] = [
  doc(1, '가나식자재 세금계산서', 'tax_invoice', 0),
  doc(2, '사업자등록증명', 'biz_registration_cert', 4),
  doc(3, '납세증명서', 'national_tax_cert', 6, -24),
  doc(4, '대한테크 세금계산서', 'tax_invoice', 7),
  doc(5, '스마일카페 세금계산서', 'tax_invoice', 25),
  doc(6, '지방세 납세증명서', 'local_tax_cert', 53, 23),
  doc(7, '사무실 임대차계약서', 'other', 54),
];

function Main({ start = 'home', chat, phone, menu, focusAfter, issue, drawer, customers, docs, report }: { start?: Tab; chat?: ChatItem[]; phone?: OfflineChatView; menu?: boolean; focusAfter?: number; issue?: IssueSheetPreview; drawer?: boolean; customers?: CustomersPreview; docs?: DocsPreview; report?: ReportPreview }) {
  const [tab, setTab] = useState<Tab>(start);
  return <MainScreen tab={tab} onTab={setTab} go={noop} chat={chat} phone={phone} menu={menu} focusAfter={focusAfter} issue={issue} drawer={drawer} customers={customers} docs={docs} report={report} />;
}

/** 거래처 100곳(캔버스 "1 거래처 목록 (100곳)"). 이름과 번호는 지어낸 값이다. */
const CP_NAMES = ['가나식자재', '강남인테리어', '김앤리', '나라물산', '대한테크', '대한상사', '동네마트 성수점', '두레농산', '라온디자인', '마루가구', '미래포장', '바다수산', '별빛조명', '부림철강', '새봄꽃집', '서울청과', '스마일카페', '시온약품', '아름인쇄', '오성전기', '우리세탁', '은하여행사', '자연식품', '정다운베이커리', '제일운수', '청솔건설', '초록농원', '태양광테크', '푸른물류', '하나안경', '한빛인쇄', '한울건축', '해담식당', '현대타일', '화성기계', '희망복지'];
const bizOf = (i: number) => {
  const d = String(1_000_000_000 + ((i * 7_919_311) % 8_999_999_999)).slice(0, 9).split('').map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = d.reduce((a, x, k) => a + x * w[k]!, 0);
  sum += Math.floor((d[8]! * 5) / 10);
  const n = `${d.join('')}${(10 - (sum % 10)) % 10}`;
  return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
};
const COPY_100: PhoneCopyBody = {
  asOf: COPY_AT,
  counterparties: Array.from({ length: 100 }, (_, i) => {
    const base = CP_NAMES[i % CP_NAMES.length]!;
    const name = i < CP_NAMES.length ? base : `${base} ${Math.floor(i / CP_NAMES.length) + 1}호점`;
    const ref = `cp_${i}`;
    const c: PhoneCopyBody['counterparties'][number] = { ref, name, bizNo: bizOf(i + 1) };
    if (base === '대한테크' && i < CP_NAMES.length) Object.assign(c, { rep: '김대한', emailHint: 'ta***@daehan.example', item: '유지보수', last: lastOn(7, 3_300_000, '유지보수') });
    else if (base === '가나식자재' && i < CP_NAMES.length) Object.assign(c, { rep: '이가나', item: '식자재', last: lastOn(0, 1_230_000, '식자재') });
    else if (base === '스마일카페' && i < CP_NAMES.length) Object.assign(c, { state: 'closed', stateOn: iso(new Date(now - 21 * DAY)), last: lastOn(1, 220_000, '원두') });
    else if (i % 3 === 0) c.last = lastOn(10 + i, 100_000 * (1 + (i % 9)), '납품');
    return c;
  }),
  issued: Array.from({ length: 30 }, (_, k) => ({ ref: 'cp_4', name: '대한테크', day: iso(new Date(now - (7 + 30 * k) * DAY)), total: k % 3 === 2 ? 3_300_000 : 3_630_000 })),
};
const cust = (customers: CustomersPreview, c: PhoneCopyBody | null = COPY_100, data = copyData(c)) => ({ session: fake(data, 'online'), node: <Main start="customers" customers={customers} /> });
/** 맨 위 화면을 따로 띄울 때 더보기와 PC 상태를 붙인다(미리 보기 값을 넘기는 설정 화면용). */
function InShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const right = s.data.pair ? <PcPill pc={s.pc} lastSeen={s.data.lastSeenPc} onPress={noop} /> : null;
  return <Shell.Provider value={{ onMenu: noop, badge: unreadCount(s.data.inbox, s.data.inboxSeenAt) > 0, right }}>{children}</Shell.Provider>;
}
const read = parsePaperInvoice(SAMPLE_INVOICE, today)!;

const CPS: Counterparty[] = [
  { id: 'ga', name: '가나식자재', bizNo: '123-45-67890', lastSupply: 1_230_000, lastItem: '식자재', lastAt: now - 1 * DAY, issued: 12 },
  { id: 'dm', name: '동네마트 성수점', bizNo: '220-81-12345', lastSupply: 320_000, lastItem: '생활용품', lastAt: now - 3 * DAY, issued: 4 },
  { id: 'hb', name: '한빛인쇄', bizNo: '105-22-33445', lastSupply: 450_000, lastItem: '전단 인쇄', lastAt: now - 6 * DAY, issued: 2 },
  { id: 'sc', name: '서울청과', bizNo: '211-09-87654', lastSupply: 800_000, lastItem: '과일', lastAt: now - 9 * DAY, issued: 7 },
  { id: 'mr', name: '미래포장', bizNo: '314-86-11223', lastSupply: 2_000_000, lastItem: '포장재', lastAt: now - 15 * DAY, issued: 3 },
  { id: 'gw', name: '그린위생', bizNo: '128-17-99001', lastSupply: 150_000, lastItem: '방역', lastAt: now - 40 * DAY, issued: 1 },
  { id: 'sb', name: '새봄꽃집', bizNo: '402-11-55667', issued: 0 },
];

const H = 3_600_000;
const JOBS: Job[] = [
  { id: 'j1', title: '가나식자재 세금계산서', amount: 1_353_000, createdAt: now - 2 * H, state: 'confirmStart' },
  { id: 'j2', title: '서울청과 세금계산서', amount: 880_000, createdAt: now - 3 * H, state: 'confirmStart' },
  { id: 'j3', title: '한빛인쇄 세금계산서', amount: 495_000, createdAt: now - 26 * H, state: 'approval' },
  { id: 'j4', title: '새봄꽃집 세금계산서', amount: 330_000, createdAt: now - 5 * H, state: 'needPc', reason: 'firstCounterparty' },
  { id: 'j5', title: '그린위생 세금계산서', amount: 165_000, createdAt: now - 6 * H, state: 'needPc', reason: 'dailyLimit' },
  { id: 'j6', title: '미래포장 세금계산서', amount: 2_200_000, createdAt: now - 30 * H, state: 'verify' },
  { id: 'j7', title: '동네마트 성수점 세금계산서', amount: 352_000, createdAt: now - 1 * H, state: 'running' },
  { id: 'j8', title: '동네마트 성수점 세금계산서', amount: 110_000, createdAt: now - 4 * H, state: 'entrusted' },
  { id: 'j9', title: '가나식자재 세금계산서', amount: 220_000, createdAt: now - 4 * H + 60_000, state: 'phoneWaiting' },
  { id: 'j10', title: '서울청과 세금계산서', amount: 440_000, createdAt: now - 80 * H, state: 'entrusted' },
];
const LAST_DONE: DoneJob = { title: '가나식자재 세금계산서', finishedAt: at(9, 12) };

const RB = {
  supplierBizNo: '123-45-67890', supplierName: '택스오프상회', counterpartBizNo: '211-09-87654', counterpartName: '서울청과',
  counterpartEmail: 'tax@seoulfruit.example', itemName: '과일', itemCount: '1', supplyAmount: '800000', taxAmount: '80000', totalAmount: '880000',
  issueDate: iso(today), remark: '', receiptType: '청구',
};
const LONG = {
  ...RB, counterpartName: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점', counterpartBizNo: '402-11-55667',
  counterpartEmail: 'very.long.address.for.invoices@flower-garden-service.example', itemName: '사무실 화분 관리(11월분) 및 계절 꽃 교체',
  supplyAmount: '12300000', taxAmount: '1230000', totalAmount: '13530000',
};
const NO_FIRST: GateField[] = [{ key: '$first.bizNo', value: 'false' }, { key: '$first.email', value: 'false' }];
const gate = (o: { rb?: typeof RB; reserved?: GateField[]; left?: number; tamper?: boolean } = {}): PhoneGate => {
  const g = buildGate({
    readback: o.rb ?? RB, reserved: o.reserved ?? NO_FIRST, packageDigest: 'ab'.repeat(32), authorizes: ['s21'], intentId: '01JD8Z6Q3B9K2M4N5P7R8S9T0V',
    reqId: '01JD0000000000000000000000', challenge: 'A'.repeat(43) + '=', exp: now + (o.left ?? 118_000),
  });
  return o.tamper ? { ...g, fields: g.fields.map((f) => (f.key === 'totalAmount' ? { ...f, value: '8800000' } : f)) } : g;
};
const HW: ApprovalSettings = { attest: 'hw', iosAllowed: true, usedToday: 1 };
const sheetCase = (g: PhoneGate, o: { settings?: ApprovalSettings; openedAt?: number; state?: Job['state']; acked?: string[] } = {}) => ({
  session: fake(paired(), 'online'),
  jobs: [{ id: 'ap', title: `${g.fields.find((f) => f.key === 'counterpartName')!.value} 세금계산서`, amount: Number(g.fields.find((f) => f.key === 'totalAmount')!.value), createdAt: now - 60_000, state: o.state ?? ('approval' as const), gate: g }, ...JOBS.slice(6, 8)],
  sheet: 'ap',
  approval: o.settings ?? HW,
  sheetPreview: { now, openedAt: o.openedAt ?? now - 5_000, acked: o.acked },
  node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} />,
});

const INBOX: InboxItem[] = [
  { id: 'i1', at: at(15, 12), kind: 'approve', title: '승인을 기다리는 발급이 있어요', line: '가나식자재 세금계산서, 1,353,000원', jobId: 'ap' },
  { id: 'i2', at: at(14, 40), kind: 'done', title: '세금계산서를 발급했어요', line: '대한테크 세금계산서', jobId: 'r2' },
  { id: 'i3', at: at(11, 5), kind: 'myTurn', title: '내 차례예요', line: '스마일카페 세금계산서. 간편인증을 승인해 주세요', jobId: 'r3' },
  { id: 'i4', at: at(18, 20, 1), kind: 'stopped', title: '발급을 멈췄어요', line: '김앤리 세금계산서. 아무것도 발급하지 않았어요', jobId: 'r4' },
  { id: 'i5', at: at(9, 0, 1), kind: 'money', title: '이번 주 오갈 돈이 있어요', line: '7일 안에 받을 돈 3건' },
];

const RES: IssueResult = {
  approvalNo: '20261116-41000000-12345678', counterpart: '가나식자재', total: 1_353_000, email: 'tax@gana.example', emailSent: true, issuedAt: now - 60_000,
  doc: { name: '세금계산서_가나식자재_20261116.pdf', issuedOn: iso(today), uri: '' },
};
const RES_LONG: IssueResult = {
  ...RES, counterpart: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점', total: 13_530_000, email: 'very.long.address.for.invoices@flower-garden-service.example',
  doc: { name: '세금계산서_주식회사새봄꽃과정원관리서비스성수동본점_20261116.pdf', issuedOn: iso(today), uri: '' },
};
const runJob = (run: RunView, o: { title?: string; amount?: number; state?: Job['state'] } = {}): Job => ({
  id: 'r1', title: o.title ?? '가나식자재 세금계산서', amount: o.amount ?? 1_353_000, createdAt: now - 3 * 60_000, state: o.state ?? (run.kind === 'done' ? 'done' : run.kind === 'inDoubt' || run.kind === 'verify' ? 'verify' : 'running'), run,
});
const T0 = now - 80_000;
const runCase = (run: RunView, o: { title?: string; amount?: number } = {}) => ({
  session: fake(paired(), 'online'), jobs: [runJob(run, o)], focus: 'r1', node: <RunScreen onDone={noop} onDoc={noop} onRecords={noop} now={now} />,
});
const CMD = (o: Partial<PhoneCmd> = {}): PhoneCmd => ({
  cmdId: 'G1', req: { counterpartyRef: 'cp_gana', supply: 1_230_000, tax: 123_000, item: '식자재', day: iso(today) }, cpName: '가나식자재', total: 1_353_000,
  createdAt: now - 90_000, sentAt: now - 88_000, ack: 'pc_only', runId: 'run1', at: now - 5_000, ...o,
});
const APPROVE_CMD = () =>
  CMD({ phase: 'approve', ack: 'accepted', cpName: '서울청과', total: 880_000, gate: { ...gate({ left: 8 * 60_000 }), stepId: 's21' } });
const pcRun = (o: Partial<PhoneCmd>) => ({
  session: fake({ ...copyData(), cmds: [CMD(o)] }, 'online'), focus: 'cmd-G1', node: <RunScreen onDone={noop} onDoc={noop} onRecords={noop} now={now} />,
});
const simpleSheet = (start?: Parameters<typeof SimpleAuthSheet>[0]['start'], remembered?: Parameters<typeof SimpleAuthSheet>[0]['remembered'], failed?: boolean) => ({
  session: fake({ ...copyData(), cmds: [CMD({ phase: 'login', turn: true, code: 'login.simple_auth', simpleReq: '01JD0000000000000000000000' })] }, 'online'),
  notes: [{ kind: 'run' as const, id: 'run-cmd-G1', at: now - 90_000, jobId: 'cmd-G1' }],
  node: (
    <>
      <Main chat={CHAT} />
      <SimpleAuthSheet remembered={remembered} failed={failed} onSend={noop} onClose={noop} start={start} />
    </>
  ),
});
// PC 잠금 풀기(ADR-061): 갤러리는 한 장씩 열리므로 그 장을 그릴 때 요청 하나를 넣어 둔다.
const unlockAsk = (scope: UnlockAsk['scope'], hidden = false): void => {
  const a: UnlockAsk = { unlockId: `gallery-${scope}-unlock-00`.slice(0, 22), scope, pcName: '맥북 에어', pcDeviceId: 'pc-gallery', phoneDeviceId: 'phone-gallery', e: new Uint8Array(65), txPub: new Uint8Array(32), n: new Uint8Array(32), until: Date.now() + 3_600_000 };
  unlockDesk.offer(a);
  if (hidden) unlockDesk.hide(a.unlockId);
};
const unlockCase = (scope: UnlockAsk['scope']) => {
  unlockAsk(scope);
  return {
    session: fake({ ...copyData(), cmds: scope === 'remote' ? [CMD({ phase: 'prepare' })] : [] }, 'online'),
    notes: scope === 'remote' ? [{ kind: 'run' as const, id: 'run-cmd-G1', at: now - 20_000, jobId: 'cmd-G1' }] : undefined,
    node: (
      <>
        <Main chat={CHAT} />
        <UnlockHost bioPreview={FACE} />
      </>
    ),
  };
};
const docCase = (state: DocState, result = RES) => ({
  session: fake(paired(), state.kind === 'pcOff' ? 'offline' : 'online'), jobs: [runJob({ kind: 'done', result, startedAt: T0 })], focus: 'r1', node: <DocScreen onDone={noop} state={state} />,
});

const BIZ_SHOT = { uri: '/sample-bizreg.jpg', width: 1140, height: 1608 };
const BIZ_VALUES = { name: '동네마트 성수점', bizNo: '220-81-12341', ceo: '김견본', address: '서울특별시 성동구 성수이로 00, 1층', bizType: '도매 및 소매업', item: '생활용품', email: '' };
const HIGH = { name: 0.9, bizNo: 0.95, ceo: 0.9, address: 0.85, bizType: 0.85, item: 0.85 };
const biz = (pv: Partial<BizRegPreview>, existing: Counterparty[] = CPS) => ({
  session: fake(paired(), 'online'),
  node: <BizRegScreen existing={existing} onDone={noop} onSaved={noop} onUseExisting={noop} preview={{ phase: 'confirm', shot: BIZ_SHOT, values: BIZ_VALUES, conf: HIGH, ...pv }} />,
});

const dayOff = (n: number) => iso(new Date(now + n * DAY));
const rv = (id: string, cpName: string, total: number, writtenAgo: number, dueIn: number | null, o: Partial<ReceivableView> = {}): ReceivableView => ({
  id, counterpartyId: null, cpName, cpBizNo: null, item: null, approvalTail: null, writtenOn: dayOff(-writtenAgo), total, received: 0, remaining: total,
  dueOn: dueIn === null ? null : dayOff(dueIn), promisedOn: null, dueIn, overdue: dueIn !== null && dueIn < 0, status: 'unpaid', via: null, offAccount: null, sources: ['hometax'], excludedReason: null, ...o,
});
const RECV = [
  rv('rc1', '가나식자재', 1_353_000, 52, -22),
  rv('rc2', '서울청과', 880_000, 40, -10),
  rv('rc3', '한빛인쇄', 495_000, 25, 5),
  rv('rc4', '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점', 13_530_000, 20, 10),
  rv('rc5', '미래포장', 2_200_000, 12, 18, { received: 1_000_000, remaining: 1_200_000, status: 'partial' }),
  rv('rc6', '그린위생', 165_000, 8, null),
];
const PAY = [
  rv('py1', '동네마트 성수점', 352_000, 30, -3),
  rv('py2', '서울청과', 440_000, 10, 4),
  rv('py3', '한빛인쇄', 1_100_000, 6, 20),
  rv('py4', '미래포장', 280_000, 3, null),
];
const sum = (xs: ReceivableView[]) => xs.reduce((a, v) => a + v.remaining, 0);
const open = (xs: ReceivableView[]) => xs.filter((v) => v.status !== 'received');
const over = (xs: ReceivableView[]) => open(xs).filter((v) => v.overdue);
const soon = (xs: ReceivableView[]) => open(xs).filter((v) => !v.overdue && v.dueIn !== null && v.dueIn <= 7);
const cashflow = (o: { inT: number; outT: number; complete?: boolean; hasAccounts?: boolean; alerts?: CashFlowResult['alerts']; missingDays?: number }): CashFlowResult => ({
  month: {
    month: iso(today).slice(0, 7), from: `${iso(today).slice(0, 7)}-01`, to: iso(today), complete: o.complete ?? true, hasAccounts: o.hasAccounts ?? true,
    missing: o.complete === false ? [{ accountId: 'a2', last4: '5521', bank: '국민', coverTo: dayOff(-(o.missingDays ?? 9)) }] : [],
    cash: { in: { total: o.inT, by: {} }, out: { total: o.outT, by: {} }, net: o.inT - o.outT, excluded: 0 },
    accrual: { salesInvoices: 0, cashSales: null, purchaseInvoices: 0, card: null, receipts: 0, payroll: null }, collectionRate: null,
    unknown: { inTotal: 0, outTotal: 0, inCount: 0, outCount: 0, topIds: [] },
  },
  snapshot: {
    today: iso(today), balance: { total: 8_400_000, partial: false, accounts: [] },
    next30: { payOut: 1_820_000, payOverdue: 352_000, payIn: 18_420_000, noDuePay: 1, noDueRecv: 1 },
    aging: { notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0, unknown: 0 }, collectDays: { overall: null, byCounterparty: [] }, payDays: null,
    concentration: { months: [], invoiceCount: 0, top1: null, top3Share: null },
  },
  alerts: o.alerts ?? [],
});
const snapOf = (recv: ReceivableView[], pay: ReceivableView[], cf: CashFlowResult, o: { at?: number; accounts?: number } = {}): MoneySnapshot => ({
  at: o.at ?? at(9, 10), accounts: o.accounts ?? 2, receivables: recv, payables: pay, cashflow: cf,
  summary: {
    today: iso(today), latestDay: iso(today), stale: !cf.month.complete, hasAccounts: cf.month.hasAccounts,
    unpaidCount: open(recv).length, unpaidTotal: sum(open(recv)), overdueCount: over(recv).length, overdueTotal: sum(over(recv)), oldestOverdue: null, reviewCount: 0, autoCount: 0,
    payable: { unpaidCount: open(pay).length, unpaidTotal: sum(open(pay)), overdueCount: over(pay).length, overdueTotal: sum(over(pay)), dueSoonCount: soon(pay).length, dueSoonTotal: sum(soon(pay)), reviewCount: 0 },
  },
});
const MONEY_OK = snapOf(RECV, PAY, cashflow({ inT: 18_420_000, outT: 12_950_000 }));
const RECV_LATE = [
  ...RECV.map((v, i) => (i < 4 ? { ...v, dueIn: -15 - i * 9, dueOn: dayOff(-15 - i * 9), overdue: true } : v)),
  rv('rc7', '동쪽건설', 98_000_000, 120, -90),
  rv('rc8', '바른식품', 3_300_000, 70, -40),
];
const MONEY_LATE = snapOf(RECV_LATE, PAY, cashflow({ inT: 4_120_000, outT: 15_880_000, alerts: [{ id: 's1', kind: 'slowdown', counterpartyKey: 'k', cpName: '가나식자재', priorDays: 32, recentDays: 51 }] }));
const MONEY_SHORT = snapOf(RECV, PAY, cashflow({ inT: 6_200_000, outT: 9_400_000, alerts: [{ id: 'f1', kind: 'shortfall', gap: 1_240_000 }] }));
const MONEY_UNSURE = snapOf(RECV.map((v, i) => (i === 1 ? { ...v, status: 'unknown' as const } : v)), PAY, cashflow({ inT: 6_200_000, outT: 9_400_000, complete: false }));
const MONEY_LAST = snapOf(RECV, PAY, cashflow({ inT: 18_420_000, outT: 12_950_000 }), { at: at(18, 20, 1) });
const MONEY_NOACCT = snapOf(RECV, [], cashflow({ inT: 0, outT: 0, hasAccounts: false }), { accounts: 0 });
const MARKS: Record<string, MarkState> = { rc1: { kind: 'done', seq: 101, method: 'cash', amount: 1_353_000 }, rc2: { kind: 'queued' }, rc3: { kind: 'already' } };
const money = (snap: MoneySnapshot | null, o: { status?: MoneyStatus; live?: boolean; pc?: PcStatus; start?: 'list' | 'pay' | 'mark'; marks?: Record<string, MarkState> } = {}) => ({
  session: fake(o.pc && o.pc !== 'online' ? { ...paired(), lastSeenPc: now - 15 * H } : paired(), o.pc ?? 'online'),
  money: { status: o.status ?? (snap ? 'ready' : 'none'), snap, live: o.live ?? true, marks: o.marks, focus: o.start === 'mark' ? 'rc1' : null },
  node:
    o.start === 'list' ? <MoneyListScreen kind="recv" onDone={noop} onMark={noop} /> : o.start === 'pay' ? <MoneyListScreen kind="pay" onDone={noop} onMark={noop} /> : o.start === 'mark' ? <MarkReceivedScreen onDone={noop} /> : <Main start="money" />,
});

function Demo() {
  const q = useQueue();
  useEffect(() => {
    q.add({ id: 'demo', title: '가나식자재 세금계산서', amount: 1_353_000, createdAt: Date.now(), state: 'running' }, '', {
      supplierBizNo: '', supplierName: '', counterpartBizNo: '123-45-67891', counterpartName: '가나식자재', counterpartEmail: 'tax@gana.example', itemName: '식자재', itemCount: '1',
      supplyAmount: '1230000', taxAmount: '123000', totalAmount: '1353000', issueDate: iso(today), remark: '', receiptType: '청구',
    });
  }, []);
  return <Main chat={CHAT} />;
}

const devices = (load: DevicesPreview['load']) => ({
  session: fake(paired(), 'online'),
  node: <DevicesScreen onDone={noop} onReset={noop} onPair={noop} preview={{ load, selfId: DEVICE_SELF }} />,
});

// 수정세금계산서(ADR-058) 장면: 사본 발급 줄(amend.v1)과 그 줄로 만든 수정 카드
const AMEND_COPY: PhoneCopyBody = {
  ...COPY_MANY,
  counterparties: [...COPY_MANY.counterparties, { ref: 'cp_daehan', name: '대한테크', bizNo: '120-87-12345', last: lastOn(7, 3_300_000, '유지보수') }],
  issued: [
    { ref: 'cp_daehan', name: '대한테크', day: iso(new Date(now - 7 * DAY)), total: 3_630_000, approvalNo: '20261117-41000000-00000117', supply: 3_300_000, tax: 330_000, item: '유지보수', wrtDay: iso(new Date(now - 7 * DAY)) },
    { ref: 'cp_daehan', name: '대한테크', day: iso(new Date(now - 14 * DAY)), total: 1_650_000, approvalNo: '20261110-41000000-00000110', supply: 1_500_000, tax: 150_000, item: '부품', wrtDay: iso(new Date(now - 14 * DAY)) },
    { ref: 'cp_gana', name: '가나식자재', day: iso(new Date(now - 12 * DAY)), total: 1_353_000, approvalNo: '20261112-41000000-00000112', supply: 1_230_000, tax: 123_000, item: '식자재', wrtDay: iso(new Date(now - 12 * DAY)), adjSupply: -500_000, adjTax: -50_000 },
    { ref: 'cp_gana', name: '가나식자재', day: iso(new Date(now - 5 * DAY)), total: -550_000, approvalNo: '20261119-41000000-00000119', supply: -500_000, tax: -50_000, item: '식자재', amendOf: '20261112-41000000-00000112' },
    { ref: 'cp_seoul', name: '서울청과', day: iso(new Date(now - 14 * DAY)), total: 605_000, approvalNo: '20261110-41000000-00000210', supply: 550_000, tax: 55_000, item: '과일 납품', amendState: 'cancelled' },
    { ref: 'cp_mirae', name: '미래포장', day: iso(new Date(now - 19 * DAY)), total: 1_100_000, approvalNo: '20261105-41000000-00000105', supply: 1_000_000, tax: 100_000, item: '포장재', amendState: 'replaced' },
  ],
};
const amendSrc = (no?: string) => {
  const c = chatCopyOf(AMEND_COPY)!;
  return amendSourcesOf(c, (c.issued ?? []).filter((r) => (no ? r.approvalNo === no : r.counterpartyId === 'cp_daehan')));
};
const amendCard = (o: { no?: string; what?: AmendState['what']; said?: Parameters<typeof amendCardNew>[1] } = {}): AmendState => {
  let c = amendCardNew(amendSrc(o.no), o.said ?? {}, iso(today));
  if (o.no && o.what) c = amendCardUpdate(c, { what: o.what });
  return c;
};
const amendMsg = (id: string, me: string, card: AmendState, m: number): ChatItem[] => [
  { kind: 'msg', id: `${id}m`, from: 'me', at: now - m * 60_000, text: me },
  { kind: 'msg', id: `${id}r`, from: 'pc', via: 'phone', at: now - m * 60_000, text: '고칠 계산서를 카드로 띄웠어요.' },
  { kind: 'msg', id, from: 'pc', via: 'phone', at: now - m * 60_000, card: { title: card.view.title, rows: [], amend: { id: `${id}a`, card } } },
];
function AmendChat({ items: first, start }: { items: ChatItem[]; start?: Tab }) {
  const [items, setItems] = useState(first);
  const phone: OfflineChatView = {
    available: true, busy: false, chips: [], items, send: async () => {}, retry: async () => {}, react: async () => {},
    update: async (it) => setItems((xs) => (xs.some((x) => x.id === it.id) ? xs.map((x) => (x.id === it.id ? it : x)) : [...xs, it])),
  };
  return <Main chat={[]} phone={phone} start={start} />;
}
const D117 = '20261117-41000000-00000117';
const amendScene = (items: ChatItem[], start?: Tab) => ({ session: fake(copyData(AMEND_COPY), 'online'), approval: HW, node: <AmendChat items={items} start={start} /> });
const AMEND_GATE = () => {
  const g = buildGate({
    readback: { ...RB, counterpartName: '대한테크', counterpartBizNo: '1208712345', itemName: '유지보수', supplyAmount: '-3300000', taxAmount: '-330000', totalAmount: '-3630000' },
    reserved: [...NO_FIRST, { key: '$amend.what', value: 'deal_cancelled' }, { key: '$amend.original', value: D117 }],
    packageDigest: 'ab'.repeat(32), authorizes: ['s21'], intentId: '01JD8Z6Q3B9K2M4N5P7R8S9T0V', reqId: '01JD0000000000000000000000', challenge: 'A'.repeat(43) + '=', exp: now + 8 * 60_000,
  });
  return { ...g, stepId: 's21' };
};

const SCREENS: Record<
  string,
  () => {
    session: Session; node: React.ReactNode; jobs?: Job[]; last?: DoneJob; notes?: ChatItem[]; sheet?: string; approval?: ApprovalSettings;
    sheetPreview?: { now: number; openedAt: number; acked?: string[] }; focus?: string; simulate?: boolean | 'inDoubt';
    money?: { status: MoneyStatus; snap: MoneySnapshot | null; live: boolean; marks?: Record<string, MarkState>; focus?: string | null };
  }
> = {
  'bizreg-camera': () => ({ session: fake(paired(), 'online'), node: <BizRegScreen existing={CPS} onDone={noop} onSaved={noop} onUseExisting={noop} /> }),
  'bizreg-camera-denied': () => ({ session: fake(paired(), 'online'), node: <BizRegScreen existing={CPS} onDone={noop} onSaved={noop} onUseExisting={noop} preview={{ phase: 'camera', denied: true }} /> }),
  'bizreg-album': () => biz({ fromAlbum: true }),
  'bizreg-pdf': () => ({ session: fake(paired(), 'online'), node: <BizRegScreen existing={CPS} onDone={noop} onSaved={noop} onUseExisting={noop} preview={{ phase: 'camera', err: PDF_LINE }} /> }),
  'receipt-album': () => ({
    session: fake(paired(), 'online'),
    node: <CaptureScreen onDone={noop} preview={{ phase: 'confirm', docMode: 'receipt', shot: SAMPLE_SHOT, fromAlbum: true, receipt: { amount: '12,800', issuedOn: iso(today), merchant: '동네마트 성수점', bizNo: '' }, engine: 'ios_vision' }} />,
  }),
  'bizreg-confirm': () => biz({ values: { ...BIZ_VALUES, email: 'tax@dongne.example' } }),
  'bizreg-email-empty': () => biz({}),
  'bizreg-low-conf': () => biz({ conf: { ...HIGH, ceo: 0.4, address: 0.5 } }),
  'bizreg-checksum': () => biz({ values: { ...BIZ_VALUES, bizNo: '220-81-12345' }, conf: { ...HIGH, bizNo: 0.4 } }),
  'bizreg-blurry': () => biz({ poor: true, values: { ...BIZ_VALUES, name: '', ceo: '', address: '', bizType: '', item: '', bizNo: '220-81-1' }, conf: {} }),
  'bizreg-existing': () => biz({}, [...CPS, { id: 'dm2', name: '동네마트 성수점', bizNo: '220-81-12341', issued: 4, lastAt: now - 3 * DAY }]),
  'bizreg-long': () => biz({
    values: { name: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점', bizNo: '105-22-12346', ceo: '이견본', address: '서울특별시 성동구 왕십리로 000, 새봄빌딩 3층 301호(성수동2가, 새봄꽃과정원관리서비스)', bizType: '서비스업', item: '조경관리 및 실내 식물 관리', email: 'very.long.address.for.invoices@flower-garden-service.example' },
  }),
  'run-prepare': () => runCase({ kind: 'running', step: 'prepare', startedAt: now - 12_000 }),
  'run-login': () => runCase({ kind: 'running', step: 'login', startedAt: now - 35_000 }),
  'run-readback': () => runCase({ kind: 'running', step: 'readback', startedAt: T0 }),
  'run-issue': () => runCase({ kind: 'running', step: 'issue', startedAt: now - 140_000 }),
  'run-verify-step': () => runCase({ kind: 'running', step: 'verify', startedAt: now - 150_000 }),
  'run-simple-auth': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크' }, startedAt: now - 50_000 }),
  'run-simple-auth-left': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크', deadline: now + 130_000 }, startedAt: now - 50_000 }),
  'run-simple-auth-timeout': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크', deadline: now - 1_000 }, startedAt: now - 200_000 }),
  'docs-list': () => ({ session: fake(paired(), 'online'), node: <Main start="docs" docs={{ items: DOCS }} /> }),
  'docs-opening': () => ({ session: fake(paired(), 'online'), node: <Main start="docs" docs={{ items: DOCS, busy: DOCS[0]!.docId }} /> }),
  'docs-failed': () => ({ session: fake(paired(), 'online'), node: <Main start="docs" docs={{ items: DOCS, failed: true }} /> }),
  'docs-empty': () => ({ session: fake(paired(), 'online'), node: <Main start="docs" docs={{ items: [] }} /> }),
  'records-list': () => ({ session: fake(paired(), 'online'), jobs: [runJob({ kind: 'done', result: RES, startedAt: T0 }), { ...runJob({ kind: 'done', result: { ...RES_LONG, approvalNo: '20261115-41000000-87654321', doc: { ...RES_LONG.doc, issuedOn: iso(new Date(now - DAY)) } }, startedAt: T0 - DAY }), id: 'r2', createdAt: now - DAY }], node: <Main start="records" /> }),
  'run-simple-auth-unknown': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '○○은행' }, startedAt: now - 50_000 }),
  'run-cert': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'cert' }, startedAt: now - 40_000 }),
  'run-stop-blocked': () => runCase({ kind: 'stopped', step: 'login', reason: 'blocked', startedAt: T0 }),
  'run-stop-blocked-reserved': () => runCase({ kind: 'stopped', step: 'login', reason: 'blocked', startedAt: T0, reserved: true }),
  'run-stop-unknown-screen': () => runCase({ kind: 'stopped', step: 'readback', reason: 'unknownScreen', startedAt: T0 }),
  'run-stop-date': () => runCase({ kind: 'stopped', step: 'readback', reason: 'dateMismatch', startedAt: T0 }),
  'run-stop-input': () => runCase({ kind: 'stopped', step: 'readback', reason: 'inputMismatch', startedAt: T0 }),
  'run-in-doubt': () => runCase({ kind: 'inDoubt', tries: 3, startedAt: now - 200_000 }),
  'run-verify-needed': () => runCase({ kind: 'verify', startedAt: now - 600_000 }),
  'run-pc-prepare': () => pcRun({ ack: undefined, runId: undefined, at: undefined }),
  'run-pc-readback': () => pcRun({ phase: 'readback' }),
  'run-pc-approve': () => pcRun({ phase: 'approve' }),
  'run-pc-in-doubt': () => pcRun({ phase: 'verify', code: 'in_doubt', attempt: 2 }),
  'run-pc-stopped': () => pcRun({ phase: 'stopped' }),
  'run-pc-turn-simple': () => pcRun({ phase: 'login', turn: true, code: 'login.simple_auth' }),
  'run-pc-turn-other': () => pcRun({ phase: 'readback', turn: true, code: 'turn.other' }),
  'run-pc-turn-choice': () => pcRun({ phase: 'login', turn: true, code: 'login.simple_auth', simpleReq: '01JD0000000000000000000000' }),
  'unlock-sheet': () => unlockCase('screen'),
  'unlock-remote': () => unlockCase('remote'),
  'settings-unlock': () => {
    unlockAsk('screen', true);
    return { session: fake(paired(), 'online'), node: <SettingsScreen onDone={noop} onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="granted" /> };
  },
  'simple-sheet-app': () => simpleSheet({ step: 'app' }),
  'simple-sheet-carrier': () => simpleSheet({ step: 'carrier', draft: { ...draftOf(null), provider: 'pass' } }),
  'simple-sheet-name': () => simpleSheet({ step: 'name', draft: { ...draftOf(null), provider: 'kakao', name: '김가' } }),
  'simple-sheet-phone': () => simpleSheet({ step: 'phone', draft: { ...draftOf(null), provider: 'kakao', name: '김가나', birth: '1984-03-12', phone: '010-1234-56' } }),
  'simple-sheet-confirm': () => simpleSheet(undefined, { provider: 'kakao', name: '김가나', birth: '19840312', phone: '01012345678' }),
  'simple-sheet-failed': () => simpleSheet({ step: 'app', draft: { ...draftOf(null), provider: 'kakao' } }, null, true),
  'run-pc-turn-choice-failed': () => pcRun({ phase: 'login', turn: true, code: 'login.simple_auth', simpleReq: '01JD0000000000000000000000', simpleFailed: true }),
  'run-pc-simple-wait': () => pcRun({ phase: 'login', turn: true, code: 'login.simple_sent.kakao', simpleApp: 'kakao', simpleReq: '01JD0000000000000000000000', deadline: now + 248_000 }),
  'run-pc-simple-timeout': () => pcRun({ phase: 'login', turn: true, code: 'login.simple_sent.kakao', simpleApp: 'kakao', simpleReq: '01JD0000000000000000000000', deadline: now - 1_000 }),
  'home-chat-pc-turn': () => ({
    session: fake({ ...copyData(), cmds: [CMD({ phase: 'login', turn: true, code: 'login.simple_auth', simpleReq: '01JD0000000000000000000000' })] }, 'online'),
    notes: [{ kind: 'run', id: 'run-cmd-G1', at: now - 90_000, jobId: 'cmd-G1' }],
    node: <Main chat={CHAT} />,
  }),
  'queue-pc-turn': () => ({ session: fake({ ...copyData(), cmds: [CMD({ phase: 'login', turn: true, code: 'login.simple_auth' })] }, 'online'), node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  'run-pc-done': () => pcRun({ phase: 'done', result: { approvalNo: '20261117-41000000-12345678', total: 1_353_000, emailSent: true } }),
  'run-pc-refused': () => pcRun({ ack: 'rejected', reason: 'counterparty_unknown', runId: undefined }),
  'run-pc-busy': () => pcRun({ ack: 'rejected', reason: 'pc_busy', runId: undefined }),
  'run-pc-old': () => pcRun({ ack: undefined, pcOld: true, runId: undefined }),
  'home-chat-pc-approve': () => ({
    session: fake({ ...copyData(), cmds: [APPROVE_CMD()] }, 'online'),
    approval: HW,
    node: <Main chat={CHAT} />,
  }),
  'queue-approve-card': () => ({
    session: fake({ ...copyData(), cmds: [APPROVE_CMD()] }, 'online'),
    approval: HW,
    node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} />,
  }),
  'amend-which': () => amendScene(amendMsg('aw', '대한테크 계산서 고쳐야 해', amendCard(), 1)),
  'amend-what': () => amendScene(amendMsg('at', '대한테크 지난주 계산서 고쳐야 해', amendCard({ no: D117 }), 1)),
  'amend-wrong': () => amendScene(amendMsg('ar', '대한테크 지난주 계산서 300만원인데 330으로 나갔어', amendCard({ no: D117, what: 'wrong_entry', said: { supply: 3_000_000, tax: 300_000 } }), 1)),
  'amend-changed': () => amendScene(amendMsg('ac', '대한테크 지난주 거 30만원 깎아 줬어', amendCard({ no: D117, what: 'amount_changed', said: { supply: 300_000, tax: 30_000, delta: true } }), 1)),
  'amend-returned': () => amendScene(amendMsg('an', '가나식자재 5만원어치 반품 들어왔어', amendCard({ no: '20261112-41000000-00000112', what: 'returned', said: { supply: 50_000, tax: 5_000, delta: true } }), 1)),
  'amend-cancel': () => amendScene(amendMsg('ax', '대한테크 계약 깨졌어. 지난주 계산서 취소해줘', amendCard({ no: D117, what: 'deal_cancelled' }), 1)),
  'amend-local-lc': () => amendScene(amendMsg('al', '대한테크 내국신용장 나왔어', amendCard({ no: D117, what: 'local_lc' }), 1)),
  'amend-approve': () => ({
    session: fake({ ...copyData(AMEND_COPY), cmds: [CMD({ phase: 'approve', ack: 'accepted', cpName: '대한테크', total: -3_630_000, title: '대한테크 세금계산서 취소', gate: AMEND_GATE() })] }, 'online'),
    approval: HW,
    notes: [...amendMsg('ap', '대한테크 계약 깨졌어. 지난주 계산서 취소해줘', amendCard({ no: D117, what: 'deal_cancelled' }), 2).slice(0, 2), { kind: 'run', id: 'run-cmd-G1', at: now - 90_000, jobId: 'cmd-G1' }],
    node: <Main chat={[]} />,
  }),
  'amend-approval-sheet': () => sheetCase(AMEND_GATE()),
  'amend-records': () => amendScene([], 'records'),
  'home-chat-pc-run': () => ({
    session: fake({ ...copyData(), cmds: [CMD({ phase: 'approve' })] }, 'online'),
    notes: [{ kind: 'run', id: 'run-cmd-G1', at: now - 90_000, jobId: 'cmd-G1' }],
    node: <Main chat={CHAT} />,
  }),
  'result-email': () => runCase({ kind: 'done', result: RES, startedAt: T0 }),
  'result-no-email': () => runCase({ kind: 'done', result: { ...RES, email: null, emailSent: false }, startedAt: T0 }),
  'result-long': () => runCase({ kind: 'done', result: RES_LONG, startedAt: T0 }, { title: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점 세금계산서', amount: 13_530_000 }),
  'home-chat-run': () => ({
    session: fake(paired(), 'online'),
    jobs: [runJob({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크' }, startedAt: now - 50_000 })],
    notes: [{ kind: 'run', id: 'run-r1', at: at(11, 50), jobId: 'r1' }],
    node: <Main chat={CHAT} />,
  }),
  'home-chat-result': () => ({
    session: fake(paired(), 'online'),
    jobs: [runJob({ kind: 'done', result: RES, startedAt: T0 })],
    notes: [{ kind: 'run', id: 'run-r1', at: at(11, 50), jobId: 'r1' }],
    node: <Main chat={CHAT} />,
  }),
  'queue-with-done': () => ({ session: fake(paired(), 'online'), jobs: [runJob({ kind: 'inDoubt', tries: 2, startedAt: T0 }, { title: '서울청과 세금계산서', amount: 880_000 }), { ...runJob({ kind: 'done', result: RES, startedAt: T0 }), id: 'r2' }], node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  'doc-loading': () => docCase({ kind: 'loading' }),
  'doc-receiving': () => docCase({ kind: 'receiving', pct: 62 }),
  'doc-pc-off': () => docCase({ kind: 'pcOff' }),
  'doc-pc-off-asked': () => docCase({ kind: 'pcOff', asked: true }),
  'doc-backup': () => docCase({ kind: 'ready', backup: true }),
  'doc-error': () => docCase({ kind: 'error' }),
  'doc-ready': () => docCase({ kind: 'ready' }),
  'doc-long': () => docCase({ kind: 'ready' }, RES_LONG),
  demo: () => ({ session: fake(paired(), 'online'), approval: HW, simulate: true, node: <Demo /> }),
  'demo-in-doubt': () => ({ session: fake(paired(), 'online'), approval: HW, simulate: 'inDoubt', node: <Demo /> }),
  'approval-default': () => sheetCase(gate()),
  'approval-arming': () => sheetCase(gate({ left: 119_700 }), { openedAt: now - 300 }),
  'approval-urgent': () => sheetCase(gate({ left: 14_000 })),
  'approval-expired': () => sheetCase(gate({ left: -1 })),
  'approval-dup': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$dup.businessKey', value: 'committed' }] })),
  'approval-dup-detail': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$dup.businessKey', value: 'committed;4821;10:20' }] })),
  'approval-dup-acked': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$dup.businessKey', value: 'committed' }] }), { acked: ['$dup.businessKey'] }),
  'approval-unknown': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$bank.account', value: '1234' }] })),
  'approval-first': () => sheetCase(gate({ rb: LONG, reserved: [{ key: '$first.bizNo', value: 'true' }, { key: '$first.email', value: 'true' }] })),
  'approval-limit': () => sheetCase(gate(), { settings: { ...HW, usedToday: 5 } }),
  'approval-no-key': () => sheetCase(gate(), { settings: { attest: 'none', iosAllowed: false, usedToday: 0 } }),
  'approval-ios-allowed': () => sheetCase(gate(), { settings: { attest: 'ios_app_attest', iosAllowed: true, usedToday: 1 } }),
  'approval-ios-policy-blocked': () => sheetCase(gate(), { settings: { attest: 'ios_app_attest', iosAllowed: false, usedToday: 1 } }),
  'approval-mismatch': () => sheetCase(gate({ tamper: true })),
  'approval-in-doubt': () => sheetCase(gate(), { state: 'verify' }),
  'approval-long': () => sheetCase(gate({ rb: LONG })),
  'home-chat-online': () => ({ session: fake(paired(), 'online', { receipts: 1, cash: 0 }), node: <Main chat={CHAT} /> }),
  'home-chat-long': () => ({ session: fake(paired(), 'online'), node: <LongChat /> }),
  'home-chat-offline': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * 3_600_000 }, 'offline', { receipts: 1, cash: 0 }), node: <Main chat={CHAT_OFFLINE} /> }),
  'home-chat-merged': () => ({ session: fake(paired(), 'online', { receipts: 1, cash: 0 }), node: <Main chat={CHAT_MERGED} /> }),
  'home-unpaired': () => ({ session: fake(emptyData(), 'unpaired'), node: <Main /> }),
  'home-chat-empty': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} /> }),
  'home-phone-empty': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: <Main chat={[]} phone={phoneChat('empty')} /> }),
  'home-phone-sales': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('sales')} /> }),
  'home-phone-typing': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: <Main chat={[]} phone={phoneChat('typing')} /> }),
  'home-phone-reply': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: <Main chat={[]} phone={phoneChat('reply')} /> }),
  'home-phone-failed': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: <Main chat={[]} phone={phoneChat('failed')} /> }),
  'home-phone-card': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('card')} /> }),
  'home-phone-ask': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('ask')} /> }),
  'home-phone-screen': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('screen')} /> }),
  'home-phone-lunch': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('lunch')} /> }),
  'issue-sheet': () => issueSheet({}),
  'issue-sheet-search': () => issueSheet({ query: '동네' }),
  'issue-sheet-none': () => issueSheet({ query: '한강상회' }),
  'issue-sheet-empty': () => issueSheet({}, { asOf: COPY_AT, counterparties: [] }),
  'issue-sheet-focus': () => issueSheet({ focus: true }),
  'issue-sheet-search-focus': () => issueSheet({ query: '동네', focus: true }),
  'issue-sheet-kb': () => issueSheet({ query: '동네', kb: 336 }),
  'issue-sheet-name': () => issueSheet({ step: 'name' }),
  'issue-sheet-bizno': () => issueSheet({ step: 'bizNo', name: '한강상회' }),
  'issue-card': () => issueCardCase({ cp: cpOfCopy('cp_gana') }),
  'issue-card-new': () => issueCardCase({ cp: null, name: '한강상회', bizNo: '107-12-34567' }),
  'home-phone-react-working': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('react-working')} /> }),
  'home-phone-react-result': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('react-result')} /> }),
  'home-phone-react-only': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('react-only')} /> }),
  'home-plus-menu': () => ({ session: fake(paired(), 'online'), node: <Main chat={[]} phone={phoneChat('card')} menu /> }),
  'home-phone-limit': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: <Main chat={[]} phone={phoneChat('limit')} /> }),
  home: () => ({ session: fake(paired(), 'online', { receipts: 2, cash: 0 }), node: <Main /> }),
  'home-stale': () => ({ session: fake({ ...paired(), lastSeenPc: now - 9 * DAY }, 'stale', { receipts: 3, cash: 1 }), node: <Main chat={CHAT} /> }),
  'money-empty': () => money(null),
  'money-copy': () => ({ ...money(null, { pc: 'offline' }), session: fake({ ...copyData(), lastSeenPc: now - 15 * H }, 'offline') }),
  'money-copy-unsure': () => ({ ...money(null, { pc: 'offline' }), session: fake({ ...copyData(COPY_UNSURE), lastSeenPc: now - 15 * H }, 'offline') }),
  'money-copy-no-account': () => ({ ...money(null, { pc: 'offline' }), session: fake({ ...copyData(COPY_NO_ACCT), lastSeenPc: now - 15 * H }, 'offline') }),
  'money-ok': () => money(MONEY_OK),
  'money-late': () => money(MONEY_LATE),
  'money-shortfall': () => money(MONEY_SHORT),
  'money-unsure': () => money(MONEY_UNSURE),
  'money-last': () => money(MONEY_LAST, { live: false, pc: 'offline' }),
  'money-no-account': () => money(MONEY_NOACCT),
  'money-loading': () => money(MONEY_OK, { status: 'loading' }),
  'money-error': () => money(MONEY_OK, { status: 'error' }),
  'money-unpaired': () => ({ session: fake(emptyData(), 'unpaired'), node: <Main start="money" /> }),
  'money-recv': () => money(MONEY_OK, { start: 'list' }),
  'money-recv-marked': () => money(MONEY_OK, { start: 'list', marks: MARKS }),
  'money-recv-late': () => money(MONEY_LATE, { start: 'list' }),
  'money-pay': () => money(MONEY_OK, { start: 'pay' }),
  'money-mark': () => money(MONEY_OK, { start: 'mark' }),
  'money-mark-offline': () => money(MONEY_LAST, { start: 'mark', live: false, pc: 'offline' }),
  'records-empty': () => ({ session: fake(paired(), 'online'), node: <Main start="records" /> }),
  settings: () => ({ session: fake(paired(), 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="granted" usagePreview={{ percent: 42, resetAt: new Date(2026, 11, 1).getTime() }} /></InShell> }),
  inbox: () => ({ session: fake({ ...paired(), inbox: INBOX, inboxSeenAt: at(14, 0) }, 'online', { receipts: 1, cash: 0 }), jobs: JOBS.slice(6, 7), node: <InShell><InboxScreen onRun={noop} onCard={noop} onMoney={noop} onQueue={noop} now={now} /></InShell> }),
  'inbox-empty': () => ({ session: fake(paired(), 'online'), node: <InShell><InboxScreen onRun={noop} onCard={noop} onMoney={noop} onQueue={noop} now={now} /></InShell> }),
  menu: () => ({ session: fake({ ...paired(), inbox: INBOX, inboxSeenAt: at(14, 0) }, 'online'), node: <Main chat={CHAT} drawer /> }),
  'home-chat-inbox-new': () => ({ session: fake({ ...paired(), inbox: INBOX, inboxSeenAt: at(14, 0) }, 'online'), node: <Main chat={CHAT} /> }),
  'settings-text-large': () => ({ session: fake({ ...paired(), textSize: 'large' }, 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="granted" /></InShell> }),
  'settings-text-small': () => ({ session: fake({ ...paired(), textSize: 'small' }, 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="granted" /></InShell> }),
  'settings-unpaired': () => ({ session: fake(emptyData(), 'unpaired'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="undetermined" /></InShell> }),
  'settings-notify': () => ({ session: fake(paired(), 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="granted" sub="notify" /></InShell> }),
  'settings-notify-ask': () => ({ session: fake(paired(), 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="undetermined" sub="notify" /></InShell> }),
  'settings-notify-off': () => ({ session: fake({ ...paired(), notify: { run: true, money: false } }, 'online'), node: <InShell><SettingsScreen onConnection={noop} onPair={noop} onDevices={noop} bioPreview={FACE} permPreview="denied" sub="notify" /></InShell> }),
  'notify-banner': () => ({
    session: fake(paired(), 'online'),
    node: (
      <>
        <Main start="money" />
        <Banner ev={{ jobId: 'j', kind: 'done', title: '세금계산서를 발급했어요', line: '가나식자재 세금계산서', os: { title: '', body: '' } }} onPress={noop} onClose={noop} />
      </>
    ),
  }),
  'notify-banner-turn': () => ({
    session: fake(paired(), 'online'),
    node: (
      <>
        <Main start="records" />
        <Banner ev={{ jobId: 'j', kind: 'myTurn', title: '내 차례예요', line: '가나식자재 세금계산서, 폰에서 간편인증을 승인해 주세요', os: { title: '', body: '' } }} onPress={noop} onClose={noop} />
      </>
    ),
  }),
  'push-ask': () => ({
    session: fake(paired(), 'online'),
    node: (
      <>
        <Main start="home" />
        <AskSheet onYes={noop} onNo={noop} />
      </>
    ),
  }),
  'lock-faceid': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: FACE }} /> }),
  'lock-touchid': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: { kind: 'touchId', enrolled: true } }} /> }),
  'lock-android': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: { kind: 'fingerprint', enrolled: true } }} /> }),
  'lock-failed': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: FACE, err: 'unavailable' }} /> }),
  'lock-passcode-fallback': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: FACE, err: 'cancelled' }} /> }),
  'lock-no-biometric-passcode': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: { kind: 'faceId', enrolled: false } }} /> }),
  'lock-no-passcode': () => ({ session: fake(paired(), 'online'), node: <LockScreen firstRun={false} onUnlocked={noop} onReset={noop} preview={{ bio: FACE, err: 'passcode_required' }} /> }),
  'onboarding-easy': () => ({ session: fake(emptyData(), 'unpaired'), node: <OnboardingScreen onDone={noop} start={0} /> }),
  'onboarding-what': () => ({ session: fake(emptyData(), 'unpaired'), node: <OnboardingScreen onDone={noop} start={1} /> }),
  'onboarding-safe': () => ({ session: fake(emptyData(), 'unpaired'), node: <OnboardingScreen onDone={noop} start={2} /> }),
  'onboarding-pair': () => ({ session: fake(emptyData(), 'unpaired'), node: <PairScreen onDone={noop} onboarding={{ onBack: noop }} /> }),
  'onboarding-paired': () => ({ session: fake(paired(), 'online'), node: <PairScreen onDone={noop} onboarding={{ onBack: noop }} previewPhase="done" /> }),
  'lock-first-run': () => ({ session: fake(emptyData(), 'unpaired'), node: <LockScreen firstRun onUnlocked={noop} onReset={noop} preview={{ bio: FACE }} /> }),
  'lock-first-run-no-bio': () => ({ session: fake(emptyData(), 'unpaired'), node: <LockScreen firstRun onUnlocked={noop} onReset={noop} preview={{ bio: { kind: 'none', enrolled: false } }} /> }),
  'lock-first-run-no-passcode': () => ({ session: fake(emptyData(), 'unpaired'), node: <LockScreen firstRun onUnlocked={noop} onReset={noop} preview={{ bio: FACE, err: 'passcode_required' }} /> }),
  'lock-cover': () => ({ session: fake(paired(), 'online'), node: <View style={{ flex: 1 }}><Main chat={CHAT} /><View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}><Cover /></View></View> }),
  'home-chat-entrusted': () => ({
    session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'),
    jobs: [JOBS[7]!],
    notes: [{ kind: 'note', id: 'n1', at: at(11, 42), text: '동네마트 성수점 세금계산서 352,000원을 맡겼어요. PC 켜지면 준비해요' }],
    node: <Main chat={CHAT} />,
  }),
  'queue-mixed': () => ({ session: fake(paired(), 'online'), jobs: JOBS, node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  'queue-refused': () => ({
    session: fake(paired(), 'online'),
    jobs: [
      { id: 'w1', title: '서울청과 세금계산서', amount: 880_000, createdAt: T0, state: 'phoneWaiting', wait: 'pcBusy', pcOnly: true },
      { id: 'w2', title: '한빛인쇄 세금계산서', amount: 495_000, createdAt: T0, state: 'phoneWaiting', wait: 'newDay', waitDay: iso(new Date(now - DAY)), pcOnly: true },
      { ...runJob({ kind: 'refused', reason: 'counterparty_unknown', startedAt: T0 }, { state: 'needPc' }), pcOnly: true },
      { ...runJob({ kind: 'stopped', step: 'login', reason: 'pcStopped', startedAt: T0 }, { title: '새봄꽃집 세금계산서', amount: 330_000, state: 'needPc' }), id: 'r2', pcOnly: true },
      JOBS[3]!,
    ],
    node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} />,
  }),
  'queue-empty': () => ({ session: fake(paired(), 'online'), last: LAST_DONE, node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  cash: () => ({ session: fake(paired(), 'online'), node: <CashScreen onDone={noop} /> }),
  devices: () => devices({ kind: 'ready', devices: DEVICES_NORMAL() }),
  'devices-full': () => devices({ kind: 'ready', devices: DEVICES_FULL() }),
  'devices-suspended': () => devices({ kind: 'ready', devices: DEVICES_SUSPENDED() }),
  'devices-error': () => devices({ kind: 'error', code: 'devices.unreachable' }),
  'devices-stopped': () => devices({ kind: 'error', code: 'account.device_suspended' }),
  'devices-loading': () => devices({ kind: 'loading' }),
  'devices-unpaired': () => ({ session: fake(emptyData(), 'unpaired'), node: <DevicesScreen onDone={noop} onReset={noop} onPair={noop} preview={{ load: { kind: 'loading' }, selfId: DEVICE_SELF }} /> }),
  connection: () => ({ session: fake(paired(), 'queued', { receipts: 2, cash: 1 }), node: <ConnectionScreen onDone={noop} onReset={noop} onRepair={noop} /> }),
  'invoice-confirm': () => ({
    session: fake(paired(), 'online'),
    node: <CaptureScreen onDone={noop} preview={{ phase: 'confirm', docMode: 'invoice', engine: 'ios_vision', shot: SAMPLE_SHOT, inv: formFrom(read.invoice), conf: read.invoice.fieldConfidence } satisfies CapturePreview} />,
  }),
  'invoice-issues': () => {
    const inv = { ...formFrom(read.invoice), total: '1,350,000', direction: null, supplierName: '' };
    return {
      session: fake(paired(), 'online'),
      node: <CaptureScreen onDone={noop} preview={{ phase: 'confirm', docMode: 'invoice', shot: SAMPLE_SHOT, inv, conf: { ...read.invoice.fieldConfidence, 'supplier.name': 0.4, direction: 0 }, tried: true, switched: true, engine: 'ios_vision' }} />,
    };
  },
  'receipt-confirm': () => ({
    session: fake(paired(), 'online'),
    node: <CaptureScreen onDone={noop} preview={{ phase: 'confirm', docMode: 'receipt', shot: SAMPLE_SHOT, receipt: { amount: '12,800', issuedOn: iso(today), merchant: '동네마트 성수점', bizNo: '' }, engine: 'ios_vision' }} />,
  }),
  saved: () => ({
    session: fake(paired(), 'online'),
    node: <CaptureScreen onDone={noop} preview={{ phase: 'saved', docMode: 'invoice', shot: SAMPLE_SHOT, sent: { title: '세금계산서 매입', value: '1,353,000원' } }} />,
  }),
  camera: () => ({ session: fake(paired(), 'online'), node: <CaptureScreen onDone={noop} /> }),
  'customers-list': () => cust({}),
  'customers-search': () => cust({ query: '대한' }),
  'customers-search-none': () => cust({ query: '새마을상회' }),
  'customer-detail': () => cust({ view: 'detail', id: 'cp_4' }),
  'customer-detail-closed': () => cust({ view: 'detail', id: 'cp_16' }),
  'customer-edit': () => cust({ view: 'edit', id: 'cp_4' }),
  'customer-add-number': () => cust({ add: { step: 'number', bizNo: bizOf(777) } }),
  'customer-add-wrong': () => cust({ add: { step: 'number', bizNo: '128-81-77420' } }),
  'customer-add-same': () => cust({ add: { step: 'number', bizNo: COPY_100.counterparties[4]!.bizNo } }),
  'customer-add-name': () => cust({ add: { step: 'name', bizNo: bizOf(777), name: '새마을상회' } }),
  'customers-empty': () => cust({}, { asOf: COPY_AT, counterparties: [] }),
  'customers-unpaired': () => ({ session: fake(emptyData(), 'online'), node: <Main start="customers" /> }),
  'customers-menu': () => ({ session: fake(copyData(COPY_100), 'online'), node: <Main start="customers" drawer /> }),
  // 월 리포트(기준판 Phone-Report, -1y, -Press, -Partner, Phone-Menu)
  report: () => rep({}),
  'report-1y': () => rep({ months: 12 }, 'offline'),
  'report-press': () => rep({ hold: '2026-10' }),
  'report-partner': () => rep({ partner: 0 }),
  'report-all': () => rep({ all: 'partners' }),
  'report-past': () => rep({ month: '2026-10' }),
  'report-menu': () => ({ session: fake(copyData({ ...COPY, report: SAMPLE_REPORT }), 'online'), node: <Main start="report" drawer /> }),
  'report-none': () => ({ session: fake(copyData(COPY), 'offline'), node: <Main start="report" /> }),
  'report-pc-old': () => ({ session: fake(copyData({ ...COPY, reportCap: false } as PhoneCopyBody), 'online'), node: <Main start="report" /> }),
  'report-not-made': () => ({ session: fake(copyData({ ...COPY, reportCap: true } as PhoneCopyBody), 'online'), node: <Main start="report" /> }),
};
function rep(report: ReportPreview, pc: PcStatus = 'online') {
  return { session: fake({ ...copyData({ ...COPY, report: SAMPLE_REPORT }), ...(pc === 'offline' ? { lastSeenPc: now - 15 * H } : {}) }, pc), node: <Main start="report" report={report} /> };
}

export default function Gallery() {
  const p = usePalette();
  const q = new URLSearchParams(typeof location !== 'undefined' && location.search ? location.search : (process.env.EXPO_PUBLIC_GALLERY ?? ''));
  const name = q.get('s') || 'home-chat-online';
  const fs = Math.min(Number(q.get('fs')) || 1, MAX_FONT_SCALE);
  textScale.web = fs;
  const make = SCREENS[name] ?? SCREENS['home-chat-online']!;
  const { session, node, jobs, last, notes, sheet, approval, sheetPreview, focus, simulate, money: mny } = make();
  const w = Number(q.get('w')) || 393;
  const h = Number(q.get('h')) || 852;
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: w, height: h }, insets: h < 700 ? { top: 20, left: 0, right: 0, bottom: 0 } : { top: 59, left: 0, right: 0, bottom: 34 } }}>
      <KeyboardProvider>
      <View style={{ flex: 1, backgroundColor: p.canvas }}>
        <SessionContext.Provider value={session}>
          <TextSizeHost base={fs}>
          <QueueProvider initial={jobs} last={last} notes={notes} sheet={sheet} approval={approval} simulate={simulate ?? true} focus={focus}>
            <MoneyProvider status={mny?.status ?? 'none'} snap={mny?.snap ?? null} live={mny?.live ?? false} marks={mny?.marks} focus={mny?.focus ?? null} simulate>
              {node}
              <ApprovalHost preview={sheetPreview} />
            </MoneyProvider>
          </QueueProvider>
          </TextSizeHost>
        </SessionContext.Provider>
      </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
