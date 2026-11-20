import { DeviceTokenCache, VM_PURPOSES, deviceAuthHeaders, requestDeviceToken, softSigner, type DpopSigner, type HttpJson, type SignedCert } from '@sax/remote';
import { deviceModel } from '../deviceModel';
import { accountOrigin } from './account';

export const fetchJson: HttpJson = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

async function withVm<T>(vm: Uint8Array, f: (k: DpopSigner) => Promise<T>): Promise<T> {
  const k = softSigner(vm, VM_PURPOSES);
  try {
    return await f(k);
  } finally {
    k.destroy();
  }
}

let cache: { pairId: string; c: DeviceTokenCache } | null = null;

export function clearDeviceToken(): void {
  cache?.c.clear();
  cache = null;
}

export type Htm = 'GET' | 'POST' | 'PUT' | 'DELETE';

export function deviceAuthFor(pairId: string, cert: SignedCert, vm: Uint8Array): (htm: Htm, htu: string) => Promise<Record<string, string>> {
  if (!cache || cache.pairId !== pairId) {
    const withModel: HttpJson = (req) => fetchJson({ ...req, body: JSON.stringify({ ...(JSON.parse(req.body!) as object), model: deviceModel() }) });
    cache = { pairId, c: new DeviceTokenCache(() => withVm(vm, (k) => requestDeviceToken(withModel, accountOrigin(), cert, k))) };
  }
  const c = cache.c;
  return async (htm, htu) => {
    const token = await c.token();
    return withVm(vm, (k) => deviceAuthHeaders(token, k, htm, htu));
  };
}
