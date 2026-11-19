// OS 알림(기기 안에서만 만드는 로컬 알림). 서버 푸시(APNs·FCM)는 아직 쓰지 않는다: 푸시 디스패처(tex poc/services/push)가
// 배포되기 전이고, Phase 1에서는 실제 푸시를 보내지 않는다. 그래서 여기서 만드는 알림은 둘뿐이다.
//   1) 앱이 잠깐 뒤로 가 있을 때(잠기기 전 30초) PC가 알려 준 발급 진행
//   2) 받을 돈·낼 돈 기한 아침 알림(마지막으로 받은 PC 값 기준, 다음 오전 9시 한 번)
// 웹(갤러리)에는 OS 알림이 없다.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const MONEY_ID = 'tex-money-morning';
const ANDROID_CHANNEL = 'tex-default';

export type Permission = 'granted' | 'denied' | 'undetermined';

let configured = false;
/** 앱이 앞에 있을 때는 OS 배너를 띄우지 않는다(앱 안 배너가 대신한다). 알림 센터 목록에는 남긴다. */
export function configureNotifications(): void {
  if (!native || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
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

/** 처음 한 번 OS 허용 창. 이미 거절했으면 창이 뜨지 않고 denied가 온다(설정 앱으로 안내). */
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

/** 지금 바로 한 번(앱이 뒤에 있을 때). 허용 안 됐으면 조용히 넘어간다. */
export async function notifyNow(c: { title: string; body: string }, data: Record<string, string> = {}): Promise<void> {
  if (!native) return;
  try {
    if ((await permission()) !== 'granted') return;
    await Notifications.scheduleNotificationAsync({ content: { title: c.title, body: c.body, data }, trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null });
  } catch {
    // 알림은 덤이다. 실패해도 앱 동작은 그대로.
  }
}

/** 돈 아침 알림을 바꿔 건다(앞의 것은 지운다). c가 null이면 지우기만. */
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

/** 알림을 눌러 앱이 열렸을 때. data.open: 'run'(+jobId) | 'money' */
export function onOpened(f: (data: Record<string, unknown>) => void): () => void {
  if (!native) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => f((r.notification.request.content.data ?? {}) as Record<string, unknown>));
  return () => sub.remove();
}
