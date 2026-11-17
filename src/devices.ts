// 계정에 연결된 기기(ADR-048 결정 1·6): PC 3대·폰 3대까지. 이 폰에서 목록을 보고, 이 폰을 계정에서 빼고, 잃어버린 기기를 멈춘다.
// - 폰은 계정 열쇠(AIK)가 없어서 다른 기기를 "끊기"까지는 못 하고 "정지"까지만 한다. 정지한 기기는 7일 뒤 끊기고,
//   그 전에 켜져 있는 PC가 바로 끊거나 정지를 풀 수 있다. 계정에 남은 마지막 PC는 정지할 수 없다(훔친 폰으로 계정을 잠그지 못하게).
// - 이 폰 나가기는 서버에 먼저 알린다(자리가 바로 빈다). 서버에 닿지 못해도 이 폰의 열쇠와 자료는 지운다.
// - 이 파일은 화면과 망 호출 사이의 규칙만 둔다(React·기기 저장소 없음). 화면은 screens/DevicesScreen.tsx, 인증은 net/devauth.ts.
import { MAX_DESKTOPS, MAX_MOBILES, type HttpJson } from '../vendor/sax-remote/src/index.ts';

export type DeviceRole = 'desktop' | 'mobile';
/** pending: 연결 중, active: 쓰는 중, suspended: 정지됨(7일 뒤 끊김) */
export type DeviceState = 'pending' | 'active' | 'suspended';

/** 계정 서비스 GET /v1/devices의 한 줄 가운데 이 앱이 쓰는 칸. 키(Sx·Vx)는 받지 않는다. */
export interface AccountDevice {
  deviceId: string;
  role: DeviceRole;
  platform: string;
  name: string;
  state: DeviceState;
  registeredAt: number;
  /** 정지된 기기가 완전히 끊기는 시각(ms). 없으면 null */
  deleteAfter: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? [...v].slice(0, max).join('') : '');

/**
 * 서버 응답을 읽는다. 끊긴(revoked) 기기는 뺀다. 모양이 다른 줄이 하나라도 있으면 null(반쯤 맞는 목록을 보이지 않는다).
 * 이름·플랫폼은 서버가 준 참고 값이라 길이만 자른다.
 */
export function parseDevices(body: unknown): AccountDevice[] | null {
  const list = (body as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(list) || list.length > 64) return null;
  const out: AccountDevice[] = [];
  for (const raw of list) {
    const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof d.deviceId !== 'string' || !UUID.test(d.deviceId) || (d.role !== 'desktop' && d.role !== 'mobile')) return null;
    if (d.state === 'revoked') continue;
    if (d.state !== 'pending' && d.state !== 'active' && d.state !== 'suspended') return null;
    if (!Number.isSafeInteger(d.registeredAt) || !(d.deleteAfter === null || d.deleteAfter === undefined || Number.isSafeInteger(d.deleteAfter))) return null;
    out.push({
      deviceId: d.deviceId, role: d.role, platform: str(d.platform, 20), name: str(d.name, 40).trim(), state: d.state,
      registeredAt: d.registeredAt as number, deleteAfter: (d.deleteAfter as number | null | undefined) ?? null,
    });
  }
  return out;
}

export interface DeviceRow {
  deviceId: string;
  role: DeviceRole;
  /** 보일 이름. 이 폰은 "이 폰", 이름이 없으면 종류로 */
  label: string;
  /** 상태 한 줄 */
  sub: string;
  /** 주의 색으로 보일 줄(정지됨) */
  attention: boolean;
  /** 이 폰 */
  self: boolean;
  /** 이 폰이 직접 연결한 PC(사진을 보내고 승인을 받는 PC) */
  paired: boolean;
  /** 이 폰에서 정지할 수 있다 */
  canStop: boolean;
  /** 정지할 수 없는 이유(화면이 눌렀을 때 알린다). 정지할 수 있거나 이 폰이면 null */
  stopBlocked: 'last_pc' | 'already' | null;
}

export interface DevicesView {
  pcs: DeviceRow[];
  phones: DeviceRow[];
  /** "PC 2대 · 3대까지" 같은 묶음 제목 옆 글 */
  pcCount: string;
  phoneCount: string;
  /** 한도에 닿았다(새 기기를 연결하려면 하나를 끊어야 한다) */
  pcFull: boolean;
  phoneFull: boolean;
}

