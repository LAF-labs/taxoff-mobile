// 폰 대화의 기기 쪽 포트: 봉인 저장(sax/chat.bin), 기기 토큰 + DPoP, 난수, ULID.
// 대화 기록은 상태 파일과 같은 방식으로 fileKey로 XChaCha20-Poly1305 봉인하고(AD가 다르다), 잠그면 키와 함께 버린다.
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
/** 대화에 붙은 카드·표(코어 기록에는 글만 있다). 앱을 껐다 켜도 남도록 따로 봉인해 둔다. */
const SHOWN = new File(ROOT, 'chat-shown.bin');

/** 기록은 계정과 PC에 묶는다: QR로 다시 연결해도 같은 계정의 같은 PC면 이어지고, 다른 PC나 다른 계정이면 옛 대화를 쓰지 않는다(chatKey.ts). */
function sealedStore(fileKey: Uint8Array, pair: PairState, file: File) {
  let writing: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<string | null> {
      if (!file.exists) return null;
      try {
        return chatDataFor(JSON.parse(fromUtf8(xOpen(fileKey, await file.bytes(), AD))) as ChatWrap, pair);
      } catch {
        // 깨진 기록은 버리고 새로 시작한다(대화 기록은 PC에도 있다)
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

/**
 * 페어링된 폰의 대화. 페어링이 같으면 같은 것을 준다. 게이트웨이 origin을 정할 수 없으면(릴리스 origin 미설정,
 * 개발 실기기의 평문 mDNS) null이다: 그때는 폰 대화 없이 PC를 기다린다.
 */
/** 지금 PC가 켜져 있는지(세션이 라이브 연결로 정한다). 대화를 다시 만들지 않고 부를 때마다 읽는다. */
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

/** 잠글 때·연결 해제 때 부른다(메모리의 대화 상태를 버린다. 봉인 파일은 남는다). */
export function closeOfflineChat(): void {
  open = null;
}
