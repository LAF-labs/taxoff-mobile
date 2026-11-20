import { CAP, CTX, VM_PURPOSES, b64, pxEnrollMessage, pxIdOf, softSigner, type Channel, type PhoneCopyBody, type PxAckBody, type PxAckState } from '@sax/remote';
import type { PxDevice } from '../approvalKey.ts';

export interface PxState {
  pxId: string;
  state: PxAckState;
  at: number;
}

const ACK_WAIT_MS = 3000;

type Ch = Pick<Channel, 'send' | 'recv' | 'closed'>;

export async function enrollPx(
  ch: Ch,
  peerCaps: readonly string[],
  o: { pairId: string; deviceId: string; vm: Uint8Array; px: PxDevice | null; onCopy?: (c: PhoneCopyBody) => Promise<void>; now?: () => number; waitMs?: number },
): Promise<PxState | null> {
  if (!o.px || !peerCaps.includes(CAP.approve)) return null;
  const pub = await o.px.ensure();
  if (!pub) return null;
  const now = o.now ?? Date.now;
  const vm = softSigner(o.vm, VM_PURPOSES);
  let sig: Uint8Array;
  try {
    sig = await vm.sign(CTX.pxEnroll, pxEnrollMessage(o.pairId, o.deviceId, pub, o.px.hw));
  } finally {
    vm.destroy();
  }
  ch.send('px.enroll', { pxPub: b64(pub), hw: o.px.hw, sig: b64(sig) });
  const pxId = pxIdOf(pub);
  const deadline = now() + (o.waitMs ?? ACK_WAIT_MS);
  for (;;) {
    const left = deadline - now();
    if (left <= 0 || ch.closed) return null;
    const e = await ch.recv(left);
    if (!e) return null;
    if (e.type === 'phone.copy' && o.onCopy) await o.onCopy(e.body as PhoneCopyBody);
    if (e.type !== 'px.ack') continue;
    const a = e.body as PxAckBody;
    if (a.pxId !== pxId) return null;
    return { pxId, state: a.state, at: now() };
  }
}