const DAY = 86_400_000;
const platformName = (role: DeviceRole, platform: string): string => {
  const p = platform.toLowerCase();
  if (role === 'desktop') return p === 'darwin' || p === 'macos' || p === 'mac' ? 'Mac' : p === 'win32' || p === 'windows' ? 'Windows PC' : 'PC';
  return p === 'ios' ? 'iPhone' : p === 'android' ? 'Android 폰' : '폰';
};

function subOf(d: AccountDevice, o: { self: boolean; paired: boolean; now: number }): string {
  if (d.state === 'pending') return '연결하는 중';
  if (d.state === 'suspended') {
    if (d.deleteAfter === null) return '정지됨';
    const days = Math.ceil((d.deleteAfter - o.now) / DAY);
    return days <= 0 ? '정지됨 · 곧 끊겨요' : `정지됨 · ${days}일 뒤 끊겨요`;
  }
  if (o.self) return '지금 쓰는 폰';
  return o.paired ? '쓰는 중 · 이 폰과 연결됨' : '쓰는 중';
}

/**
 * 화면에 보일 목록. 이 폰이 맨 위, 이 폰과 연결한 PC가 PC 묶음의 맨 위, 나머지는 연결한 순서.
 * 한도에는 연결 중·정지된 기기도 센다(서버와 같다).
 */
export function devicesView(devices: readonly AccountDevice[], o: { selfId: string; pairedPcId: string | null; now: number }): DevicesView {
  const activePcs = devices.filter((d) => d.role === 'desktop' && d.state === 'active').length;
  const row = (d: AccountDevice): DeviceRow => {
    const self = d.deviceId === o.selfId;
    const paired = d.role === 'desktop' && d.deviceId === o.pairedPcId;
    const stopBlocked = self ? null : d.state === 'suspended' ? 'already' : d.role === 'desktop' && d.state === 'active' && activePcs <= 1 ? 'last_pc' : null;
    return {
      deviceId: d.deviceId, role: d.role, self, paired,
      label: self ? '이 폰' : d.name || platformName(d.role, d.platform),
      sub: subOf(d, { self, paired, now: o.now }),
      attention: d.state === 'suspended',
      canStop: !self && stopBlocked === null,
      stopBlocked,
    };
  };
  const order = (a: AccountDevice, b: AccountDevice): number => {
    const top = (d: AccountDevice) => (d.deviceId === o.selfId || d.deviceId === o.pairedPcId ? 0 : 1);
    return top(a) - top(b) || a.registeredAt - b.registeredAt || (a.deviceId < b.deviceId ? -1 : 1);
  };
  const pcs = devices.filter((d) => d.role === 'desktop').sort(order);
  const phones = devices.filter((d) => d.role === 'mobile').sort(order);
  return {
    pcs: pcs.map(row), phones: phones.map(row),
    pcCount: `${pcs.length}대 · ${MAX_DESKTOPS}대까지`, phoneCount: `${phones.length}대 · ${MAX_MOBILES}대까지`,
    pcFull: pcs.length >= MAX_DESKTOPS, phoneFull: phones.length >= MAX_MOBILES,
  };
}

/** 정지 확인 창의 글(무엇이 일어나는지 한 번에). */
export function stopConfirm(row: Pick<DeviceRow, 'label' | 'role'>): { title: string; body: string; action: string } {
  const what = row.role === 'desktop' ? 'PC' : '폰';
  return {
    title: `${row.label} 정지`,
    body: `이 ${what}는 바로 계정을 쓸 수 없게 되고 7일 뒤 연결이 끊겨요.`,
    action: '정지',
  };
}

// ---- 계정 서비스 호출 ----

