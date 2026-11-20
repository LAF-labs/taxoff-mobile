import type { HttpJson } from '@sax/remote';
import type { Htm } from '../net/devauth';
import type { PushPlatform } from './wake';

export class PushError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`push: ${status}`);
    this.status = status;
  }
}

export function pushClient(http: HttpJson, origin: string, auth: (htm: Htm, htu: string) => Promise<Record<string, string>>) {
  const url = `${origin.replace(/\/+$/, '')}/v1/push-token`;
  return {
    async put(platform: PushPlatform, token: string): Promise<void> {
      const headers = { ...(await auth('PUT', url)), 'content-type': 'application/json' };
      const r = await http({ method: 'PUT', url, headers, body: JSON.stringify({ platform, token }) });
      if (r.status !== 204) throw new PushError(r.status);
    },
    async remove(): Promise<void> {
      const r = await http({ method: 'DELETE', url, headers: await auth('DELETE', url) });
      if (r.status !== 204 && r.status !== 404) throw new PushError(r.status);
    },
  };
}

export async function forgetPushToken(remove: () => Promise<void>, ms = 3000): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([remove().then(() => true, () => false), new Promise<boolean>((r) => (t = setTimeout(() => r(false), ms)))]);
  } finally {
    clearTimeout(t);
  }
}
