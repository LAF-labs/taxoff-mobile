// 알림 자리(App에 하나): PC가 알려 준 발급 진행이 바뀌면
//   - 앱이 앞에 있으면 화면 위 배너 한 장(tint 면 + 은은한 경계, 6초 뒤 걷힘, 누르면 진행 화면). 진행 화면을 보고 있으면 띄우지 않는다.
//   - 앱이 뒤에 있으면(잠기기 전) OS 알림 한 번. 글에는 거래처·금액이 없다.
// 돈: 마지막으로 받은 PC 값으로 다음 오전 9시 알림 하나를 걸어 둔다(값이 바뀌면 다시 건다).
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dueSoon } from '../money';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import type { AppData } from '../storage/state';
import { radius, space, usePalette } from '../theme';
import { T, tap } from '../ui/kit';
import { DEFAULT_PREFS, moneyReminder, nextMorning, runEvents, type MoneyCounts, type RunEvent } from './events';
import { configureNotifications, notifyNow, onOpened, scheduleMoney } from './local';
import type { Job } from '../queue';

const SHOW_MS = 6000;

function moneyCounts(d: AppData): MoneyCounts | null {
  if (d.money) {
    const s = d.money.summary;
    return { recvOverdue: s.overdueCount, recvSoon: dueSoon(d.money.receivables).count, payOverdue: s.payable.overdueCount, paySoon: s.payable.dueSoonCount };
  }
  const m = d.pcCopy?.money;
  if (m) return { recvOverdue: m.receivable.overdueCount, recvSoon: m.receivable.dueSoonCount, payOverdue: m.payable.overdueCount, paySoon: m.payable.dueSoonCount };
  return null;
}

export function NotifyHost({ onOpen, onMoney, onRunScreen, preview }: {
  /** 배너·알림을 눌렀을 때: 그 일의 진행 화면으로 */
  onOpen: (jobId: string) => void;
  onMoney: () => void;
  /** 진행 화면을 보고 있으면 그 일(q.focus)은 배너를 띄우지 않는다 */
  onRunScreen?: boolean;
  /** 갤러리: 처음부터 보일 배너 */
  preview?: RunEvent;
}) {
  const s = useSession();
  const q = useQueue();
  const prefs = s.data.notify ?? DEFAULT_PREFS;
  const [banner, setBanner] = useState<RunEvent | null>(preview ?? null);
  const prev = useRef<Job[]>(q.jobs);
  const watching = onRunScreen ? q.focus?.id ?? null : null;
  const opened = useRef({ onOpen, onMoney, setFocus: q.setFocus });
  opened.current = { onOpen, onMoney, setFocus: q.setFocus };

  useEffect(() => {
    configureNotifications();
    return onOpened((data) => {
      if (data.open === 'money') opened.current.onMoney();
      else if (data.open === 'run' && typeof data.jobId === 'string') {
        opened.current.setFocus(data.jobId);
        opened.current.onOpen(data.jobId);
      }
    });
  }, []);

  // 발급 진행
  useEffect(() => {
    const evs = runEvents(prev.current, q.jobs);
    prev.current = q.jobs;
    const ev = evs[evs.length - 1];
    if (!prefs.run || !ev) return;
    if (AppState.currentState === 'active') {
      if (ev.jobId !== watching) setBanner(ev);
    } else {
      for (const e of evs) void notifyNow(e.os, { open: 'run', jobId: e.jobId });
    }
  }, [q.jobs, prefs.run, watching]);

  // 배너 걷기
  useEffect(() => {
    if (!banner || preview) return;
    const t = setTimeout(() => setBanner(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [banner, preview]);

  // 돈 아침 알림
  const counts = moneyCounts(s.data);
  const key = counts ? `${counts.recvOverdue}.${counts.recvSoon}.${counts.payOverdue}.${counts.paySoon}` : '';
  useEffect(() => {
    const c = prefs.money && counts ? moneyReminder(counts) : null;
    void scheduleMoney(c, nextMorning(Date.now()));
    // counts는 key로 본다
  }, [key, prefs.money]);

  if (!banner) return null;
  return (
    <Banner
      ev={banner}
      onPress={() => {
        tap();
        setBanner(null);
        q.setFocus(banner.jobId);
        onOpen(banner.jobId);
      }}
      onClose={() => setBanner(null)}
    />
  );
}

export function Banner({ ev, onPress, onClose }: { ev: RunEvent; onPress: () => void; onClose: () => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const attention = ev.kind === 'myTurn' || ev.kind === 'verify';
  return (
    <View pointerEvents="box-none" style={[st.wrap, { top: inset.top + space.s2 }]}>
      <Pressable
        testID="notify-banner"
        accessibilityRole="alert"
        accessibilityLabel={`${ev.title}. ${ev.line}`}
        accessibilityHint="누르면 진행 화면을 열어요"
        onPress={onPress}
        style={({ pressed }) => [st.card, { backgroundColor: pressed ? p.sunken : p.tint, borderColor: attention ? p.attention : p.lineStrong }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <T v="subStrong" c={attention ? 'attention' : 'ink'}>
            {ev.title}
          </T>
          <T v="meta" c="ink2" lines={2}>
            {ev.line}
          </T>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="알림 닫기" testID="notify-banner-close" style={st.close}>
          <T v="meta" c="ink3">
            닫기
          </T>
        </Pressable>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: space.s4, right: space.s4 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.s3, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: space.s3, paddingLeft: space.s4, paddingRight: space.s3 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
