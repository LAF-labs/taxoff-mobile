// 폰 장기 키(Sm·Vm·Km)와 로컬 파일 키. ADR-029·D08 §2: ThisDeviceOnly, 백업 제외, 서버는 열쇠를 갖지 않는다.
//  - 한 키 항목에 모두 담는다(앱 진입 키: Sm·Vm·Km·파일 키. 우편함 토큰 등은 이 파일 키로 봉인한 상태 파일 안에 있다).
//  - D08 §3.1 '앱 잠금'(2026-11-17 대표 결정 "비밀번호 허용"): 이 항목은 생체 또는 폰 암호로 열린다
//    (iOS userPresence, Android BIOMETRIC_STRONG|DEVICE_CREDENTIAL, 네이티브 vault*). 앱 잠금(P-01) 해제 = 이 항목 읽기.
//  - 승인 서명 키(Px)와 시작 게이트는 이것과 별개로 생체만이다(approvalKey.ts PX_USER_AUTH). 여기 정책을 그쪽에 쓰지 않는다.
//  - iOS: WHEN_PASSCODE_SET_THIS_DEVICE_ONLY. 폰 암호가 없으면 저장되지 않고, 끄면 항목이 지워진다. 약한 등급으로 내려가지 않는다.
//  - 옛 항목(expo-secure-store, 생체 전용)은 첫 잠금 해제 때 한 번 새 정책으로 다시 저장하고 지운다(keyMigrate.ts).
//  - 재설치: iOS 키체인은 앱 삭제 뒤에도 남으므로, 문서 폴더의 설치 표지가 없으면 첫 실행에서 지운다.
// 비밀 값·키 바이트를 로그에 넣지 않는다.
import * as SecureStore from 'expo-secure-store';
import { b64, ed25519Keygen, ed25519Public, fromB64, newFileKey, uuid4, wipe, x25519Keygen, x25519Public } from '@sax/remote';
import SaxNative from '../modules/sax-native/src/SaxNativeModule';
import { DEV_LOCAL } from './config';
import { readWithMigration } from './keyMigrate';
import { installMarker, wipeAppData, writeInstallMarker } from './storage/files';

const ITEM = 'sax.device.v1';
const SERVICE = 'com.lafco.tex.keys';

export type KeyringErrorCode = 'passcode_required' | 'biometry_required' | 'cancelled' | 'corrupt' | 'unavailable';
export class KeyringError extends Error {
  readonly code: KeyringErrorCode;
  /** 원인 문구(OS 오류 코드 등, 값·키 없음). */
  constructor(code: KeyringErrorCode, cause?: string) {
    super(cause ? `keyring: ${code} (${cause.slice(0, 160)})` : `keyring: ${code}`);
    this.code = code;
  }
}

/** 메모리에 있는 동안만 살아 있다. 잠그면 forget()으로 지운다. */
export interface DeviceKeys {
  deviceId: string;
  sm: Uint8Array;
  vm: Uint8Array;
  km: Uint8Array;
  fileKey: Uint8Array;
  smPub: Uint8Array;
  vmPub: Uint8Array;
  kmPub: Uint8Array;
}

interface Stored {
  v: 1;
  deviceId: string;
  sm: string;
  vm: string;
  km: string;
  fileKey: string;
}

const AUTH_PROMPT = '앱을 열려면 확인해 주세요';

/** 앱 진입 키 항목의 사용자 인증: 생체 또는 폰 암호(D08 §3.1). 네이티브 vault*가 이 정책으로 저장한다. */
export const APP_USER_AUTH = { ios: 'userPresence', android: 'BIOMETRIC_STRONG|DEVICE_CREDENTIAL' } as const;

/** 실기기·릴리스의 새 항목: 네이티브 vault(생체 또는 폰 암호 + 암호 설정 + 이 기기만). 없는 빌드는 열지 않는다(fail-closed). */
function vault() {
  const v = SaxNative;
  if (!v?.vaultGet || !v.vaultSet || !v.vaultDelete) throw new KeyringError('unavailable', 'vault_missing');
  return v as Required<Pick<NonNullable<typeof SaxNative>, 'vaultGet' | 'vaultSet' | 'vaultDelete'>>;
}

/** 시뮬레이터 개발 빌드만 인증 없이(여전히 이 기기만). */
function devOptions(): SecureStore.SecureStoreOptions {
  return { keychainService: SERVICE, keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
}

/** 옛 항목(PR #12까지): expo-secure-store, 생체 전용(biometryCurrentSet). 마이그레이션에서 읽고 지우기만 한다. */
function legacyOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainService: SERVICE,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: AUTH_PROMPT,
  };
}

/** 첫 실행(재설치 포함)이면 남은 키체인 항목과 앱 데이터를 지운다. 설치 표지가 있으면 아무것도 하지 않는다. */
export async function ensureFreshInstall(): Promise<{ hasDevice: boolean; onboarded: boolean }> {
  const m = installMarker();
  if (m) return { hasDevice: !!m.deviceId, onboarded: !!m.onboardedAt || !!m.deviceId };
  await deleteAll();
  wipeAppData();
  await writeInstallMarker({ installedAt: Date.now() });
  return { hasDevice: false, onboarded: false };
}

