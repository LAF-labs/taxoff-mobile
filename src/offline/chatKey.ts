import type { PairState } from '../storage/state';

export interface ChatWrap {
  pairId?: unknown;
  owner?: unknown;
  data?: unknown;
}

export function chatOwnerOf(pair: Pick<PairState, 'accountEmail' | 'desktopDeviceId'>): string {
  return `${(pair.accountEmail ?? '').trim().toLowerCase()}|${pair.desktopDeviceId}`;
}

export function chatDataFor(w: ChatWrap, pair: Pick<PairState, 'pairId' | 'accountEmail' | 'desktopDeviceId'>): string | null {
  if (typeof w.data !== 'string') return null;
  if (typeof w.owner === 'string') return w.owner === chatOwnerOf(pair) ? w.data : null;
  return w.pairId === pair.pairId ? w.data : null;
}

export function chatWrapOf(pair: Pick<PairState, 'pairId' | 'accountEmail' | 'desktopDeviceId'>, data: string): ChatWrap {
  return { pairId: pair.pairId, owner: chatOwnerOf(pair), data };
}
