// 화면 갤러리(웹 전용, 디자인 점검용). 가짜 세션으로 화면 하나를 그린다: /?s=home-chat-online | home-unpaired | money-empty | ...
// ?fs=1.6 이면 글자 크기 설정 1.6배를 흉내 낸다(앱에서는 OS 설정을 따른다).
// 앱 번들에는 들어가지 않는다(metro.config.cjs가 web에서만 App을 이것으로 바꾼다). 네트워크·키·카메라를 쓰지 않는다.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import { View } from 'react-native';
import type { ChatItem } from '../src/chat';
import { SessionContext, type Session } from '../src/session';
import { MainScreen, type Tab } from '../src/screens/MainScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { QueueScreen } from '../src/screens/QueueScreen';
import { IssueScreen, type IssuePreview } from '../src/screens/IssueScreen';
import { QueueProvider } from '../src/queueStore';
import type { DoneJob, Job } from '../src/queue';
import type { Counterparty, IssuedToday } from '../src/issue';
import { CashScreen } from '../src/screens/CashScreen';
import { ConnectionScreen } from '../src/screens/ConnectionScreen';
import { CaptureScreen, formFrom, type CapturePreview } from '../src/screens/CaptureScreen';
import { MAX_FONT_SCALE, textScale, usePalette } from '../src/theme';
import { emptyData, type AppData } from '../src/storage/state';
import type { PcStatus } from '../src/net/pc';
import { SAMPLE_INVOICE, SAMPLE_SHOT } from './samples';
import { parsePaperInvoice } from '../src/capture/invoice';

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

