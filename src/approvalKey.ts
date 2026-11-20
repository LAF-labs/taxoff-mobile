// 승인 키(Px) 모듈 인터페이스(D08 §6.1, ADR-016): 비가역 원격 승인은 P-256 하드웨어 키 서명으로만.
// 진짜 키(ADR-052): iOS Secure Enclave P-256(modules/sax-native pxCreate·pxSign). 서명할 때마다 생체를 확인한다.
//   공개키는 라이브 세션에서 PC에 알린다(net/pxLive.ts px.enroll). Android는 키 증명 검증기가 생길 때까지 승인 기기가 아니다.
// 소프트웨어 가짜(갤러리·시험용)도 여기 있다. 가짜 키는 PC가 받지 않는다(등록되지 않았다).
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, concat, ecdsaDerToRaw, fromB64, utf8, validPxPub, type PxHw } from '../vendor/sax-remote/src/index.ts';
import type { AttestState } from './approval';

/**
 * 승인 서명 키(Px)와 시작 게이트의 사용자 인증: 생체만(D08 §3.1, 2026-11-17 대표 결정 뒤에도 그대로).
 * 앱 잠금은 폰 암호 대체를 받지만(keyring.ts APP_USER_AUTH) 비가역 승인은 받지 않는다. iOS 네이티브(pxCreate)가 이 정책으로 키를 만든다.
 */
export const PX_USER_AUTH = { ios: 'biometryCurrentSet', android: 'BIOMETRIC_STRONG' } as const;

export interface ApprovalKey {
  /** hw: 하드웨어 키 생성이 증명됨 · ios_se: Secure Enclave 키(증명 없음, ADR-052) · ios_app_attest: 앱 무결성만 · none: 승인 기기로 못 씀 */
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

// ---- 진짜 키 ----

/** 키체인 application tag. 바꾸면 새 키가 만들어지고 PC에 다시 알려진다. */
export const PX_TAG = 'com.lafco.tex.px.v1';
/** Touch ID 창에 보이는 한 줄(Face ID는 OS 문구만 보인다) */
const PX_PROMPT = '세금계산서 발급 승인';

/** 네이티브 모듈 중 승인 키가 쓰는 부분(modules/sax-native). 시험은 가짜를 넣는다. */
export interface PxNative {
  pxPublic(tag: string): Promise<string | null>;
  pxCreate(tag: string): Promise<string>;
  pxSign(tag: string, dataB64: string, prompt: string): Promise<string | null>;
  pxDelete(tag: string): Promise<void>;
}

export interface PxDevice extends ApprovalKey {
  readonly hw: PxHw;
  /** 지금 키의 공개키(SEC1 65바이트). 없으면 만든다. 못 만들면(생체 미등록·Secure Enclave 없음) null. 생체를 묻지 않는다. */
  ensure(): Promise<Uint8Array | null>;
}

const pubOf = (s: string | null): Uint8Array | null => {
  if (!s) return null;
  try {
    const pub = fromB64(s);
    return validPxPub(pub) ? pub : null;
  } catch {
    return null;
  }
};

/**
 * 하드웨어 승인 키. 네이티브에 px 함수가 없으면(옛 빌드·Android·웹) null.
 * 서명이 취소가 아닌 이유로 실패하면 키를 지운다: 생체를 다시 등록하면 키가 죽는데(biometryCurrentSet) 밖에서 구분할 수 없다.
 * 다음 연결 때 새 키를 만들어 PC에 다시 알린다. 그 사이 승인은 PC에서 한다.
 */
export function deviceApprovalKey(native: Partial<PxNative> | null | undefined, hw: PxHw = 'ios_se', tag = PX_TAG): PxDevice | null {
  if (!native?.pxPublic || !native.pxCreate || !native.pxSign || !native.pxDelete) return null;
  const n = native as PxNative;
  return {
    hw,
    attestState: 'ios_se',
    async ensure() {
      try {
        return pubOf((await n.pxPublic(tag)) ?? (await n.pxCreate(tag)));
      } catch {
        return null;
      }
    },
    async sign(ctx, bytes) {
      let der: string | null;
      try {
        der = await n.pxSign(tag, b64(concat(utf8(ctx), bytes)), PX_PROMPT);
      } catch (e) {
        if (/px_sign_failed|px_missing/.test(String((e as Error)?.message ?? e))) await n.pxDelete(tag).catch(() => undefined);
        return null;
      }
      if (der === null) return null;
      const raw = ecdsaDerToRaw(fromB64(der));
      return raw ? { sigAlg: 'p256', sig: b64(raw) } : null;
    },
  };
}
