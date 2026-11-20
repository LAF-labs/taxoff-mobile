
export const STEPS = ['prepare', 'login', 'readback', 'approve', 'issue', 'verify'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = {
  prepare: '준비',
  login: '홈택스 로그인',
  readback: '값 확인',
  approve: '승인',
  issue: '발급',
  verify: '확인',
};

export const AUTH_APPS: Readonly<Record<string, string>> = {
  카카오뱅크: 'kakaobank://',
  카카오톡: 'kakaotalk://',
  토스: 'supertoss://',
};

export const SIMPLE_APPS: ReadonlyArray<{ code: string; name: string; app: string }> = [
  { code: 'kakao', name: '카카오톡', app: '카카오톡' },
  { code: 'naver', name: '네이버', app: '네이버' },
  { code: 'toss', name: '토스', app: '토스' },
  { code: 'pass', name: 'PASS', app: 'PASS' },
  { code: 'kakaobank', name: '카카오뱅크', app: '카카오뱅크' },
  { code: 'kb', name: 'KB국민', app: 'KB스타뱅킹' },
  { code: 'shinhan', name: '신한', app: '신한 SOL' },
  { code: 'woori', name: '우리', app: '우리WON' },
  { code: 'hana', name: '하나', app: '하나원큐' },
  { code: 'nh', name: 'NH', app: 'NH스마트뱅킹' },
  { code: 'ibk', name: 'IBK', app: 'i-ONE Bank' },
  { code: 'samsung', name: '삼성패스', app: '삼성패스' },
  { code: 'banksalad', name: '뱅크샐러드', app: '뱅크샐러드' },
];
export const PASS_CARRIERS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 's', name: 'SKT' },
  { code: 'k', name: 'KT' },
  { code: 'l', name: 'LGU+' },
  { code: 'sa', name: 'SKT 알뜰폰' },
  { code: 'ka', name: 'KT 알뜰폰' },
  { code: 'la', name: 'LGU+ 알뜰폰' },
];
export const simpleAppOf = (code: string) => SIMPLE_APPS.find((a) => a.code === code) ?? null;

export type Auth = { method: 'simple'; app: string; deadline?: number; pc?: boolean } | { method: 'cert' } | { method: 'pc'; code?: string; canSimple?: boolean; failed?: boolean };

export const PC_TURN: Readonly<Record<string, { line: string; short: string }>> = {
  'login.simple_auth': { line: '공동인증서 로그인이 두 번 안 됐어요', short: '공동인증서 로그인이 안 됐어요' },
  'cert.pick_needed': { line: '인증서가 여러 개라 어느 것으로 로그인할지 정해야 해요. 아무것도 발급하지 않았어요', short: '쓸 인증서를 정해야 해요' },
  'portal.captcha': { line: '홈택스가 자동입력방지 문자를 물어서 로그인 앞에서 기다리고 있어요', short: '홈택스 로그인 앞에서 기다려요' },
  'portal.mfa_pending': { line: '홈택스가 추가 인증을 요구해서 로그인 앞에서 기다리고 있어요', short: '홈택스 추가 인증을 기다려요' },
  'issue.locked_elsewhere': { line: '다른 PC에서 발급 중이에요. 그 발급이 끝나면 이어서 해요', short: '다른 PC의 발급을 기다려요' },
};
const PC_TURN_DEFAULT = { line: '홈택스에서 예상하지 못한 화면이 나와 멈춰 있어요', short: '예상 밖 화면에서 멈췄어요' };
export const pcTurnOf = (code?: string) => (code && Object.hasOwn(PC_TURN, code) ? PC_TURN[code]! : PC_TURN_DEFAULT);

export type StopReason = 'blocked' | 'unknownScreen' | 'dateMismatch' | 'inputMismatch' | 'totalMismatch' | 'otherLogin' | 'passwordError' | 'pcStopped' | 'appOld';

export type RunAction = 'retryPrepare' | 'reserveOnPc' | 'resendAuth' | 'retryCert' | 'simpleAuth' | 'authDone' | 'stop' | 'close' | 'openApp';

