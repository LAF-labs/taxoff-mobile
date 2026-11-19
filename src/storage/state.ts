// 앱 상태 파일(페어링 기록·기기 목록·IK 타임스탬프·현금매출 기록). fileKey로 XChaCha20-Poly1305 봉인해 sax/state.bin에 둔다.
import type { MoneySnapshot } from '../money';
import type { PhoneCopyBody } from '@sax/remote';
import type { PhoneCmd } from '../phoneCmd';
import type { PcWhy } from '../net/pcWhy';
import { File } from 'expo-file-system';
import { fromUtf8, utf8, xOpen, xSeal, type DeviceListJson, type SignedCert } from '@sax/remote';
import { currentEpoch, inflight, liveKey, sameEpoch } from '../inflight';
import { ROOT, writeProtected } from './files';

const AD = utf8('SAX-mobile-state-v1');
const FILE = new File(ROOT, 'state.bin');
/** 같은 봉투의 앞선 사본. 본 파일을 쓰다 끊겨도(통째로 덮어쓰는 중 앱 종료) 이 사본에서 되살린다. */
const SPARE = new File(ROOT, 'state.new');

export interface PairState {
  pairId: string;
  desktopStatic: string;
  desktopVd: string;
  desktopDeviceId: string;
  kvPub: string;
  aikPub: string;
  /** AIK 서명 기기 인증서. 계정 서비스 POST /v1/device-tokens에 그대로 보낸다(packages/remote requestDeviceToken). */
  cert: SignedCert;
  certNotAfter: number;
  mbxId: string;
  /** 우편함 능력 토큰(릴레이 X-Mbx-Read·X-Mbx-Write). PC가 PAIR_OK로 준다. */
  tokRead: string;
  tokWrite: string;
  mbxEpoch: number;
  relayHost: string;
  pairedAt: number;
  /** 사용자가 [내 계정 맞음]으로 확인한 계정 이메일(계정 서비스 서명 acct_claim에서 검증, 설계 #120). */
  accountEmail?: string;
  /** PC가 스스로 알린 이름(서명 없음, 참고 표시만). 없으면 PC가 보내지 않았다. */
  desktopName?: string | null;
}

export interface CashRecord {
  day: string;
  amount: number;
  msgId: string;
  /** queued: 릴레이 큐에 맡김(PC가 켜져야 받는다), sent: 라이브 세션에서 PC가 받았다고 답함 */
  state: 'pending' | 'queued' | 'sent';
}

/** 홈의 "최근 보낸 것" 한 줄(사진은 없다. 봉인된 상태 파일 안에만 있다). */
export interface RecentRecord {
  msgId: string;
  kind: 'receipt' | 'tax_invoice' | 'invoice';
  title: string;
  amount: number | null;
  at: number;
  state: 'pending' | 'queued' | 'sent';
}

export interface AppData {
  v: 1;
  pair: PairState | null;
  deviceList: DeviceListJson | null;
  seenListVersion: number;
  ikTs: number;
  lastSeenPc: number | null;
  cash: CashRecord[];
  /** 최근 보낸 종이 증빙(최대 30) */
  recent: RecentRecord[];
  /** 큐 봉투 seq(xfer.seq) 최고값. 봉인 전에 먼저 올려 둔다(재사용하면 PC가 재생으로 버린다). */
  queueSeq: number;
  /** 본 우편함 번들 seq 최고값(이보다 낮은 번들로는 봉인하지 않는다). */
  qbundleSeq: number;
  /** 돈 탭: PC에서 마지막으로 받은 요약(받은 시각 포함). 거래처 이름·금액·날짜만, 사업자번호·계좌는 지운 뒤 봉인 보관(src/money.ts storeable) */
  money?: MoneySnapshot | null;
  /** PC가 라이브 세션마다 넘기는 폰 사본(remote-envelope v1.8 phone.copy): 거래처·최근 발급·돈 요약. 이메일은 가린 힌트, 계좌는 은행 이름뿐이다. */
  pcCopy?: PhoneCopyBody | null;
  /** 폰 발급 명령(cmd.run). 보내기 전에 cmdId와 함께 저장해 다시 보낼 때 같은 cmdId를 쓴다(src/phoneCmd.ts). */
  cmds?: PhoneCmd[];
  /** PC 연결이 안 된 최근 원인(net/pcWhy.ts, '단계:원인'과 시각만. 최대 20개) */
  pcLog?: PcWhy[];
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
    // 본 파일이 없거나 깨졌다: 사본이 열리면 그것으로 이어 가고, 사본도 안 되면 처음 오류를 던진다(앱이 빈 상태로 시작한다)
    if (!SPARE.exists) throw e;
    return openFile(SPARE, fileKey);
  }
}

let writing: Promise<void> = Promise.resolve();
/**
 * 순서대로 쓴다(겹친 저장이 섞이지 않게). 한 번 실패해도 사슬은 끊기지 않는다: 호출자는 그 실패를 받고,
 * 다음 저장은 앞 결과와 관계없이 새 상태 전체를 쓴다(상태 파일은 매번 통째로 쓰므로 마지막 성공이 최신이다).
 */
export function saveData(fileKey: Uint8Array, d: AppData): Promise<void> {
  const e = currentEpoch();
  const box = xSeal(liveKey(fileKey), utf8(JSON.stringify(d)), AD);
  const mine = inflight(() =>
    writing
      .catch(() => undefined)
      .then(async () => {
        sameEpoch(e);
        // 사본을 먼저 온전히 쓰고 본 파일을 쓴다: 둘 중 하나는 늘 온전하다. 사본 쓰기가 실패하면 본 파일은 건드리지 않는다.
        await writeProtected(SPARE, box);
        sameEpoch(e);
        return writeProtected(FILE, box);
      }),
  );
  writing = mine.catch(() => undefined);
  return mine;
}
