import { File } from 'expo-file-system';
import { fromUtf8, ulid, utf8, xOpen, xSeal } from '@sax/remote';
import { accountOrigin } from '../net/account';
import { deviceAuthFor } from '../net/devauth';
import { currentEpoch, inflight, liveKey, sameEpoch } from '../inflight';
import type { DeviceKeys } from '../keyring';
import type { PairState } from '../storage/state';
import { ROOT, writeProtected } from '../storage/files';
import { OfflineChat } from './chat';
import { chatDataFor, chatWrapOf, type ChatWrap } from './chatKey';
import type { PhoneCopy } from '@sax/chat-core';

const AD = utf8('SAX-mobile-chat-v1');
const FILE = new File(ROOT, 'chat.bin');
const SHOWN = new File(ROOT, 'chat-shown.bin');

function sealedStore(fileKey: Uint8Array, pair: PairState, file: File) {
  let writing: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<string | null> {
      if (!file.exists) return null;
      try {
        return chatDataFor(JSON.parse(fromUtf8(xOpen(fileKey, await file.bytes(), AD))) as ChatWrap, pair);
      } catch {
        return null;
      }
    },
    save(data: string): Promise<void> {
      const e = currentEpoch();
      const box = xSeal(liveKey(fileKey), utf8(JSON.stringify(chatWrapOf(pair, data))), AD);
      const mine = inflight(() =>
        writing
          .catch(() => undefined)
          .then(() => {
            sameEpoch(e);
            return writeProtected(file, box);
          }),
      );
      writing = mine.catch(() => undefined);
      return mine;
    },
  };
}

function randomHex(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

let open: { pairId: string; chat: OfflineChat } | null = null;

let pcOnline: () => boolean = () => false;
export function setPcOnline(f: () => boolean): void {
  pcOnline = f;
}

export function offlineChat(pair: PairState, keys: DeviceKeys, copy: () => PhoneCopy | null): OfflineChat | null {
  if (open?.pairId === pair.pairId) return open.chat;
  const auth = deviceAuthFor(pair.pairId, pair.cert, keys.vm);
  try {
    const chat = new OfflineChat({
      origin: accountOrigin(),
      fetch: async (url, init) => {
        const r = await fetch(url, init);
        return { status: r.status, text: () => r.text() };
      },
      authHeaders: (method, url) => auth(method, url),
      store: sealedStore(keys.fileKey, pair, FILE),
      shownStore: sealedStore(keys.fileKey, pair, SHOWN),
      copy,
      now: Date.now,
      newId: () => ulid(),
      randomHex,
      pcOnline: () => pcOnline(),
    });
    open = { pairId: pair.pairId, chat };
    return chat;
  } catch {
    return null;
  }
}

export function closeOfflineChat(): void {
  open = null;
}
