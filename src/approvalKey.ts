import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, concat, ecdsaDerToRaw, fromB64, utf8, validPxPub, type PxHw } from '../vendor/sax-remote/src/index.ts';
import type { AttestState } from './approval';

export const PX_USER_AUTH = { ios: 'biometryCurrentSet', android: 'BIOMETRIC_STRONG' } as const;

export interface ApprovalKey {
  readonly attestState: AttestState;
  sign(ctx: string, bytes: Uint8Array): Promise<{ sigAlg: 'p256'; sig: string } | null>;
}

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

export const PX_TAG = 'com.lafco.tex.px.v1';
const PX_PROMPT = '세금계산서 발급 승인';

export interface PxNative {
  pxPublic(tag: string): Promise<string | null>;
  pxCreate(tag: string): Promise<string>;
  pxSign(tag: string, dataB64: string, prompt: string): Promise<string | null>;
  pxDelete(tag: string): Promise<void>;
}

export interface PxDevice extends ApprovalKey {
  readonly hw: PxHw;
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
