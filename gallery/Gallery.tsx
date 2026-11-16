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
import { QueueProvider, type ApprovalSettings } from '../src/queueStore';
import { ApprovalHost } from '../src/screens/ApprovalHost';
import { buildGate, type GateField, type PhoneGate } from '../src/approval';
import { useEffect } from 'react';
import { useQueue } from '../src/queueStore';
import { RunScreen } from '../src/screens/RunScreen';
import { BizRegScreen, type BizRegPreview } from '../src/screens/BizRegScreen';
import { DocScreen, type DocState } from '../src/screens/DocScreen';
import type { IssueResult, RunView } from '../src/run';
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

// ---- 승인 시트 견본(P-03): 엔진과 같은 식으로 만든 게이트, 시계는 멈춘다 ----
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
  // 해시 불일치: PC가 보낸 값 하나가 화면과 다르다(엔진 버그·변조를 흉내)
  return o.tamper ? { ...g, fields: g.fields.map((f) => (f.key === 'totalAmount' ? { ...f, value: '8800000' } : f)) } : g;
};
const HW: ApprovalSettings = { attest: 'hw', iosAllowed: false, usedToday: 1 };
const sheetCase = (g: PhoneGate, o: { settings?: ApprovalSettings; openedAt?: number; state?: Job['state']; acked?: string[] } = {}) => ({
  session: fake(paired(), 'online'),
  jobs: [{ id: 'ap', title: `${g.fields.find((f) => f.key === 'counterpartName')!.value} 세금계산서`, amount: Number(g.fields.find((f) => f.key === 'totalAmount')!.value), createdAt: now - 60_000, state: o.state ?? ('approval' as const), gate: g }, ...JOBS.slice(6, 8)],
  sheet: 'ap',
  approval: o.settings ?? HW,
  sheetPreview: { now, openedAt: o.openedAt ?? now - 5_000, acked: o.acked },
  node: <QueueScreen onDone={noop} onConnection={noop} onOpen={noop} now={now} />,
});

// ---- 진행·결과·서류(P-04·P-05) 견본 ----
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
const docCase = (state: DocState, result = RES) => ({
  session: fake(paired(), state.kind === 'pcOff' ? 'offline' : 'online'), jobs: [runJob({ kind: 'done', result, startedAt: T0 })], focus: 'r1', node: <DocScreen onDone={noop} state={state} />,
});

// ---- 사업자등록증 찍기(PR 7) 견본: public/sample-bizreg.jpg(가짜 사업자) ----
const BIZ_SHOT = { uri: '/sample-bizreg.jpg', width: 1140, height: 1608 };
const BIZ_VALUES = { name: '동네마트 성수점', bizNo: '220-81-12341', ceo: '김견본', address: '서울특별시 성동구 성수이로 00, 1층', bizType: '도매 및 소매업', item: '생활용품', email: '' };
const HIGH = { name: 0.9, bizNo: 0.95, ceo: 0.9, address: 0.85, bizType: 0.85, item: 0.85 };
const biz = (pv: Partial<BizRegPreview>, existing: Counterparty[] = CPS) => ({
  session: fake(paired(), 'online'),
  node: <BizRegScreen existing={existing} onDone={noop} onSaved={noop} onUseExisting={noop} preview={{ phase: 'confirm', shot: BIZ_SHOT, values: BIZ_VALUES, conf: HIGH, ...pv }} />,
});
const NEW_CP: Counterparty = { id: 'new', name: '동네마트 성수점', bizNo: '220-81-12341', issued: 0, email: 'tax@dongne.example' };
const issueNew = (status: Counterparty['status'], pc: PcStatus = 'online') => ({
  session: fake(pc === 'online' ? paired() : { ...paired(), lastSeenPc: now - 3 * H }, pc),
  node: issue({ phase: 'form', cpId: 'new', amount: '320,000' }, [...CPS, { ...NEW_CP, status }]),
});

/** 시연: 켜진 PC에 발급을 맡긴 순간부터(대화 홈 + 승인 시트가 스스로 뜬다) */
function Demo() {
  const q = useQueue();
  useEffect(() => {
    q.add({ id: 'demo', title: '가나식자재 세금계산서', amount: 1_353_000, createdAt: Date.now(), state: 'running' }, '', {
      supplierBizNo: '', supplierName: '', counterpartBizNo: '123-45-67891', counterpartName: '가나식자재', counterpartEmail: 'tax@gana.example', itemName: '식자재', itemCount: '1',
      supplyAmount: '1230000', taxAmount: '123000', totalAmount: '1353000', issueDate: iso(today), remark: '', receiptType: '청구',
    });
  }, []);
  return <Main chat={CHAT} live />;
}

const issue = (preview: IssuePreview, cps = CPS, today: IssuedToday[] = [], left = 5) => (
  <IssueScreen counterparties={cps} issuedToday={today} approvalsLeft={left} onDone={noop} onCapture={noop} onSubmitted={noop} preview={preview} />
);

const SCREENS: Record<
  string,
  () => {
    session: Session; node: React.ReactNode; jobs?: Job[]; last?: DoneJob; notes?: ChatItem[]; sheet?: string; approval?: ApprovalSettings;
    sheetPreview?: { now: number; openedAt: number; acked?: string[] }; focus?: string; simulate?: boolean | 'inDoubt';
  }
