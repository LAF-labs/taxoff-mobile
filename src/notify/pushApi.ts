// 푸시 토큰 서버 API(tex poc/services/push/API.md): PUT·DELETE /v1/push-token, 기기 토큰(push 범위) + DPoP.
// OS와 무관해 시험한다(test/push-wake.spec.ts).
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

/** 서버 부르기. auth는 요청마다 DPoP 머리를 만든다(net/devauth.ts deviceAuthFor). */
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
      // 404: 이미 없다(서버가 무효 토큰을 지웠거나 기기가 정지됐다). 지우려던 것과 같다
      if (r.status !== 204 && r.status !== 404) throw new PushError(r.status);
    },
  };
}

/** 푸시 토큰 지우기(3초 안에, 실패해도 넘어간다) */
export async function forgetPushToken(remove: () => Promise<void>, ms = 3000): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([remove().then(() => true, () => false), new Promise<boolean>((r) => (t = setTimeout(() => r(false), ms)))]);
  } finally {
    clearTimeout(t);
  }
}
