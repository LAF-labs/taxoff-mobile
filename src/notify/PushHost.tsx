// 푸시 깨우기 자리(App에 하나, 잠금이 풀린 동안, ADR-053 결정 4).
//   - 토큰: PC와 붙어 있고 OS 허용과 설정 스위치가 켜져 있으면 기기 토큰을 올린다. 지난번과 같은 토큰이면 올리지 않는다.
//     스위치를 끄거나 OS에서 끄면 지운다(PC 연결 해제 때는 screens/leavePhone.ts가 지운다).
//   - 허용: 첫 발급을 맡긴 뒤 한 번만 앱 안 시트로 묻고, 좋다고 하면 OS 창을 띄운다. 거절하면 다시 묻지 않는다(설정에 스위치).
//   - 누름: approve는 PC와 붙어 승인 시트를, 시트가 안 오면(게이트가 닫혔다) 그 실행의 지금 상태를. update는 맡긴 일 목록.
//   - 앱이 앞에 있을 때 온 깨우기는 배너 없이 바로 sync(). 세션이 붙으면 알림 센터의 깨우기 알림을 지운다.
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

/** 맡긴 직후 화면이 바뀌는 사이에 끼지 않게 조금 뒤에 묻는다 */
const ASK_DELAY_MS = 700;

export function PushHost({ onQueue, onRun, askPreview }: {
  /** 맡긴 일 목록(밀린 일)으로 */
  onQueue: () => void;
  /** q.focus 실행의 진행 화면으로 */
  onRun: () => void;
  /** 갤러리: 허용 묻는 시트를 바로 보인다 */
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
  /** approve를 눌러 승인 시트를 기다리는 중(sync가 끝난 뒤 SHEET_WAIT_MS) */
  const [waitSheet, setWaitSheet] = useState<number | null>(null);
  const live = useRef({ s, q, onQueue, onRun });
  live.current = { s, q, onQueue, onRun };

  const pair = s.data.pair;
  const online = s.pc === 'online';
  const wake = wakeOn(s.data.notify);

  // OS 허용(설정 앱에서 바꾸고 돌아오면 다시 읽는다)
  useEffect(() => {
    if (askPreview) return;
    const read = () => void permission().then(setPerm);
    read();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && read());
    return () => sub.remove();
  }, [askPreview]);

  // OS가 토큰을 바꾸면 다시 맞춘다
  useEffect(
    () =>
      onTokenChange((t) => {
        token.current = t;
        setTokTick((n) => n + 1);
      }),
    [],
  );

  // 서버와 맞추기: 붙어 있을 때만(망이 되는 때). 실패하면 다음에 붙을 때 다시
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

  // 세션이 붙으면 알림 센터의 깨우기 알림을 지운다
  useEffect(() => {
    if (online && !askPreview) void clearWakeNotifications();
  }, [online, askPreview]);

  // 앱이 앞에 있을 때 온 깨우기: 배너 없이 바로 붙는다
  useEffect(() => onWakeReceived(() => void live.current.s.sync()), []);

  // 누른 깨우기(잠금 화면에서 눌렀으면 잠금이 풀린 지금 꺼낸다)
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

  // approve: PC가 다시 보낸 승인 요청이 오면 시트를 연다. 기다려도 안 오면 그 실행의 지금 상태
  const gated = q.jobs.find((j) => j.gate && j.state === 'approval' && j.gate.exp > Date.now()) ?? null;
  useEffect(() => {
    if (waitSheet === null) return;
    const { q: cq, onRun: toRun, onQueue: toQueue } = live.current;
    if (gated) {
      setWaitSheet(null);
      if (cq.sheetJob?.id !== gated.id) cq.openSheet(gated.id);
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

  // 앱으로 돌아왔는데 열린 승인 요청이 있고 시트가 닫혀 있으면 연다(뒤에서 받은 요청은 사장님이 아직 못 봤다)
  useEffect(() => {
    if (askPreview) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const { q: cq } = live.current;
      const g = cq.jobs.find((j) => j.id.startsWith('cmd-') && j.gate && j.state === 'approval' && j.gate.exp > Date.now());
      if (g && !cq.sheetJob) cq.openSheet(g.id);
    });
    return () => sub.remove();
  }, [askPreview]);

  // 앱이 뒤에 있는데 승인 요청이 왔다(뒤로 간 직후 아직 붙어 있던 연결로): 폰이 직접 알린다. 앞에 있으면 시트가 바로 뜬다
  const told = useRef(new Set<string>());
  useEffect(() => {
    if (askPreview) return;
    const fresh = newGates(q.jobs, told.current, Date.now());
    if (!fresh.length) return;
    for (const j of fresh) told.current.add(j.gate!.reqId);
    if (AppState.currentState === 'active' || !wakeOn(live.current.s.data.notify)) return;
    void notifyNow({ title: '승인을 기다리는 발급이 있어요', body: '눌러서 승인하거나 거절해 주세요' }, { open: LOCAL_APPROVE, jobId: fresh[0]!.id });
  }, [q.jobs, askPreview]);

  // 허용 묻기: 첫 발급을 맡긴 뒤 한 번
  const entrusted = (s.data.cmds ?? []).length;
  const due = !askPreview && askDue({ entrusted, asked: !!s.data.pushAsked, perm });
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(() => setAsking(true), ASK_DELAY_MS);
    return () => clearTimeout(t);
  }, [due]);
  // OS에서 이미 정했으면(허용·거절) 묻지 않고 물은 것으로 둔다
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

/** 승인 시트와 같은 모양(가림막 + 아래에서 올라온 둥근 시트 + 손잡이) */
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
