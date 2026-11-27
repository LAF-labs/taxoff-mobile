import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dueSoon } from '../money';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import type { AppData } from '../storage/state';
import { radius, space, usePalette } from '../theme';
import { T, tap, won } from '../ui/kit';
import { DEFAULT_PREFS, moneyReminder, nextMorning, runEvents, type MoneyCounts, type RunEvent } from './events';
import { configureNotifications, notifyNow, onOpened, scheduleMoney } from './local';
import { addInbox, fromRun, moneyItem, newApprovals, type InboxItem } from './inbox';
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
  onOpen: (jobId: string) => void;
  onMoney: () => void;
  onRunScreen?: boolean;
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

  const keep = (items: InboxItem[]) => {
    if (items.length) void s.update((d) => ({ ...d, inbox: addInbox(d.inbox ?? [], items, Date.now()) }));
  };

  useEffect(() => {
    const evs = runEvents(prev.current, q.jobs);
    const now = Date.now();
    keep([...newApprovals(prev.current, q.jobs, now, won), ...evs.map((e) => fromRun(e, now))]);
    prev.current = q.jobs;
    const ev = evs[evs.length - 1];
    if (!prefs.run || !ev) return;
    if (AppState.currentState === 'active') {
      if (ev.jobId !== watching) setBanner(ev);
    } else {
      for (const e of evs) void notifyNow(e.os, { open: 'run', jobId: e.jobId });
    }
  }, [q.jobs, prefs.run, watching]);

  useEffect(() => {
    if (!banner || preview) return;
    const t = setTimeout(() => setBanner(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [banner, preview]);

  const counts = moneyCounts(s.data);
  const key = counts ? `${counts.recvOverdue}.${counts.recvSoon}.${counts.payOverdue}.${counts.paySoon}` : '';
  useEffect(() => {
    const r = counts ? moneyReminder(counts) : null;
    const now = Date.now();
    const today = new Date(now).setHours(9, 0, 0, 0);
    if (r && now >= today) keep([moneyItem(r, today)]);
    void scheduleMoney(prefs.money ? r : null, nextMorning(now));
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
        style={({ pressed }) => [st.card, { backgroundColor: pressed ? p.sunken : p.overlay, shadowColor: p.ink }]}
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
  card: { flexDirection: 'row', alignItems: 'center', gap: space.s3, borderRadius: radius.lg, paddingVertical: space.s3, paddingLeft: space.s4, paddingRight: space.s3, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