/** 온보딩을 넘겼다고 표지에 적는다(실패해도 앱은 이어진다: 다음에 한 번 더 보일 뿐). */
export async function markOnboarded(): Promise<void> {
  const m = installMarker();
  await writeInstallMarker({ ...(m ?? { installedAt: Date.now() }), onboardedAt: Date.now() }).catch(() => {});
}

async function deleteAll(): Promise<void> {
  await SecureStore.deleteItemAsync(ITEM, { keychainService: SERVICE }).catch(() => {});
  await SaxNative?.vaultDelete?.(SERVICE, ITEM).catch(() => {});
}

function classify(e: unknown): KeyringError {
  if (e instanceof KeyringError) return e;
  const raw = String((e as { message?: string })?.message ?? e);
  const msg = raw.toLowerCase();
  if (msg.includes('cancel')) return new KeyringError('cancelled', raw);
  if (msg.includes('passcode') || msg.includes('-25293')) return new KeyringError('passcode_required', raw);
  if (msg.includes('biometr') || msg.includes('authentication')) return new KeyringError('biometry_required', raw);
  return new KeyringError('unavailable', raw);
}

function expand(s: Stored): DeviceKeys {
  const sm = fromB64(s.sm);
  const vm = fromB64(s.vm);
  const km = fromB64(s.km);
  const fileKey = fromB64(s.fileKey);
  if (sm.length !== 32 || vm.length !== 32 || km.length !== 32 || fileKey.length !== 32) throw new KeyringError('corrupt');
  return { deviceId: s.deviceId, sm, vm, km, fileKey, smPub: x25519Public(sm), vmPub: ed25519Public(vm), kmPub: x25519Public(km) };
}

/** 첫 실행: 키를 만들어 저장한다. 저장 실패는 그대로 던진다(대체 저장소 없음). */
export async function createDevice(): Promise<DeviceKeys> {
  const s = x25519Keygen();
  const v = ed25519Keygen();
  const k = x25519Keygen();
  const stored: Stored = { v: 1, deviceId: uuid4(), sm: b64(s.secretKey), vm: b64(v.secretKey), km: b64(k.secretKey), fileKey: b64(newFileKey()) };
  try {
    if (DEV_LOCAL) await SecureStore.setItemAsync(ITEM, JSON.stringify(stored), devOptions());
    else await vault().vaultSet(SERVICE, ITEM, JSON.stringify(stored));
  } catch (e) {
    throw classify(e);
  } finally {
    wipe(s.secretKey);
    wipe(v.secretKey);
    wipe(k.secretKey);
  }
  await writeInstallMarker({ ...installMarker(), installedAt: installMarker()?.installedAt ?? Date.now(), deviceId: stored.deviceId });
  return expand(stored);
}

/** 잠금 해제: 생체 또는 폰 암호로 항목을 읽는다(옛 항목이면 이때 한 번 옮긴다). 취소하면 KeyringError('cancelled'). */
export async function unlock(opts: { passcode?: boolean } = {}): Promise<DeviceKeys> {
  let raw: string | null;
  try {
    if (DEV_LOCAL) raw = await SecureStore.getItemAsync(ITEM, devOptions());
    else {
      const v = vault();
      raw = (
        await readWithMigration({
          readNew: () => v.vaultGet(SERVICE, ITEM, AUTH_PROMPT, !!opts.passcode),
          readLegacy: () => SecureStore.getItemAsync(ITEM, legacyOptions()),
          writeNew: (x) => v.vaultSet(SERVICE, ITEM, x),
          deleteLegacy: () => SecureStore.deleteItemAsync(ITEM, { keychainService: SERVICE }),
        })
      ).raw;
    }
  } catch (e) {
    throw classify(e);
  }
  if (!raw) throw new KeyringError('corrupt');
  let s: Stored;
  try {
    s = JSON.parse(raw) as Stored;
  } catch {
    throw new KeyringError('corrupt');
  }
  if (s.v !== 1) throw new KeyringError('corrupt');
  return expand(s);
}

export function forget(k: DeviceKeys | null): void {
  if (!k) return;
  wipe(k.sm);
  wipe(k.vm);
  wipe(k.km);
  wipe(k.fileKey);
}

/** 분실·해제 뒤 이 폰을 초기화한다(키·앱 데이터 삭제). */
export async function resetDevice(): Promise<void> {
  const seen = installMarker()?.onboardedAt;
  await deleteAll();
  wipeAppData();
  // 온보딩은 이미 본 사람이다: 초기화 뒤에는 바로 열쇠 만들기로 간다
  await writeInstallMarker({ installedAt: Date.now(), ...(seen ? { onboardedAt: seen } : {}) });
}

/** SP-1 진단용: 항목 속성만 보고한다(값 없음). auth: userPresence(생체 또는 폰 암호) · none(시뮬레이터 개발). */
export function keyringPolicy(): { accessible: string; auth: string; service: string } {
  if (DEV_LOCAL) return { accessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY', auth: 'none', service: SERVICE };
  const p = SaxNative?.vaultPolicy?.();
  return { accessible: p?.accessible ?? 'missing', auth: p?.auth ?? 'missing', service: SERVICE };
}