export const STOP_COPY: Record<StopReason, { line: string; action: 'retryPrepare' | 'reserveOnPc' }> = {
  blocked: { line: '홈택스가 잠시 접속을 막아서 24시간 동안 쉬어요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  unknownScreen: { line: '예상한 홈택스 화면이 아니에요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  dateMismatch: { line: '홈택스 작성일자가 오늘(한국 시간)과 달라 멈췄어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  inputMismatch: { line: '홈택스 화면 값이 준비한 값과 달라 승인을 열지 않았어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  totalMismatch: { line: '홈택스 화면의 공급가액과 세액을 더한 값이 합계와 달라 승인을 열지 않았어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  otherLogin: { line: '다른 곳에서 홈택스에 로그인해 연결이 끊겼어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  passwordError: { line: '홈택스에서 비밀번호가 맞지 않는대요. 저장해 둔 비밀번호는 지웠어요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  pcStopped: { line: '멈췄어요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  appOld: { line: 'PC 앱 버전이 낮아 시작하지 않았어요. PC 앱을 업데이트하면 다시 할 수 있어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
};

export const ACTION_LABEL: Record<RunAction, string> = {
  retryPrepare: '다시 준비',
  reserveOnPc: 'PC에서 열기 예약',
  resendAuth: '다시 요청',
  retryCert: '인증서로 다시 시도',
  simpleAuth: '간편인증으로 로그인',
  authDone: '승인했어요',
  stop: '중지',
  close: '닫기',
  openApp: '',
};

export interface DocRef {
  name: string;
  issuedOn: string;
  uri: string;
}

export interface IssueResult {
  approvalNo: string;
  counterpart: string;
  total: number;
  email: string | null;
  emailSent: boolean;
  issuedAt: number;
  doc: DocRef;
}

export type RefuseReason = 'playbook_unavailable' | 'input_invalid' | 'counterparty_unknown' | 'duplicate' | 'pc_busy' | 'hometax_paused' | 'pc_old';

export type RunView =
  | { kind: 'running'; step: Step; startedAt: number; pcApproval?: boolean }
  | { kind: 'refused'; reason: RefuseReason; startedAt: number }
  | { kind: 'myTurn'; step: Step; auth: Auth; startedAt: number }
  | { kind: 'stopped'; step: Step; reason: StopReason; startedAt: number; reserved?: boolean }
  | { kind: 'inDoubt'; tries: number; startedAt: number }
  | { kind: 'verify'; startedAt: number }
  | { kind: 'done'; result: IssueResult; startedAt: number };

export function stepOf(r: RunView): Step {
  if (r.kind === 'running' || r.kind === 'myTurn' || r.kind === 'stopped') return r.step;
  if (r.kind === 'refused') return 'prepare';
  return 'verify';
}

export function chipOf(r: RunView): { label: string; tone: 'quiet' | 'attention'; busy?: boolean } {
  switch (r.kind) {
    case 'running':
      return { label: '진행 중', tone: 'quiet', busy: true };
    case 'myTurn':
      return { label: '내 차례', tone: 'attention' };
    case 'stopped':
      return { label: '중지됨', tone: 'quiet' };
    case 'refused':
      return { label: '시작 못 함', tone: 'quiet' };
    case 'inDoubt':
      return { label: '확인 중', tone: 'attention', busy: true };
    case 'verify':
      return { label: '확인 필요', tone: 'attention' };
    case 'done':
      return { label: '발급됨', tone: 'quiet' };
  }
}

export function actionsOf(r: RunView, now = Date.now()): RunAction[] {
  switch (r.kind) {
    case 'running':
      return r.step === 'issue' || r.step === 'verify' || r.step === 'approve' ? ['close'] : ['stop'];
    case 'myTurn':
      if (r.auth.method === 'cert') return ['reserveOnPc', 'stop'];
      if (r.auth.method === 'pc') return r.auth.code === 'login.simple_auth' ? (r.auth.canSimple ? ['simpleAuth', 'retryCert'] : ['retryCert', 'close']) : ['close'];
      if (r.auth.pc) {
        if (r.auth.deadline !== undefined && r.auth.deadline <= now) return ['resendAuth', 'retryCert'];
        return Object.hasOwn(AUTH_APPS, r.auth.app) ? ['authDone', 'openApp', 'resendAuth'] : ['authDone', 'resendAuth'];
      }
      if (r.auth.deadline !== undefined && r.auth.deadline <= now) return ['resendAuth', 'stop'];
      return Object.hasOwn(AUTH_APPS, r.auth.app) ? ['openApp', 'resendAuth', 'stop'] : ['resendAuth', 'stop'];
    case 'stopped':
      return r.reserved ? ['close'] : [STOP_COPY[r.reason].action, 'close'];
    case 'refused':
    case 'inDoubt':
    case 'verify':
    case 'done':
      return ['close'];
  }
}

export function mmss(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}

export function groupApprovalNo(no: string): string {
  const d = no.replace(/\D/g, '');
  return d.length ? (d.match(/.{1,4}/g) ?? []).join(' ') : no;
}
