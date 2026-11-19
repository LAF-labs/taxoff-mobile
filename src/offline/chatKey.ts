// 폰 대화 기록이 누구의 것인지 정하는 열쇠(Expo 모듈 없이 시험할 수 있게 따로 둔다).
// 기록은 "계정 + PC"에 묶는다. QR로 다시 연결하면 pairId는 새로 나오지만 같은 계정의 같은 PC면 옛 대화가 이어서 보인다.
// 다른 계정이거나 다른 PC와 연결하면 옛 대화를 보이지도, 컨텍스트로 쓰지도 않는다.
import type { PairState } from '../storage/state';

/** 봉인 파일 안에 적는 값. pair는 예전 파일(페어링 하나에 묶던 때)과 맞추기 위한 값이다. */
export interface ChatWrap {
  pairId?: unknown;
  owner?: unknown;
  data?: unknown;
}

/** 계정 이메일과 PC 기기 id. 이메일은 소문자로 맞춘다(없으면 빈 값: PC만 같으면 같은 대화로 본다). */
export function chatOwnerOf(pair: Pick<PairState, 'accountEmail' | 'desktopDeviceId'>): string {
  return `${(pair.accountEmail ?? '').trim().toLowerCase()}|${pair.desktopDeviceId}`;
}

/**
 * 봉인 파일에서 읽은 값이 이 연결의 대화인지 보고 기록 문자열을 돌려준다. 아니면 null.
 * - owner가 있으면 owner가 같을 때만 쓴다.
 * - owner가 없는 예전 파일은 지금 연결의 pairId와 같을 때만 쓴다(다시 쓸 때 owner가 붙는다).
 */
export function chatDataFor(w: ChatWrap, pair: Pick<PairState, 'pairId' | 'accountEmail' | 'desktopDeviceId'>): string | null {
  if (typeof w.data !== 'string') return null;
  if (typeof w.owner === 'string') return w.owner === chatOwnerOf(pair) ? w.data : null;
  return w.pairId === pair.pairId ? w.data : null;
}

/** 봉인 파일에 적을 값 */
export function chatWrapOf(pair: Pick<PairState, 'pairId' | 'accountEmail' | 'desktopDeviceId'>, data: string): ChatWrap {
  return { pairId: pair.pairId, owner: chatOwnerOf(pair), data };
}
