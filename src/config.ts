import * as Device from 'expo-device';
import { allowDevLanHosts } from '@sax/remote';
import { RELAY_ALLOWLIST, resolveDevConfig } from './devhost';

export { RELAY_ALLOWLIST };
export const APP_VERSION = '0.1.0';

const DEV = resolveDevConfig({ isDev: __DEV__, isDevice: Device.isDevice, envHost: process.env.EXPO_PUBLIC_TEX_DEV_HOST });
allowDevLanHosts(DEV.allowLan);

export const DEV_LOCAL: boolean = DEV.devLocal;
export const DEV_STACK: boolean = DEV.devStack;
export const DEV_RELAY_HOST: string = DEV.devRelayHost;

export const PUBLIC_ORIGIN: string = 'https://tax.laf-co.com';

export const accountKeys = (): readonly string[] => DEV.accountKeys;

export const relayAllowlist = (): readonly string[] => DEV.relayAllowlist;

export const LOCK_AFTER_MS = 30_000;
export const LOCK_DRAIN_MS = 15_000;
export const RECONNECT_MS = 60_000;
export const PHOTO_MAX_EDGE = 2400;
export const PHOTO_QUALITY = 0.85;

export const BRAND = '택스오프';
