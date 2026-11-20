import { DEV_LOCAL, DEV_RELAY_HOST, DEV_STACK, PUBLIC_ORIGIN } from '../config';

class AccountUnavailable extends Error {
  constructor() {
    super('account: unavailable');
  }
}

export function accountOrigin(): string {
  if (DEV_STACK) return `http://${DEV_RELAY_HOST}`;
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  throw new AccountUnavailable();
}

export async function devFetchQr(): Promise<string> {
  if (!DEV_LOCAL) throw new Error('dev only');
  const r = await fetch(`http://${DEV_RELAY_HOST}/dev/qr`);
  if (!r.ok) throw new Error('no qr');
  return (await r.text()).trim();
}
