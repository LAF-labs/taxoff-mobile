// PC 연결이 왜 안 됐는지(원인 코드). 라이브·큐 어느 단계에서 멈췄는지를 '단계:원인'으로 남긴다.
// 값·토큰·우편함 ID·URL은 담지 않는다(코드와 HTTP 상태만). 화면 문구는 pcWhyText가 고른다.
//
// 단계
//   join     우편함 라이브 연결(기기 토큰 받기 → WSS 업그레이드 → 첫 peer 알림)
//   peer     우편함에는 들어갔는데 PC가 PEER_WAIT_MS 안에 붙지 않았다
//   session  Noise_IK 응답이 없거나(PC가 거부하면 무응답) hello가 맞지 않았다
//   live     세션이 열린 뒤 주고받다 끊겼다
//   queue    릴레이 HTTPS 큐(번들 읽기·봉투 올리기)
//   stale    큐 번들이 없거나 만료(PC가 7일 넘게 꺼져 있었다)

export type PcStage = 'join' | 'peer' | 'session' | 'live' | 'queue' | 'stale';

export interface PcWhy {
  /** '단계:원인'(예: 'join:auth.device_revoked', 'peer:timeout') */
  code: string;
  at: number;
}

/** 최근 원인 몇 개만 남긴다(연결 화면의 [연결 기록]) */
export const PC_LOG_MAX = 20;

const SAFE = /^[a-z0-9_.:-]{1,48}$/;

/** 예외를 원인 코드로. 기기 토큰 거절(DeviceAuthError: status·code), 릴레이·큐 오류 문자열('relay: rejected', 'queue: bundle 404')을 구분한다. */
export function causeOf(e: unknown): string {
  const x = e as { code?: unknown; status?: unknown; message?: unknown } | null;
  if (x && typeof x.code === 'string' && /^[a-z_]+\.[a-z_]+$/.test(x.code)) {
    return typeof x.status === 'number' ? `${x.code}.${x.status}` : x.code;
  }
  const m = typeof x?.message === 'string' ? x.message : '';
  // 'relay: join timeout' → 'relay.join_timeout', 'queue: bundle 404' → 'queue.bundle_404'
  const r = /^(relay|queue|dpop|device-auth|pair|noise|session):\s*(.{1,40})$/.exec(m);
  if (r && r[1] && r[2]) {
    const c = `${r[1].replace('-', '_')}.${r[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    if (SAFE.test(c)) return c;
  }
  if (/network request failed|failed to fetch|network/i.test(m)) return 'net.unreachable';
  if (/abort|timeout/i.test(m)) return 'net.timeout';
  return 'unknown';
}

export const whyCode = (stage: PcStage, cause: string): string => {
  const c = `${stage}:${cause}`;
  return SAFE.test(c) ? c : `${stage}:unknown`;
};

/** 기록에 하나 더한다(최근 것이 뒤). 같은 코드가 이어지면 시각만 바꾼다. */
export function pushWhy(log: readonly PcWhy[] | undefined, w: PcWhy): PcWhy[] {
  const prev = log ?? [];
  const last = prev[prev.length - 1];
  const next = last && last.code === w.code ? [...prev.slice(0, -1), w] : [...prev, w];
  return next.slice(-PC_LOG_MAX);
}

/**
 * 사람이 읽는 한 줄. 개발 용어 없이 무엇이 막혔고 무엇을 하면 되는지.
 * 잘 모르는 원인은 PC를 확인하라는 말로 모은다.
 */
export function pcWhyText(code: string | null | undefined): string | null {
  if (!code) return null;
  const [stage = '', cause = ''] = code.split(':');
  // 계정 서비스 POST /v1/device-tokens 거절(services/account): 끊긴 기기·정지된 기기는 다시 연결해야 한다
  if (/^(join|queue)$/.test(stage) && /^account\.(device_not_found|device_suspended)/.test(cause)) return '이 폰의 연결이 해제됐어요. 설정에서 PC와 다시 연결해 주세요.';
  if (/^(join|queue)$/.test(stage) && cause.startsWith('account.')) return '폰 확인이 거절됐어요. 잠시 뒤 다시 하고, 계속되면 설정에서 PC와 다시 연결해 주세요.';
  if (stage === 'join' && cause.startsWith('net.')) return '인터넷에 연결되지 않았어요. 연결을 확인해 주세요.';
  if (stage === 'join') return 'PC와 잇는 길이 지금 열리지 않았어요. 잠시 뒤 다시 해 볼게요.';
  if (stage === 'peer') return 'PC가 응답하지 않았어요. PC 앱이 꺼져 있거나 로그아웃됐을 수 있어요.';
  if (stage === 'session') return 'PC가 이 폰을 받지 않았어요. 계속되면 설정에서 PC와 다시 연결해 주세요.';
  if (stage === 'live') return 'PC와 연결이 중간에 끊겼어요. 잠시 뒤 다시 해 볼게요.';
  if (stage === 'stale') return 'PC가 오래 꺼져 있었어요. PC를 켜 두거나 다시 연결해 주세요.';
  if (stage === 'queue' && cause.startsWith('net.')) return '인터넷에 연결되지 않았어요. 연결을 확인해 주세요.';
  if (stage === 'queue') return 'PC에 맡기는 길이 막혔어요. 잠시 뒤 다시 해 볼게요.';
  return null;
}

/**
 * 다시 동기화하는 동안 보일 상태. 이미 "PC 켜짐"이면 60초마다의 재접속 동안 "찾는 중"으로 깜빡이지 않게 그대로 둔다.
 * 끝나면 결과(online·offline 등)로 바뀐다.
 */
export function statusWhileSyncing<T extends string>(prev: T): T | 'connecting' {
  return prev === 'online' ? prev : 'connecting';
}
