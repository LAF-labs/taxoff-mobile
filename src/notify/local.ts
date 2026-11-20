import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { wakeKindOf } from './wake';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const MONEY_ID = 'tex-money-morning';
const ANDROID_CHANNEL = 'tex-default';

export type Permission = 'granted' | 'denied' | 'undetermined';

let configured = false;
export function configureNotifications(): void {
  if (!native || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => ({ shouldShowBanner: false, shouldShowList: !wakeKindOf(n), shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, { name: '택스오프', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
  }
}

export async function permission(): Promise<Permission> {
  if (!native) return 'undetermined';
  try {
    const r = await Notifications.getPermissionsAsync();
    if (r.granted) return 'granted';
    return r.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function askPermission(): Promise<Permission> {
  if (!native) return 'undetermined';
  try {
    const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    if (r.granted) return 'granted';
    return r.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function notifyNow(c: { title: string; body: string }, data: Record<string, string> = {}, identifier?: string): Promise<void> {
  if (!native) return;
  try {
    if ((await permission()) !== 'granted') return;
    await Notifications.scheduleNotificationAsync({ ...(identifier ? { identifier } : {}), content: { title: c.title, body: c.body, data }, trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null });
  } catch {
    // 알림은 덤이다. 실패해도 앱 동작은 그대로.
  }
}

export async function scheduleMoney(c: { title: string; body: string } | null, at: number): Promise<void> {
  if (!native) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(MONEY_ID).catch(() => {});
    if (!c || (await permission()) !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      identifier: MONEY_ID,
      content: { title: c.title, body: c.body, data: { open: 'money' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}) },
    });
  } catch {
    // 위와 같다
  }
}

export async function cancelMoney(): Promise<void> {
  if (!native) return;
  await Notifications.cancelScheduledNotificationAsync(MONEY_ID).catch(() => {});
}

export function onOpened(f: (data: Record<string, unknown>) => void): () => void {
  if (!native) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => f((r.notification.request.content.data ?? {}) as Record<string, unknown>));
  return () => sub.remove();
}
