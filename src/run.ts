// 진행·결과(P-04, 기획 v2 PR 6): PC가 홈택스에서 하는 발급 한 건의 상태를 폰 화면용으로 줄인 모델.
// 문구는 08 §11 예외 상태 표를 폰 길이로 줄였다. "아무것도 발급하지 않았어요"는 그대로 둔다.
// 결과 모름(inDoubt)·확인 필요(verify)에는 다시 발급하는 동작이 없다. "발급목록에 없음" 증언은 PC에서만 받는다(ADR-021).

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

/** 폰에서 열 수 있는 인증 앱(이름 → 앱 주소). 여기 없는 앱은 여는 단추를 두지 않는다. */
export const AUTH_APPS: Readonly<Record<string, string>> = {
  카카오뱅크: 'kakaobank://',
  토스: 'supertoss://',
};

export type Auth = { method: 'simple'; app: string } | { method: 'cert' };

export type StopReason = 'blocked' | 'unknownScreen' | 'dateMismatch' | 'inputMismatch' | 'totalMismatch' | 'otherLogin' | 'passwordError';

/** 폰에서 할 수 있는 다음 행동. 못 하는 것(브라우저로 가기·금고에서 확인)은 PC에서 열기 예약으로 바꾼다. */
export type RunAction = 'retryPrepare' | 'reserveOnPc' | 'resendAuth' | 'stop' | 'close' | 'openApp';

export const STOP_COPY: Record<StopReason, { line: string; action: 'retryPrepare' | 'reserveOnPc' }> = {
  blocked: { line: '홈택스 차단 신호가 보여 24시간 동안 쉬어요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  unknownScreen: { line: '예상한 홈택스 화면이 아니에요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
  dateMismatch: { line: '홈택스 작성일자가 오늘(한국 시간)과 달라 멈췄어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  inputMismatch: { line: '홈택스 화면 값이 준비한 값과 달라 승인을 열지 않았어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  totalMismatch: { line: '홈택스 화면의 공급가액과 세액을 더한 값이 합계와 달라 승인을 열지 않았어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  otherLogin: { line: '다른 곳에서 홈택스에 로그인해 연결이 끊겼어요. 아무것도 발급하지 않았어요.', action: 'retryPrepare' },
  passwordError: { line: '홈택스가 비밀번호 오류라고 알렸어요. 금고의 비밀번호를 PC에서 확인해 주세요. 아무것도 발급하지 않았어요.', action: 'reserveOnPc' },
};

export const ACTION_LABEL: Record<RunAction, string> = {
  retryPrepare: '다시 준비',
  reserveOnPc: 'PC에서 열기 예약',
  resendAuth: '다시 요청',
  stop: '중지',
  close: '닫기',
  openApp: '',
};

export interface DocRef {
  /** 세금계산서_가나식자재_20261116.pdf */
  name: string;
  issuedOn: string;
  /** 번들 견본(다음 PR에서 PC가 보낸 암호 파일을 풀어 쓴다) */
  uri: string;
}

export interface IssueResult {
  /** 홈택스 승인번호 원문(예: 20261116-41000000-12345678) */
  approvalNo: string;
  counterpart: string;
  total: number;
  email: string | null;
  emailSent: boolean;
  issuedAt: number;
  doc: DocRef;
}

export type RunView =
  | { kind: 'running'; step: Step; startedAt: number }
  /** 내 차례: 로그인 단계의 사람 확인 */
  | { kind: 'myTurn'; step: Step; auth: Auth; startedAt: number }
  | { kind: 'stopped'; step: Step; reason: StopReason; startedAt: number; reserved?: boolean }
  /** 발급 뒤 응답이 끊겨 발급목록을 조회하는 중 */
  | { kind: 'inDoubt'; tries: number; startedAt: number }
  /** 조회가 계속 실패: 사람이 홈택스에서 직접 확인 */
  | { kind: 'verify'; startedAt: number }
  | { kind: 'done'; result: IssueResult; startedAt: number };

export function stepOf(r: RunView): Step {
  if (r.kind === 'running' || r.kind === 'myTurn' || r.kind === 'stopped') return r.step;
  return r.kind === 'done' ? 'verify' : 'issue';
}

/** 상태 칩 한 줄 */
export function chipOf(r: RunView): { label: string; tone: 'quiet' | 'attention'; busy?: boolean } {
  switch (r.kind) {
    case 'running':
      return { label: '진행 중', tone: 'quiet', busy: true };
    case 'myTurn':
      return { label: '내 차례', tone: 'attention' };
    case 'stopped':
      return { label: '중지됨', tone: 'quiet' };
    case 'inDoubt':
      return { label: '확인 중', tone: 'attention', busy: true };
    case 'verify':
      return { label: '확인 필요', tone: 'attention' };
    case 'done':
      return { label: '발급됨', tone: 'quiet' };
  }
}

/** 이 상태에서 보이는 동작(첫째가 기본 행동). 결과 모름·확인 필요에는 다시 발급하는 동작이 없다. */
export function actionsOf(r: RunView): RunAction[] {
  switch (r.kind) {
    case 'running':
      // 승인 뒤(발급·확인 단계)에는 멈추지 않는다: 커밋 구간은 PC가 끝까지 지킨다
      return r.step === 'issue' || r.step === 'verify' || r.step === 'approve' ? ['close'] : ['stop'];
    case 'myTurn':
      if (r.auth.method === 'cert') return ['reserveOnPc', 'stop'];
      return Object.hasOwn(AUTH_APPS, r.auth.app) ? ['openApp', 'resendAuth', 'stop'] : ['resendAuth', 'stop'];
    case 'stopped':
      return r.reserved ? ['close'] : [STOP_COPY[r.reason].action, 'close'];
    case 'inDoubt':
    case 'verify':
    case 'done':
      return ['close'];
  }
}

/** 1분 20초 · 40초 · 1시간 5분 */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}

/** 승인번호 표시: 숫자만 4자리씩 띄운다(복사는 원문 그대로). */
export function groupApprovalNo(no: string): string {
  const d = no.replace(/\D/g, '');
  return d.length ? (d.match(/.{1,4}/g) ?? []).join(' ') : no;
}
