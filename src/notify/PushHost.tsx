import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountOrigin } from '../net/account';
import { deviceAuthFor, fetchJson } from '../net/devauth';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { radius, space, usePalette } from '../theme';
import { Button, T } from '../ui/kit';
import { wakeOn } from './events';
import { askPermission, notifyNow, permission, type Permission } from './local';
import { PLATFORM, clearWakeNotifications, deviceToken, onTokenChange, onWakeReceived, onWakeTap, takeWake } from './push';
import { pushClient } from './pushApi';
import { LOCAL_APPROVE, SHEET_WAIT_MS, askDue, latestEntrusted, newGates, pushPlan, tokenHash, type WakeKind } from './wake';

const ASK_DELAY_MS = 700;

export function PushHost({ onQueue, onRun, onCard, askPreview }: {
  onQueue: () => void;
  onRun: () => void;
  onCard: (jobId: string) => void;
  askPreview?: boolean;
}) {
  const s = useSession();
  const q = useQueue();
  const [perm, setPerm] = useState<Permission | null>(askPreview ? 'undetermined' : null);
  const [asking, setAsking] = useState(!!askPreview);
  const [tokTick, setTokTick] = useState(0);
  const token = useRef<string | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const [waitSheet, setWaitSheet] = useState<number | null>(null);
  const live = useRef({ s, q, onQueue, onRun, onCard });
  live.current = { s, q, onQueue, onRun, onCard };

  const pair = s.data.pair;
  const online = s.pc === 'online';
  const wake = wakeOn(s.data.notify);

  useEffect(() => {
    if (askPreview) return;
    const read = () => void permission().then(setPerm);
    read();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && read());
    return () => sub.remove();
  }, [askPreview]);

  useEffect(
    () =>
      onTokenChange((t) => {
        token.current = t;
        setTokTick((n) => n + 1);
      }),
    [],
  );

  const reconcile = useCallback(async () => {
    if (askPreview) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        const { s: cur } = live.current;
        const p = cur.data.pair;
        if (!p || cur.pc !== 'online' || perm === null) return;
        const want = perm === 'granted' && wakeOn(cur.data.notify);
        if (want && !token.current) token.current = await deviceToken();
        const hash = want && token.current ? tokenHash(PLATFORM, token.current) : null;
        const plan = pushPlan({ paired: true, perm, wakeOn: wakeOn(cur.data.notify), hash, last: cur.data.pushHash ?? null });
        if (plan === 'none') continue;
        const client = pushClient(fetchJson, accountOrigin(), deviceAuthFor(p.pairId, p.cert, cur.keys.vm));
        try {
          if (plan === 'put') {
            await client.put(PLATFORM, token.current!);
            await cur.update((d) => ({ ...d, pushHash: hash }));
          } else {
            await client.remove();
            await cur.update((d) => ({ ...d, pushHash: null }));
          }
        } catch {
          // 서버에 못 닿았다: 다음 연결 때 다시 한다
        }
      } while (again.current);
    } finally {
      busy.current = false;
    }
  }, [perm, askPreview]);

  useEffect(() => {
    if (online) void reconcile();
  }, [online, perm, wake, tokTick, s.data.pushHash, pair?.pairId, reconcile]);

  useEffect(() => {
    if (online && !askPreview) void clearWakeNotifications();
  }, [online, askPreview]);

  useEffect(() => onWakeReceived(() => void live.current.s.sync()), []);

  const handle = useCallback((k: WakeKind) => {
    const { s: cur, onQueue: toQueue } = live.current;
    if (k === 'update') {
      toQueue();
      void cur.sync();
      return;
    }
    void cur.sync().finally(() => setWaitSheet(Date.now()));
  }, []);
  useEffect(() => {
    if (askPreview) return;
    const drain = () => {
      const k = takeWake();
      if (k) handle(k);
    };
    drain();
    return onWakeTap(drain);
  }, [handle, askPreview]);

  const gated = q.jobs.find((j) => j.gate && j.state === 'approval' && j.gate.exp > Date.now()) ?? null;
  useEffect(() => {
    if (waitSheet === null) return;
    const { q: cq, onRun: toRun, onQueue: toQueue } = live.current;
    if (gated) {
      setWaitSheet(null);
      live.current.onCard(gated.id);
      return;
    }
    const t = setTimeout(() => {
      setWaitSheet(null);
      const j = latestEntrusted(live.current.q.jobs);
      if (j) {
        cq.setFocus(j.id);
        toRun();
      } else toQueue();
    }, Math.max(0, waitSheet + SHEET_WAIT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [waitSheet, gated]);

  useEffect(() => {
    if (askPreview) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const { q: cq } = live.current;
      const g = cq.jobs.find((j) => j.id.startsWith('cmd-') && j.gate && j.state === 'approval' && j.gate.exp > Date.now());
      if (g && !cq.sheetJob) live.current.onCard(g.id);
    });
    return () => sub.remove();
  }, [askPreview]);

  const toldBg = useRef(new Set<string>());
  const shownFg = useRef(new Set<string>());
  useEffect(() => {
    if (askPreview) return;
    const now = Date.now();
    if (AppState.currentState === 'active') {
      const fresh = newGates(q.jobs, shownFg.current, now);
      for (const j of fresh) shownFg.current.add(j.gate!.reqId);
      if (fresh[0] && !q.sheetJob) live.current.onCard(fresh[0].id);
      return;
    }
    const fresh = newGates(q.jobs, toldBg.current, now);
    if (!fresh.length) return;
    for (const j of fresh) toldBg.current.add(j.gate!.reqId);
    if (!wakeOn(live.current.s.data.notify)) return;
    void notifyNow({ title: '승인을 기다리는 발급이 있어요', body: '눌러서 승인하거나 거절해 주세요' }, { open: LOCAL_APPROVE, jobId: fresh[0]!.id }, 'sax-wake-approve');
  }, [q.jobs, q.sheetJob, askPreview]);

  const entrusted = (s.data.cmds ?? []).length;
  const due = !askPreview && askDue({ entrusted, asked: !!s.data.pushAsked, perm });
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(() => setAsking(true), ASK_DELAY_MS);
    return () => clearTimeout(t);
  }, [due]);
  useEffect(() => {
    if (askPreview || perm === null || perm === 'undetermined' || s.data.pushAsked || !entrusted) return;
    void s.update((d) => ({ ...d, pushAsked: true })).catch(() => undefined);
  }, [perm, entrusted, s.data.pushAsked, askPreview, s]);

  const answer = async (yes: boolean) => {
    setAsking(false);
    if (askPreview) return;
    await s.update((d) => ({ ...d, pushAsked: true })).catch(() => undefined);
    if (yes) setPerm(await askPermission());
  };

  if (!asking || q.sheetJob) return null;
  return <AskSheet onYes={() => void answer(true)} onNo={() => void answer(false)} />;
}

export function AskSheet({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill} testID="push-ask">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onNo} accessibilityLabel="닫기" accessibilityRole="button" />
      <View style={[st.sheet, { backgroundColor: p.canvas, paddingBottom: Math.max(inset.bottom, space.s4) }]} accessibilityViewIsModal>
        <View style={[st.grabber, { backgroundColor: p.sunken }]} />
        <View style={st.body}>
          <T v="title" role="header">
            승인할 일이 생기면 알려 드릴까요?
          </T>
          <T v="sub" c="ink2">
            앱을 닫아 둬도 PC가 승인을 기다리거나 맡긴 일에 새 소식이 있으면 알림이 와요.
          </T>
          <T v="meta" c="ink3">
            잠금 화면에는 거래처와 금액을 보이지 않아요. 설정에서 언제든 끌 수 있어요.
          </T>
        </View>
        <View style={st.footer}>
          <Button label="알려 주세요" onPress={onYes} testID="push-ask-yes" />
          <Button kind="quiet" label="괜찮아요" onPress={onNo} testID="push-ask-no" />
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  body: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s3 },
  footer: { paddingHorizontal: space.s5, paddingTop: space.s2, gap: space.s2 },
});
