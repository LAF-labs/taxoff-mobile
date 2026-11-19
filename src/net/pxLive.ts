// 승인 키(Px) 알리기(remote-envelope v1.10 px.enroll → px.ack, ADR-052 결정 1·2).
// - PC가 approve.v1을 알린 라이브 세션마다 한 번 보낸다. 같은 키면 PC는 그대로 두고, 키가 바뀌었으면(생체 재등록 등) 바꿔 적는다.
// - 알림은 폰 기기 키(Vm)로 서명한다: "SAX-px-enroll-v1" ‖ CBOR([pairId, deviceId, pxPub, hw]). 세션은 이미 Noise로 서로 확인됐다.
// - 답 enrolled: 이 폰에서 승인할 수 있다. needs_pc: PC에서 폰 승인을 꺼 두었다. rejected: PC가 이 키를 받지 않는다.
import { CAP, CTX, VM_PURPOSES, b64, pxEnrollMessage, pxIdOf, softSigner, type Channel, type PhoneCopyBody, type PxAckBody, type PxAckState } from '@sax/remote';
import type { PxDevice } from '../approvalKey.ts';

/** 봉인 상태 파일에 두는 승인 키 상태(공개 정보뿐이다) */
export interface PxState {
  /** SHA-256(pxPub) 앞 8바이트 hex. PC 기기 화면과 맞춰 볼 수 있다 */
  pxId: string;
  state: PxAckState;
  /** 마지막으로 PC의 답을 받은 시각 */
  at: number;
}

const ACK_WAIT_MS = 3000;

type Ch = Pick<Channel, 'send' | 'recv' | 'closed'>;

/**
 * 승인 키를 PC에 알리고 답을 기다린다. 알리지 않았거나(PC가 모름·키 없음) 답이 없으면 null(앞 상태를 그대로 둔다).
 * 기다리는 동안 온 사본은 onCopy로 넘기고, 그 밖의 봉투는 버린다(이때는 아직 명령을 보내기 전이다).
 */
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
    // 다른 키의 답이면(있을 수 없다) 믿지 않는다
    if (a.pxId !== pxId) return null;
    return { pxId, state: a.state, at: now() };
  }
}