const noop = () => {};
const at = (h: number, m: number, dayOffset = 0) => {
  const d = new Date(now - dayOffset * DAY);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

/** 대화 견본: PC 답(글자·카드)과 내 말. d일 전 아침. */
const chatOn = (d: number): ChatItem[] => [
  { kind: 'msg', id: 'c1', from: 'me', at: at(9, 2, d), text: '어제 가나식자재 세금계산서 발급됐어?' },
  {
    kind: 'msg', id: 'c2', from: 'pc', at: at(9, 2, d), text: '네, 어제 오후 4:12에 발급했고 국세청 전송까지 끝났어요.',
    card: { title: '세금계산서 발급 완료', rows: [{ label: '받는 곳', value: '가나식자재' }, { label: '공급가액', value: '1,230,000원' }, { label: '세액', value: '123,000원' }, { label: '합계', value: '1,353,000원', strong: true }] },
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
  { kind: 'msg', id: 'c5', from: 'me', at: at(11, 40), text: '동네마트에 오늘 날짜로 세금계산서 발급해 줘. 공급가액 320,000원', state: 'waiting' },
];
const CHAT_MERGED: ChatItem[] = [
  ...chatOn(1),
  { kind: 'msg', id: 'm0', from: 'pc', at: at(18, 30, 1), text: '오늘 받은 종이 영수증 3장을 세무사 꾸러미에 넣었어요.' },
  { kind: 'merged', id: 'mg', from: at(8, 10), to: at(9, 40) },
  { kind: 'msg', id: 'm1', from: 'me', at: at(8, 10), card: { title: '영수증 보냄', rows: [{ label: '동네마트 성수점', value: '12,800원' }] } },
  { kind: 'msg', id: 'm2', from: 'me', at: at(8, 12), text: '이거 식자재로 넣어 줘' },
  { kind: 'msg', id: 'm3', from: 'pc', at: at(9, 38), text: '식자재(매입)로 넣었어요. 이번 달 식자재 매입은 2,140,000원이에요.' },
  { kind: 'msg', id: 'm4', from: 'me', at: at(9, 40), text: '고마워' },
];
const TODO = { approvals: 2, backlog: 1 };

/** 탭 화면을 가짜 세션으로 그린다. 탭은 눌러서 바꿀 수 있다. */
function Main({ start = 'home', chat, live }: { start?: Tab; chat?: ChatItem[]; /** 지금 할 일 건수를 가짜 밀린 일에서 센다 */ live?: boolean }) {
  const [tab, setTab] = useState<Tab>(start);
  return <MainScreen tab={tab} onTab={setTab} go={noop} chat={chat} todo={chat && !live ? TODO : undefined} />;
}
const read = parsePaperInvoice(SAMPLE_INVOICE, today)!;

/** 거래처 견본(가짜 사업자) */
const CPS: Counterparty[] = [
  { id: 'ga', name: '가나식자재', bizNo: '123-45-67890', lastSupply: 1_230_000, lastItem: '식자재', lastAt: now - 1 * DAY, issued: 12 },
  { id: 'dm', name: '동네마트 성수점', bizNo: '220-81-12345', lastSupply: 320_000, lastItem: '생활용품', lastAt: now - 3 * DAY, issued: 4 },
  { id: 'hb', name: '한빛인쇄', bizNo: '105-22-33445', lastSupply: 450_000, lastItem: '전단 인쇄', lastAt: now - 6 * DAY, issued: 2 },
  { id: 'sc', name: '서울청과', bizNo: '211-09-87654', lastSupply: 800_000, lastItem: '과일', lastAt: now - 9 * DAY, issued: 7 },
  { id: 'mr', name: '미래포장', bizNo: '314-86-11223', lastSupply: 2_000_000, lastItem: '포장재', lastAt: now - 15 * DAY, issued: 3 },
  { id: 'gw', name: '그린위생', bizNo: '128-17-99001', lastSupply: 150_000, lastItem: '방역', lastAt: now - 40 * DAY, issued: 1 },
  { id: 'sb', name: '새봄꽃집', bizNo: '402-11-55667', issued: 0 },
];
const DUP: IssuedToday[] = [{ counterpartyId: 'ga', total: 1_353_000, at: at(10, 20) }];

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

const issue = (preview: IssuePreview, cps = CPS, today: IssuedToday[] = [], left = 5) => (
  <IssueScreen counterparties={cps} issuedToday={today} approvalsLeft={left} onDone={noop} onCapture={noop} onSubmitted={noop} preview={preview} />
);

const SCREENS: Record<string, () => { session: Session; node: React.ReactNode; jobs?: Job[]; last?: DoneJob; notes?: ChatItem[] }> = {
  'home-chat-online': () => ({ session: fake(paired(), 'online', { receipts: 1, cash: 0 }), node: <Main chat={CHAT} /> }),
  'home-chat-offline': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * 3_600_000 }, 'offline', { receipts: 1, cash: 0 }), node: <Main chat={CHAT_OFFLINE} /> }),
  'home-chat-merged': () => ({ session: fake(paired(), 'online', { receipts: 1, cash: 0 }), node: <Main chat={CHAT_MERGED} /> }),
  'home-unpaired': () => ({ session: fake(emptyData(), 'unpaired'), node: <Main /> }),
  /** 처음 연결한 뒤 대화가 아직 없는 홈(앱이 이 폰 기록으로 만든 대화) */
  home: () => ({ session: fake(paired(), 'online', { receipts: 2, cash: 0 }), node: <Main /> }),
  'home-stale': () => ({ session: fake({ ...paired(), lastSeenPc: now - 9 * DAY }, 'stale', { receipts: 3, cash: 1 }), node: <Main chat={CHAT} /> }),
  'money-empty': () => ({ session: fake(paired(), 'online'), node: <Main start="money" /> }),
  'records-empty': () => ({ session: fake(paired(), 'online'), node: <Main start="records" /> }),
  settings: () => ({ session: fake(paired(), 'online'), node: <SettingsScreen onDone={noop} onConnection={noop} onPair={noop} /> }),
  /** 꺼진 PC에 발급을 맡기고 홈으로 돌아온 뒤: 대화 끝에 확인 한 줄 */
  'home-chat-entrusted': () => ({
    session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'),
    jobs: [JOBS[7]!],
    notes: [{ kind: 'note', id: 'n1', at: at(11, 42), text: '동네마트 성수점 세금계산서 352,000원을 맡겼어요. PC 켜지면 준비해요' }],
    node: <Main chat={CHAT} live />,
  }),
  'queue-mixed': () => ({ session: fake(paired(), 'online'), jobs: JOBS, node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  'queue-empty': () => ({ session: fake(paired(), 'online'), last: LAST_DONE, node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} /> }),
  'issue-picker': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'pick' }) }),
  'issue-picker-empty': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'pick' }, []) }),
  'issue-filled-online': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'form', cpId: 'ga' }) }),
  'issue-filled-offline': () => ({ session: fake({ ...paired(), lastSeenPc: now - 3 * H }, 'offline'), node: issue({ phase: 'form', cpId: 'dm', amount: '352,000', vat: 'incl' }) }),
  'issue-stale': () => ({ session: fake({ ...paired(), lastSeenPc: now - 9 * DAY }, 'stale'), node: issue({ phase: 'form', cpId: 'ga' }) }),
  'issue-first-counterparty': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'form', cpId: 'sb', amount: '300,000' }) }),
  'issue-duplicate': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'form', cpId: 'ga' }, CPS, DUP) }),
  /** 부가세 포함 합계 21원: 세액 규칙으로 정확히 못 맞춰 20원으로 */
  'issue-inexact': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'form', cpId: 'ga', amount: '21', vat: 'incl' }) }),
  'issue-limit': () => ({ session: fake(paired(), 'online'), node: issue({ phase: 'form', cpId: 'sc' }, CPS, [], 1) }),
  cash: () => ({ session: fake(paired(), 'online'), node: <CashScreen onDone={noop} /> }),
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
    node: <CaptureScreen onDone={noop} preview={{ phase: 'saved', docMode: 'invoice', shot: SAMPLE_SHOT, sent: { title: '세금계산서 · 매입', value: '1,353,000원' } }} />,
  }),
  camera: () => ({ session: fake(paired(), 'online'), node: <CaptureScreen onDone={noop} /> }),
};

export default function Gallery() {
  const p = usePalette();
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const name = q.get('s') || 'home-chat-online';
  textScale.web = Math.min(Number(q.get('fs')) || 1, MAX_FONT_SCALE);
  const make = SCREENS[name] ?? SCREENS['home-chat-online']!;
  const { session, node, jobs, last, notes } = make();
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } }}>
      <View style={{ flex: 1, backgroundColor: p.canvas }}>
        <SessionContext.Provider value={session}>
          <QueueProvider initial={jobs} last={last} notes={notes}>
            {node}
          </QueueProvider>
        </SessionContext.Provider>
      </View>
    </SafeAreaProvider>
  );
}
