
export const RELAY_ALLOWLIST: readonly string[] = ['rooms.tax.laf-co.com'];
const SIM_DEV_HOST = 'localhost:8787';

export const RELEASE_ACCOUNT_KEYS: readonly string[] = ['m505XiZjib3UhZGHVJKoS7FZ3FdVOJ0aS/XFpN4zPYQ='];
export const DEV_ACCOUNT_KEY = '3uABVr6gwZIYy5ir9UMb2ohr2fxONenkzT9XtRRIBCY=';

interface DevConfig {
  devLocal: boolean;
  devStack: boolean;
  devRelayHost: string;
  allowLan: boolean;
  relayAllowlist: readonly string[];
  accountKeys: readonly string[];
}

export function resolveDevConfig(e: { isDev: boolean; isDevice: boolean; envHost: string | undefined }): DevConfig {
  const devLocal = e.isDev && !e.isDevice;
  const deviceHost = e.isDev && e.isDevice && typeof e.envHost === 'string' && /^[a-z0-9-]{1,63}\.local:\d{1,5}$/.test(e.envHost) ? e.envHost : null;
  const devStack = devLocal || deviceHost !== null;
  const devRelayHost = deviceHost ?? SIM_DEV_HOST;
  return {
    devLocal, devStack, devRelayHost, allowLan: deviceHost !== null,
    relayAllowlist: devStack ? [...RELAY_ALLOWLIST, devRelayHost] : RELAY_ALLOWLIST,
    accountKeys: devStack ? [DEV_ACCOUNT_KEY] : RELEASE_ACCOUNT_KEYS,
  };
}
