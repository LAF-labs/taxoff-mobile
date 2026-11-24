import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { WAKE_RANK, apnsToken, pushPlatform, tapKindOf, wakeKindOf, type PushPlatform, type WakeKind } from './wake';

const ios = Platform.OS === 'ios';

export const PLATFORM: PushPlatform = pushPlatform(__DEV__, process.env.EXPO_PUBLIC_TEX_APNS_ENV);

export async function deviceToken(): Promise<string | null> {
  if (!ios) return null;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return apnsToken(t.data);
  } catch {
    return null;
  }
}

export function onTokenChange(f: (token: string) => void): () => void {
  if (!ios) return () => {};
  const sub = Notifications.addPushTokenListener((t) => {
    const tok = apnsToken(t.data);
    if (tok) f(tok);
  });
  return () => sub.remove();
}

export function onWakeReceived(f: (k: WakeKind) => void): () => void {
  if (!ios) return () => {};
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const k = wakeKindOf(n);
    if (k) f(k);
  });
  return () => sub.remove();
}

export async function clearWakeNotifications(): Promise<void> {
  if (!ios) return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown.filter((n) => wakeKindOf(n)).map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch {
    // 덤이다
  }
}

let pending: { kind: WakeKind; at: number } | null = null;
const seen = new Set<string>();
const listeners = new Set<() => void>();
let installed = false;
const TAP_TTL_MS = 10 * 60_000;

function take(r: Notifications.NotificationResponse | null | undefined): void {
  if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const id = r.notification.request.identifier;
  if (seen.has(id)) return;
  const k = tapKindOf(r.notification);
  if (!k) return;
  seen.add(id);
  if (!pending || WAKE_RANK[k] >= WAKE_RANK[pending.kind]) pending = { kind: k, at: Date.now() };
  for (const l of listeners) l();
}

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

export function takeWake(now = Date.now()): WakeKind | null {
  const p = pending;
  pending = null;
  return p && now - p.at <= TAP_TTL_MS ? p.kind : null;
}

export function onWakeTap(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
