import type { Thumb } from '../capture/thumb';
import type { MoneySnapshot } from '../money';
import type { PhoneCopyBody } from '@sax/remote';
import type { PhoneCmd } from '../phoneCmd';
import type { PcWhy } from '../net/pcWhy';
import type { PxState } from '../net/pxLive';
import type { NotifyPrefs } from '../notify/events';
import type { InboxItem } from '../notify/inbox';
import type { TextSize } from '../theme';
import { File } from 'expo-file-system';
import { fromUtf8, utf8, xOpen, xSeal, type DeviceListJson, type SignedCert } from '@sax/remote';
import { currentEpoch, inflight, liveKey, sameEpoch } from '../inflight';
import { ROOT, writeProtected } from './files';

const AD = utf8('SAX-mobile-state-v1');
const FILE = new File(ROOT, 'state.bin');
const SPARE = new File(ROOT, 'state.new');

export interface PairState {
  pairId: string;
  desktopStatic: string;
  desktopVd: string;
  desktopDeviceId: string;
  kvPub: string;
  aikPub: string;
  cert: SignedCert;
  certNotAfter: number;
  mbxId: string;
  tokRead: string;
  tokWrite: string;
  mbxEpoch: number;
  relayHost: string;
  pairedAt: number;
  accountEmail?: string;
  desktopName?: string | null;
}

export interface CashRecord {
  day: string;
  amount: number;
  msgId: string;
  state: 'pending' | 'queued' | 'sent';
}

export interface RecentRecord {
  msgId: string;
  kind: 'receipt' | 'tax_invoice' | 'invoice';
  title: string;
  amount: number | null;
  at: number;
  state: 'pending' | 'queued' | 'sent';
  thumb?: Thumb;
}

export interface SimpleId {
  provider: string;
  name: string;
  birth: string;
  phone: string;
  carrier?: string;
}

/** 계정 공유 열쇠(PC가 share.key로 준다, ADR-064): 세대마다 K_share(e)와 PC 서명 확인용 Ws 공개키. 연결한 PC가 바뀌면 버린다. */
export interface ShareState {
  pairId: string;
  signPub: string;
  keys: string[];
}

export interface AppData {
  v: 1;
  pair: PairState | null;
  deviceList: DeviceListJson | null;
  seenListVersion: number;
  ikTs: number;
  lastSeenPc: number | null;
  cash: CashRecord[];
  recent: RecentRecord[];
  queueSeq: number;
  qbundleSeq: number;
  money?: MoneySnapshot | null;
  pcCopy?: PhoneCopyBody | null;
  cmds?: PhoneCmd[];
  pcLog?: PcWhy[];
  px?: PxState;
  notify?: NotifyPrefs;
  pushHash?: string | null;
  pushAsked?: boolean;
  simpleId?: SimpleId | null;
  textSize?: TextSize;
  inbox?: InboxItem[];
  inboxSeenAt?: number;
  share?: ShareState | null;
}

export const emptyData = (): AppData => ({ v: 1, pair: null, deviceList: null, seenListVersion: 0, ikTs: 0, lastSeenPc: null, cash: [], recent: [], queueSeq: 0, qbundleSeq: 0 });

async function openFile(f: File, fileKey: Uint8Array): Promise<AppData> {
  const box = await f.bytes();
  const d = JSON.parse(fromUtf8(xOpen(fileKey, box, AD))) as AppData;
  return d.v === 1 ? { ...emptyData(), ...d } : emptyData();
}

export async function loadData(fileKey: Uint8Array): Promise<AppData> {
  if (!FILE.exists && !SPARE.exists) return emptyData();
  try {
    if (!FILE.exists) throw new Error('state: main missing');
    return await openFile(FILE, fileKey);
  } catch (e) {
    if (!SPARE.exists) throw e;
    return openFile(SPARE, fileKey);
  }
}

let writing: Promise<void> = Promise.resolve();
export function saveData(fileKey: Uint8Array, d: AppData): Promise<void> {
  const e = currentEpoch();
  const box = xSeal(liveKey(fileKey), utf8(JSON.stringify(d)), AD);
  const mine = inflight(() =>
    writing
      .catch(() => undefined)
      .then(async () => {
        sameEpoch(e);
        await writeProtected(SPARE, box);
        sameEpoch(e);
        return writeProtected(FILE, box);
      }),
  );
  writing = mine.catch(() => undefined);
  return mine;
}
