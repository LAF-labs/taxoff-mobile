
type PcStage = 'join' | 'peer' | 'session' | 'live' | 'queue' | 'stale';

export interface PcWhy {
  code: string;
  at: number;
}

export const PC_LOG_MAX = 20;

const SAFE = /^[a-z0-9_.:-]{1,48}$/;

export function causeOf(e: unknown): string {
  const x = e as { code?: unknown; status?: unknown; message?: unknown } | null;
  if (x && typeof x.code === 'string' && /^[a-z_]+\.[a-z_]+$/.test(x.code)) {
    return typeof x.status === 'number' ? `${x.code}.${x.status}` : x.code;
  }
  const m = typeof x?.message === 'string' ? x.message : '';
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

export function pushWhy(log: readonly PcWhy[] | undefined, w: PcWhy): PcWhy[] {
  const prev = log ?? [];
  const last = prev[prev.length - 1];
  const next = last && last.code === w.code ? [...prev.slice(0, -1), w] : [...prev, w];
  return next.slice(-PC_LOG_MAX);
}

export function pcWhyText(code: string | null | undefined): string | null {
  if (!code) return null;
  const [stage = '', cause = ''] = code.split(':');
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

/** 다시 살피는 동안에는 알던 상태를 그대로 둔다(1분마다 'PC 찾는 중'이 깜빡이지 않게). 처음 한 번만 찾는 중이다. */
export function statusWhileSyncing<T extends string>(prev: T): T | 'connecting' {
  return prev === 'unpaired' ? 'connecting' : prev;
}

/** 이 폰의 연결이 서버에서 풀렸다: PC를 켜도 다시 연결하기 전에는 이어지지 않는다. */
export function needsRelink(code: string | null | undefined): boolean {
  if (!code) return false;
  const [stage = '', cause = ''] = code.split(':');
  return /^(join|queue)$/.test(stage) && /^account\.(device_not_found|device_suspended)/.test(cause);
}

/** 맡긴 발급의 한 줄. 연결이 풀린 것과 PC가 꺼진 것은 다르다: 꺼져 있으면 켜지는 대로 발급하고, 풀렸으면 다시 연결해야 간다. */
export function entrustNote(pc: string, what: string): string | null {
  if (pc === 'online') return null;
  if (pc === 'relink' || pc === 'stale') return `${what}을 이 폰에 두었어요. 다시 연결하면 바로 발급해요`;
  return `${what}을 맡겼어요. PC가 켜지면 바로 발급해요`;
}
