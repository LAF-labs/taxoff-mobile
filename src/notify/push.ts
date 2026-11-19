// 푸시 깨우기의 OS·서버 쪽(ADR-053 결정 4). 판단은 wake.ts(순수 함수)에 있다.
//   - 토큰: OS가 준 APNs 기기 토큰 그대로(getDevicePushTokenAsync). Expo 푸시 서비스는 거치지 않는다.
//   - 서버: PUT·DELETE /v1/push-token(pushApi.ts).
//   - 누름: 잠금 화면 위에서 눌러도 잃지 않게 앱이 뜰 때 바로 듣고(installWakeTap) 잠금이 풀린 뒤 꺼내 쓴다(takeWake).
// iPhone 먼저다(Android 승인·FCM은 다음 단계). 웹(갤러리)에는 없다.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apnsToken, pushPlatform, tapKindOf, wakeKindOf, type PushPlatform, type WakeKind } from './wake';

const ios = Platform.OS === 'ios';

export const PLATFORM: PushPlatform = pushPlatform(__DEV__, process.env.EXPO_PUBLIC_TEX_APNS_ENV);

/** OS 기기 토큰. 허용 전이거나 시뮬레이터처럼 못 받으면 null. */
export async function deviceToken(): Promise<string | null> {
  if (!ios) return null;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return apnsToken(t.data);
  } catch {
    return null;
  }
}

/** OS가 토큰을 바꾸면(복원, 재설치 등) 알려 준다. */
export function onTokenChange(f: (token: string) => void): () => void {
  if (!ios) return () => {};
  const sub = Notifications.addPushTokenListener((t) => {
    const tok = apnsToken(t.data);
    if (tok) f(tok);
  });
  return () => sub.remove();
}

/** 앱이 앞에 있을 때 온 깨우기(배너는 handler가 막는다, local.ts) */
export function onWakeReceived(f: (k: WakeKind) => void): () => void {
  if (!ios) return () => {};
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const k = wakeKindOf(n);
    if (k) f(k);
  });
  return () => sub.remove();
}

/** 알림 센터에 남은 우리 깨우기 알림을 지운다(세션이 붙어 이미 본 일이 된다). */
export async function clearWakeNotifications(): Promise<void> {
  if (!ios) return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown.filter((n) => wakeKindOf(n)).map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch {
    // 덤이다
  }
}

// --- 누른 깨우기(잠금 전에 받아 두고 잠금이 풀리면 꺼낸다) ---

let pending: { kind: WakeKind; at: number } | null = null;
const seen = new Set<string>();
const listeners = new Set<() => void>();
let installed = false;
/** 이보다 오래된 누름은 버린다(잠금 화면에서 한참 머문 뒤 엉뚱한 화면으로 가지 않게) */
const TAP_TTL_MS = 10 * 60_000;

function take(r: Notifications.NotificationResponse | null | undefined): void {
  if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const id = r.notification.request.identifier;
  if (seen.has(id)) return;
  const k = tapKindOf(r.notification);
  if (!k) return;
  seen.add(id);
  // approve가 update보다 급하다: 둘이 겹치면 approve를 남긴다
  if (!pending || k === 'approve' || pending.kind === 'update') pending = { kind: k, at: Date.now() };
  for (const l of listeners) l();
}

/** 앱이 뜰 때 한 번(App.tsx 바깥). 꺼진 앱을 알림으로 연 경우도 받는다. */
export function installWakeTap(): void {
  if (!ios || installed) return;
  installed = true;
  Notifications.addNotificationResponseReceivedListener(take);
  void Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      take(r);
      if (r && tapKindOf(r.notification)) void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    })
    .catch(() => {});
}

/** 잠금이 풀린 뒤: 누른 깨우기를 꺼낸다(한 번만). */
export function takeWake(now = Date.now()): WakeKind | null {
  const p = pending;
  pending = null;
  return p && now - p.at <= TAP_TTL_MS ? p.kind : null;
}

export function onWakeTap(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
