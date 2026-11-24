import { b64, fromB64, readShareKeyBody, type ShareKeyBody, type ShareKeySet } from '@sax/remote';
import type { AppData, ShareState } from '../storage/state';

interface Recv<E> {
  recv(timeoutMs: number): Promise<E | null>;
}

/**
 * PC는 세션을 열자마자, 그리고 계정 열쇠 세대가 오를 때 share.key를 보낸다(ADR-064). 어느 단계에서 오든 받아 넘기고,
 * 다른 단계(사본 받기, 발급 명령)에는 보이지 않게 한다. 기다리던 시간은 그대로 둔다.
 */
export function catchingShareKey<C extends Recv<E>, E extends { type: string; body?: unknown }>(ch: C, onKey: (body: ShareKeyBody) => void): C {
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') {
        return async (ms: number) => {
          const until = Date.now() + ms;
          for (;;) {
            const e = await t.recv(Math.max(0, until - Date.now()));
            if (!e || e.type !== 'share.key') return e;
            onKey(e.body as ShareKeyBody);
          }
        };
      }
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

export function shareSetOf(s: ShareState | null | undefined, pairId: string): ShareKeySet | null {
  if (!s || s.pairId !== pairId) return null;
  try {
    return { signPub: fromB64(s.signPub), keys: s.keys.map(fromB64) };
  } catch {
    return null;
  }
}

/**
 * 받은 열쇠를 넣는다. 이미 가진 세대는 값이 같아야 하고 서명 키도 같아야 한다(readShareKeyBody).
 * 맞지 않으면 가진 것을 그대로 두고 'rejected'를 돌려준다(계정 열쇠가 바뀐 PC는 다시 연결해야 한다).
 */
export function withShareKey(d: AppData, body: ShareKeyBody): { next: AppData; result: 'saved' | 'same' | 'rejected' } {
  const pair = d.pair;
  if (!pair) return { next: d, result: 'rejected' };
  const have = shareSetOf(d.share, pair.pairId);
  const got = readShareKeyBody(body, have);
  if (!got) return { next: d, result: 'rejected' };
  if (have && have.keys.length === got.keys.length) return { next: d, result: 'same' };
  return { next: { ...d, share: { pairId: pair.pairId, signPub: b64(got.signPub), keys: got.keys.map((k) => b64(k)) } }, result: 'saved' };
}
