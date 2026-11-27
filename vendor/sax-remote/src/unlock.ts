import { concat, utf8 } from './bytes.ts';
import { encodeCbor } from './cbor.ts';
import { CTX } from './contexts.ts';
import { ed25519Verify, sha256Hash } from './crypto.ts';
import { PX_HW, validPxPub } from './approve.ts';
import type { PxHw } from './envelope.ts';

/**
 * PC 잠금 풀기(ADR-061 결정 3, 5). 폰 풀기 키 Ux의 등록 알림과 풀기 답의 AAD.
 * 금고(poc/packages/vault/src/keychain/lockkey.ts)의 unlockGrantAad와 같은 바이트를 만든다.
 */

export const UNLOCK_GRANT_INFO = 'SAX-unlock-grant-v1';
export const UNLOCK_E_LEN = 65;
export const UNLOCK_N_LEN = 32;
/** 풀기 답 봉인문 길이: Z(32B) + ChaCha20-Poly1305 태그(16B). */
export const UNLOCK_GRANT_CT_LEN = 48;

/** 등록 알림의 서명 대상(컨텍스트 제외). Px 등록과 같은 모양이다. */
export function uxEnrollMessage(pairId: string, deviceId: string, uxPub: Uint8Array, hw: PxHw): Uint8Array {
  return encodeCbor([pairId, deviceId, uxPub, hw]);
}

/** 폰 Vm이 서명한 풀기 키 등록 알림인지(PC). */
export function verifyUxEnroll(vmPub: Uint8Array, pairId: string, deviceId: string, uxPub: Uint8Array, hw: PxHw, sig: Uint8Array): boolean {
  if (!validPxPub(uxPub) || !PX_HW.includes(hw)) return false;
  return ed25519Verify(vmPub, CTX.uxEnroll, uxEnrollMessage(pairId, deviceId, uxPub, hw), sig);
}

/** utf8 길이 2바이트(빅엔디언)를 앞에 붙인다. */
function lp(s: string): Uint8Array {
  const b = utf8(s);
  if (b.length > 0xffff) throw new Error('unlock: field too long');
  return concat(Uint8Array.of(b.length >> 8, b.length & 0xff), b);
}

/** unlock.grant 봉인의 AAD: SHA-256(lp(unlockId) ‖ n ‖ lp(pcDeviceId) ‖ lp(phoneDeviceId) ‖ E). */
export function unlockGrantAad(unlockId: string, n: Uint8Array, pcDeviceId: string, phoneDeviceId: string, e: Uint8Array): Uint8Array {
  if (n.length !== UNLOCK_N_LEN || e.length !== UNLOCK_E_LEN) throw new Error('unlock: bad request');
  return sha256Hash(concat(lp(unlockId), n, lp(pcDeviceId), lp(phoneDeviceId), e));
}
