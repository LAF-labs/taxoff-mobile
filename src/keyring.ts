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
  constructor(code: KeyringErrorCode, cause?: string) {
    super(cause ? `keyring: ${code} (${cause.slice(0, 160)})` : `keyring: ${code}`);
    this.code = code;
  }
}

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

export const APP_USER_AUTH = { ios: 'userPresence', android: 'BIOMETRIC_STRONG|DEVICE_CREDENTIAL' } as const;

function vault() {
  const v = SaxNative;
  if (!v?.vaultGet || !v.vaultSet || !v.vaultDelete) throw new KeyringError('unavailable', 'vault_missing');
  return v as Required<Pick<NonNullable<typeof SaxNative>, 'vaultGet' | 'vaultSet' | 'vaultDelete'>>;
}

function devOptions(): SecureStore.SecureStoreOptions {
  return { keychainService: SERVICE, keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false };
}

function legacyOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainService: SERVICE,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: AUTH_PROMPT,
  };
}

export async function ensureFreshInstall(): Promise<{ hasDevice: boolean; onboarded: boolean }> {
  const m = installMarker();
  if (m) return { hasDevice: !!m.deviceId, onboarded: !!m.onboardedAt || !!m.deviceId };
  await deleteAll();
  wipeAppData();
  await writeInstallMarker({ installedAt: Date.now() });
  return { hasDevice: false, onboarded: false };
}

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

export async function resetDevice(): Promise<void> {
  const seen = installMarker()?.onboardedAt;
  await deleteAll();
  wipeAppData();
  await writeInstallMarker({ installedAt: Date.now(), ...(seen ? { onboardedAt: seen } : {}) });
}

export function keyringPolicy(): { accessible: string; auth: string; service: string } {
  if (DEV_LOCAL) return { accessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY', auth: 'none', service: SERVICE };
  const p = SaxNative?.vaultPolicy?.();
  return { accessible: p?.accessible ?? 'missing', auth: p?.auth ?? 'missing', service: SERVICE };
}

