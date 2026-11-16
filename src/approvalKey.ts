// 승인 키(Px) 모듈 인터페이스(D08 §6.1, ADR-016): 비가역 원격 승인은 P-256 하드웨어 키 서명으로만.
// 진짜 구현(생체 확인이 걸린 Secure Enclave·StrongBox 키, 등록·증명)은 다음 PR이다. 여기에는 인터페이스와
// 소프트웨어 가짜(갤러리·시험용)만 있다. 가짜 키는 PC가 받지 않는다(증명 상태가 없고 등록되지 않았다).
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, concat, utf8 } from '../vendor/sax-remote/src/index.ts';
import type { AttestState } from './approval';

export interface ApprovalKey {
  /** hw: 하드웨어 키 생성이 증명됨 · ios_app_attest: 앱 무결성만(iPhone, ADR-046 결정 4) · none: 승인 기기로 못 씀 */
  readonly attestState: AttestState;
  /**
   * 생체 확인 → 하드웨어 키로 서명. 서명 입력은 ctx ‖ bytes(@sax/remote signInput과 같은 배치).
   * 사용자가 생체 확인을 취소하면 null.
   */
  sign(ctx: string, bytes: Uint8Array): Promise<{ sigAlg: 'p256'; sig: string } | null>;
}

/** 갤러리·시험용 가짜. 키는 메모리에만 있고 앱을 다시 열면 바뀐다. */
export function fakeApprovalKey(attestState: AttestState, opts: { cancel?: boolean } = {}): ApprovalKey {
  const sk = p256.utils.randomSecretKey();
  return {
    attestState,
    async sign(ctx, bytes) {
      if (attestState === 'none') throw new Error('approval_key.none');
      if (opts.cancel) return null;
      const sig = p256.sign(sha256(concat(utf8(ctx), bytes)), sk, { prehash: false });
      return { sigAlg: 'p256', sig: b64(sig) };
    },
  };
}