export class DevicesError extends Error {
  readonly status: number;
  /** 서버 코드(account.last_desktop 등). 서버에 닿지 못했으면 devices.unreachable, 응답 모양이 다르면 devices.bad_response */
  readonly code: string;
  constructor(status: number, code: string) {
    super(`devices: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

export type DevicesAuth = (htm: 'GET' | 'POST', htu: string) => Promise<Record<string, string>>;

const errCode = (b: unknown): string => {
  const e = (b as { error?: unknown } | null)?.error;
  return typeof e === 'string' && /^[a-z_]+\.[a-z_]+$/.test(e) ? e : 'devices.failed';
};

/** 기기 토큰(범위 devices)으로 부르는 세 가지. auth는 요청마다 DPoP 머리를 만든다(net/devauth.ts deviceAuthFor). */
export function devicesClient(http: HttpJson, origin: string, auth: DevicesAuth) {
  const base = origin.replace(/\/+$/, '');
  const call = async (method: 'GET' | 'POST', path: string): Promise<{ status: number; body: unknown }> => {
    const url = `${base}${path}`;
    try {
      return await http({ method, url, headers: await auth(method, url) });
    } catch (e) {
      // 토큰을 받는 단계에서 서버가 거절한 것(끊긴 기기 등)은 그 코드를 그대로 올린다
      const c = (e as { code?: unknown; status?: unknown } | null) ?? {};
      if (typeof c.code === 'string' && /^[a-z_]+\.[a-z_]+$/.test(c.code)) throw new DevicesError(typeof c.status === 'number' ? c.status : 0, c.code);
      throw new DevicesError(0, 'devices.unreachable');
    }
  };
  return {
    async list(): Promise<AccountDevice[]> {
      const r = await call('GET', '/v1/devices');
      if (r.status !== 200) throw new DevicesError(r.status, errCode(r.body));
      const out = parseDevices(r.body);
      if (!out) throw new DevicesError(200, 'devices.bad_response');
      return out;
    },
    /** 이 폰이 계정에서 나간다. 서버가 바로 끊고 자리를 비운다. */
    async leave(): Promise<void> {
      const r = await call('POST', '/v1/devices/self/leave');
      if (r.status !== 204) throw new DevicesError(r.status, errCode(r.body));
    },
    /** 다른 기기를 정지한다. 끊기는 시각(ms)을 돌려준다. */
    async stop(deviceId: string): Promise<{ deleteAfter: number }> {
      if (!UUID.test(deviceId)) throw new DevicesError(0, 'request.param_rejected');
      const r = await call('POST', `/v1/devices/${deviceId}/stop`);
      const after = (r.body as { deleteAfter?: unknown } | null)?.deleteAfter;
      if (r.status !== 202) throw new DevicesError(r.status, errCode(r.body));
      if (!Number.isSafeInteger(after)) throw new DevicesError(202, 'devices.bad_response');
      return { deleteAfter: after as number };
    },
  };
}

/**
 * 이 폰이 계정에서 멈췄다는 서버 답: 다른 기기에서 정지했거나 끊었다. 서버는 둘을 같은 코드로 답한다(기기 토큰을 주지 않는다).
 * 정지는 PC가 풀 수 있으므로 앱이 스스로 자료를 지우지 않는다. 화면이 알리고, 지우기는 사람이 고른다.
 */
export const isStopped = (code: string): boolean => code === 'account.device_suspended';

/** 오류 코드를 사람 말로. 값은 넣지 않는다. */
export function devicesErrorText(code: string): string {
  switch (code) {
    case 'account.last_desktop':
      return '계정에 남은 마지막 PC는 정지할 수 없어요.';
    case 'account.device_not_found':
      return '이미 끊긴 기기예요. 목록을 다시 불러올게요.';
    case 'policy.rate_limited':
      return '오늘은 더 정지할 수 없어요. 내일 다시 하거나 PC의 기기 연결 화면에서 끊어 주세요.';
    case 'account.device_suspended':
      return '이 폰은 다른 기기에서 정지했거나 연결을 끊었어요.';
    case 'devices.unreachable':
      return '서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.';
    default:
      return '지금은 할 수 없어요. 잠시 뒤 다시 해 주세요.';
  }
}

/**
 * 이 폰 나가기: 서버에 먼저 알리고(4초 안에), 닿든 못 닿든 이 폰의 열쇠와 자료를 지운다.
 * told가 false면 서버 자리가 남아 있을 수 있다: 화면이 "PC의 기기 연결 화면에 이 폰이 남아 있으면 끊어 주세요"를 보인다.
 */
export async function leaveThisPhone(o: { leave: () => Promise<void>; reset: () => Promise<void>; timeoutMs?: number }): Promise<{ told: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const told = await Promise.race([
    o.leave().then(() => true, () => false),
    new Promise<boolean>((res) => {
      timer = setTimeout(() => res(false), o.timeoutMs ?? 4000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  await o.reset();
  return { told };
}
