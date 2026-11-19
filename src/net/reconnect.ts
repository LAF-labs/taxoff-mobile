// PC 다시 붙기 시점(순수, 시험 대상). 조사 문서 5절 4번, Mattermost 모바일 websocket_manager와 같은 생각:
// - 망이 바뀌면(와이파이에서 LTE, 끊겼다 이어짐) 60초를 기다리지 않고 바로 다시 붙는다. 붙어 있던 연결은 반쯤 열렸을 수 있어 버린다.
// - 실패가 이어지면 3초에서 두 배씩 늘려 최대 60초(RECONNECT_MS)까지 기다린다. 폰 여러 대가 같은 순간 몰리지 않게 흔들림(지터)을 넣는다.
// - 성공하면 처음부터 다시 센다.
import type { PcStatus } from './pc';

/** 첫 재시도 간격 */
export const RETRY_FIRST_MS = 3_000;
/** 지터 비율: 기다림의 ±20% */
export const JITTER = 0.2;
/** 망이 바뀐 뒤 잠깐 기다렸다 붙는다(바뀌는 중 여러 번 오는 알림을 한 번으로, 새 망 주소가 잡히도록) */
export const NET_SETTLE_MS = 800;

/** 망 상태 중 다시 붙기를 가르는 부분(NetInfoState에서 뽑는다) */
export interface NetShape {
  /** 연결 종류(wifi, cellular, none, unknown 등) */
  type: string;
  /** 인터넷이 닿는가. 모르면 null */
  reachable: boolean | null;
}

/** 다시 붙어야 하는 망 변화인가. 처음 받은 상태(prev 없음)는 변화가 아니다(앱을 열 때 이미 붙는다). */
export function netChanged(prev: NetShape | null, next: NetShape): boolean {
  if (!prev) return false;
  // 끊긴 쪽으로 바뀐 것은 붙을 곳이 없다. 이어지면 그때 붙는다.
  if (next.reachable === false || next.type === 'none') return false;
  if (prev.type !== next.type) return true;
  // 같은 종류에서 끊겼다 이어짐
  return prev.reachable === false;
}

/** 이번 결과가 "다시 시도할 실패"인가. 붙었거나 큐로 맡겼으면 성공이고, 짝이 없으면 시도할 것이 없다. */
export function failed(status: PcStatus): boolean {
  return status === 'offline' || status === 'stale' || status === 'connecting';
}

/** n번째 연속 실패 뒤 기다릴 시간(n >= 1). rand는 [0, 1). */
export function retryDelay(n: number, maxMs: number, rand: () => number = Math.random): number {
  const base = Math.min(maxMs, RETRY_FIRST_MS * 2 ** Math.max(0, Math.min(n - 1, 16)));
  const jitter = base * JITTER * (rand() * 2 - 1);
  return Math.max(1_000, Math.round(Math.min(maxMs, base + jitter)));
}