> = {
  'bizreg-camera': () => ({ session: fake(paired(), 'online'), node: <BizRegScreen existing={CPS} onDone={noop} onSaved={noop} onUseExisting={noop} /> }),
  'bizreg-confirm': () => biz({ values: { ...BIZ_VALUES, email: 'tax@dongne.example' } }),
  'bizreg-email-empty': () => biz({}),
  'bizreg-low-conf': () => biz({ conf: { ...HIGH, ceo: 0.4, address: 0.5 } }),
  'bizreg-checksum': () => biz({ values: { ...BIZ_VALUES, bizNo: '220-81-12345' }, conf: { ...HIGH, bizNo: 0.4 } }),
  'bizreg-blurry': () => biz({ poor: true, values: { ...BIZ_VALUES, name: '', ceo: '', address: '', bizType: '', item: '', bizNo: '220-81-1' }, conf: {} }),
  'bizreg-existing': () => biz({}, [...CPS, { id: 'dm2', name: '동네마트 성수점', bizNo: '220-81-12341', issued: 4, lastAt: now - 3 * DAY }]),
  'bizreg-long': () => biz({
    values: { name: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점', bizNo: '105-22-12346', ceo: '이견본', address: '서울특별시 성동구 왕십리로 000, 새봄빌딩 3층 301호(성수동2가, 새봄꽃과정원관리서비스)', bizType: '서비스업', item: '조경관리 및 실내 식물 관리', email: 'very.long.address.for.invoices@flower-garden-service.example' },
  }),
  'issue-new-checking': () => issueNew({ kind: 'checking' }),
  'issue-new-pc-off': () => issueNew({ kind: 'waitPc' }, 'offline'),
  'issue-new-closed': () => issueNew({ kind: 'closed', what: '폐업', on: '2026-09-30' }),
  'run-prepare': () => runCase({ kind: 'running', step: 'prepare', startedAt: now - 12_000 }),
  'run-login': () => runCase({ kind: 'running', step: 'login', startedAt: now - 35_000 }),
  'run-readback': () => runCase({ kind: 'running', step: 'readback', startedAt: T0 }),
  'run-issue': () => runCase({ kind: 'running', step: 'issue', startedAt: now - 140_000 }),
  'run-verify-step': () => runCase({ kind: 'running', step: 'verify', startedAt: now - 150_000 }),
  'run-simple-auth': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크' }, startedAt: now - 50_000 }),
  'run-simple-auth-left': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크', deadline: now + 130_000 }, startedAt: now - 50_000 }),
  'run-simple-auth-timeout': () => runCase({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크', deadline: now - 1_000 }, startedAt: now - 200_000 }),
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
  'result-email': () => runCase({ kind: 'done', result: RES, startedAt: T0 }),
  'result-no-email': () => runCase({ kind: 'done', result: { ...RES, email: null, emailSent: false }, startedAt: T0 }),
  'result-long': () => runCase({ kind: 'done', result: RES_LONG, startedAt: T0 }, { title: '주식회사 새봄꽃과 정원 관리 서비스 성수동 본점 세금계산서', amount: 13_530_000 }),
  'home-chat-run': () => ({
    session: fake(paired(), 'online'),
    jobs: [runJob({ kind: 'myTurn', step: 'login', auth: { method: 'simple', app: '카카오뱅크' }, startedAt: now - 50_000 })],
    notes: [{ kind: 'run', id: 'run-r1', at: at(11, 50), jobId: 'r1' }],
    node: <Main chat={CHAT} live />,
  }),
  'home-chat-result': () => ({
    session: fake(paired(), 'online'),
    jobs: [runJob({ kind: 'done', result: RES, startedAt: T0 })],
    notes: [{ kind: 'run', id: 'run-r1', at: at(11, 50), jobId: 'r1' }],
    node: <Main chat={CHAT} live />,
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
  /** 값이 승인번호 끝·시각을 실어 올 때(모양은 엔진과 맞출 것) */
  'approval-dup-detail': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$dup.businessKey', value: 'committed;4821;10:20' }] })),
  'approval-dup-acked': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$dup.businessKey', value: 'committed' }] }), { acked: ['$dup.businessKey'] }),
  'approval-unknown': () => sheetCase(gate({ reserved: [...NO_FIRST, { key: '$bank.account', value: '1234' }] })),
  'approval-first': () => sheetCase(gate({ rb: LONG, reserved: [{ key: '$first.bizNo', value: 'true' }, { key: '$first.email', value: 'true' }] })),
  'approval-limit': () => sheetCase(gate(), { settings: { ...HW, usedToday: 5 } }),
  'approval-no-key': () => sheetCase(gate(), { settings: { attest: 'none', iosAllowed: false, usedToday: 0 } }),
  'approval-ios-allowed': () => sheetCase(gate(), { settings: { attest: 'ios_app_attest', iosAllowed: true, usedToday: 1 } }),
  'approval-ios-denied': () => sheetCase(gate(), { settings: { attest: 'ios_app_attest', iosAllowed: false, usedToday: 1 } }),
  'approval-mismatch': () => sheetCase(gate({ tamper: true })),
  'approval-in-doubt': () => sheetCase(gate(), { state: 'verify' }),
  'approval-long': () => sheetCase(gate({ rb: LONG })),
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
  const { session, node, jobs, last, notes, sheet, approval, sheetPreview, focus, simulate } = make();
  const w = Number(q.get('w')) || 393;
  const h = Number(q.get('h')) || 852;
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: w, height: h }, insets: h < 700 ? { top: 20, left: 0, right: 0, bottom: 0 } : { top: 59, left: 0, right: 0, bottom: 34 } }}>
      <View style={{ flex: 1, backgroundColor: p.canvas }}>
        <SessionContext.Provider value={session}>
          <QueueProvider initial={jobs} last={last} notes={notes} sheet={sheet} approval={approval} simulate={simulate ?? true} focus={focus}>
            {node}
            <ApprovalHost preview={sheetPreview} />
          </QueueProvider>
        </SessionContext.Provider>
      </View>
    </SafeAreaProvider>
  );
}
