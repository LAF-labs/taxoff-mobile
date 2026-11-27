import { CAP, CTX, VM_PURPOSES, b64, softSigner, uxEnrollMessage, type Channel, type PhoneCopyBody, type UxAckBody, type UxAckState } from '@sax/remote';
import { readAsk, type UnlockDesk, type UxDevice } from '../unlock.ts';

export interface UxState {
  state: UxAckState;
  at: number;
}

type Ch = Pick<Channel, 'send' | 'recv' | 'closed'>;

const ACK_WAIT_MS = 3000;
/** 답할 풀기 요청이 있는 동안은 이 간격으로 답을 보낸다. */
const UNLOCK_TICK_MS = 250;

/**
 * 세션 채널을 감싸 풀기 요청을 받고 답을 보낸다. 받는 쪽(px 등록, 맡긴 일 돌리기)은 그대로 쓴다.
 * - unlock.request는 desk에 넣고 그대로 넘긴다(다른 받는 쪽은 모르는 종류라 건너뛴다).
 * - 받기를 기다리는 사이 desk에 쌓인 답을 보낸다. 답할 요청이 있으면 짧게 끊어 기다린다.
 */
export function unlockAware<C extends Ch>(ch: C, o: { desk: UnlockDesk; pcDeviceId: string; phoneDeviceId: string; pcName: string; now?: () => number }): C {
  const now = o.now ?? Date.now;
  const flush = () => {
    const items = o.desk.take();
    for (let i = 0; i < items.length; i++) {
      try {
        ch.send('unlock.grant', items[i]!.body);
      } catch {
        // 세션이 닫혔다: 남은 답은 다음 세션에서 보낸다.
        o.desk.putBack(items.slice(i));
        return;
      }
    }
  };
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') {
        return async (ms: number) => {
          const end = now() + ms;
          for (;;) {
            flush();
            const left = end - now();
            if (left <= 0 || t.closed) return null;
            const e = await t.recv(o.desk.waiting() ? Math.min(left, UNLOCK_TICK_MS) : left);
            if (e?.type === 'unlock.request') {
              const a = readAsk(e.body, o, now());
              if (a) o.desk.offer(a);
            }
            if (e) return e;
          }
        };
      }
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** 세션마다 풀기 키(Ux) 공개키를 PC에 알린다(ux.enroll). Px 등록과 같은 길이다. */
export async function enrollUx(
  ch: Ch,
  peerCaps: readonly string[],
  o: { pairId: string; deviceId: string; vm: Uint8Array; ux: UxDevice | null; onCopy?: (c: PhoneCopyBody) => Promise<void>; now?: () => number; waitMs?: number },
): Promise<UxState | null> {
  if (!o.ux || !peerCaps.includes(CAP.unlock)) return null;
  const pub = await o.ux.ensure();
  if (!pub) return null;
  const now = o.now ?? Date.now;
  const vm = softSigner(o.vm, VM_PURPOSES);
  let sig: Uint8Array;
  try {
    sig = await vm.sign(CTX.uxEnroll, uxEnrollMessage(o.pairId, o.deviceId, pub, o.ux.hw));
  } finally {
    vm.destroy();
  }
  ch.send('ux.enroll', { uxPub: b64(pub), hw: o.ux.hw, sig: b64(sig) });
  const deadline = now() + (o.waitMs ?? ACK_WAIT_MS);
  for (;;) {
    const left = deadline - now();
    if (left <= 0 || ch.closed) return null;
    const e = await ch.recv(left);
    if (!e) return null;
    if (e.type === 'phone.copy' && o.onCopy) await o.onCopy(e.body as PhoneCopyBody);
    if (e.type !== 'ux.ack') continue;
    return { state: (e.body as UxAckBody).state, at: now() };
  }
}

/** 답할 풀기 요청이 남아 있으면 세션을 닫지 않고 답이 나가거나 시간이 지날 때까지 기다린다. */
export async function holdForUnlock(ch: Ch, desk: UnlockDesk, alive?: () => boolean): Promise<void> {
  while (desk.waiting() && !ch.closed && (!alive || alive())) await ch.recv(UNLOCK_TICK_MS);
}
