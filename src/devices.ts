import { MAX_DESKTOPS, MAX_MOBILES, type HttpJson } from '../vendor/sax-remote/src/index.ts';

export type DeviceRole = 'desktop' | 'mobile';
export type DeviceState = 'pending' | 'active' | 'suspended';

export interface AccountDevice {
  deviceId: string;
  role: DeviceRole;
  platform: string;
  name: string;
  state: DeviceState;
  registeredAt: number;
  deleteAfter: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? [...v].slice(0, max).join('') : '');

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
  label: string;
  sub: string;
  attention: boolean;
  self: boolean;
  paired: boolean;
  canStop: boolean;
  stopBlocked: 'last_pc' | 'already' | null;
}

interface DevicesView {
  pcs: DeviceRow[];
  phones: DeviceRow[];
  pcCount: string;
  phoneCount: string;
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
    return days <= 0 ? '정지됨, 곧 끊겨요' : `정지됨, ${days}일 뒤 끊겨요`;
  }
  if (o.self) return '지금 쓰는 폰';
  return o.paired ? '쓰는 중, 이 폰과 연결됨' : '쓰는 중';
}

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
    pcCount: `${pcs.length}대, 최대 ${MAX_DESKTOPS}대`, phoneCount: `${phones.length}대, 최대 ${MAX_MOBILES}대`,
    pcFull: pcs.length >= MAX_DESKTOPS, phoneFull: phones.length >= MAX_MOBILES,
  };
}

export function stopConfirm(row: Pick<DeviceRow, 'label' | 'role'>): { title: string; body: string; action: string } {
  const what = row.role === 'desktop' ? 'PC' : '폰';
  return {
    title: `${row.label} 정지`,
    body: `이 ${what}는 바로 계정을 쓸 수 없게 되고 7일 뒤 연결이 끊겨요.`,
    action: '정지',
  };
}

export class DevicesError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`devices: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

type DevicesAuth = (htm: 'GET' | 'POST', htu: string) => Promise<Record<string, string>>;

const errCode = (b: unknown): string => {
  const e = (b as { error?: unknown } | null)?.error;
  return typeof e === 'string' && /^[a-z_]+\.[a-z_]+$/.test(e) ? e : 'devices.failed';
};

export function devicesClient(http: HttpJson, origin: string, auth: DevicesAuth) {
  const base = origin.replace(/\/+$/, '');
  const call = async (method: 'GET' | 'POST', path: string): Promise<{ status: number; body: unknown }> => {
    const url = `${base}${path}`;
    try {
      return await http({ method, url, headers: await auth(method, url) });
    } catch (e) {
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
    async leave(): Promise<void> {
      const r = await call('POST', '/v1/devices/self/leave');
      if (r.status !== 204) throw new DevicesError(r.status, errCode(r.body));
    },
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

export const isStopped = (code: string): boolean => code === 'account.device_suspended';

export function devicesErrorText(code: string): string {
  switch (code) {
    case 'account.last_desktop':
      return '계정에 남은 마지막 PC는 정지할 수 없어요. 다른 PC를 먼저 연결한 뒤 정지해 주세요.';
    case 'account.device_not_found':
      return '이미 끊긴 기기예요. 목록을 다시 불러올게요.';
    case 'policy.rate_limited':
      return '오늘은 더 정지할 수 없어요. 내일 다시 해 주세요.';
    case 'account.device_suspended':
      return '이 폰은 다른 기기에서 정지했거나 연결을 끊었어요. 다시 쓰려면 PC와 다시 연결해 주세요.';
    case 'devices.unreachable':
      return '인터넷에 연결되지 않았어요. 와이파이나 데이터를 켜고 다시 해 주세요.';
    default:
      return '지금은 할 수 없어요. 잠시 뒤 다시 해 주세요.';
  }
}

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
