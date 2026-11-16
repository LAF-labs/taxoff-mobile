// tex 폰 앱(Phase 1, ADR-034 · 기획 v2 앱 틀): 잠금(P-01) → 탭(홈 대화 · 돈 · 기록) → 연결(S-03)·설정·연결 상태(P-06)·촬영(P-08)·현금매출(P-09).
// 잠금: 앱을 열 때 생체, 백그라운드 30초 뒤 다시 잠그고 메모리 키를 지운다. 앱 전환기 미리보기는 가린다.
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LOCK_AFTER_MS, LOCK_DRAIN_MS } from './src/config';
import { drained, endEpoch } from './src/inflight';
import { clearDeviceToken } from './src/net/devauth';
import { ensureFreshInstall, forget, type DeviceKeys } from './src/keyring';
import { sweepCaptureTemps } from './src/storage/files';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { CashScreen } from './src/screens/CashScreen';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { IssueScreen } from './src/screens/IssueScreen';
import { LockScreen } from './src/screens/LockScreen';
import { MainScreen, type MainRoute, type Tab } from './src/screens/MainScreen';
import { PairScreen } from './src/screens/PairScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { QueueProvider } from './src/queueStore';
import { ApprovalHost } from './src/screens/ApprovalHost';
import { SessionProvider } from './src/session';
import { emptyData, loadData, type AppData } from './src/storage/state';
import { usePalette } from './src/theme';
import { T } from './src/ui/kit';

type Route = 'tabs' | MainRoute;

export default function App() {
  const p = usePalette();
  const [boot, setBoot] = useState<{ hasDevice: boolean } | null>(null);
  const [unlocked, setUnlocked] = useState<{ keys: DeviceKeys; data: AppData } | null>(null);
  /** 화면 쌓기: 맨 아래는 늘 탭. 뒤로는 하나 내린다. */
  const [stack, setStack] = useState<Route[]>(['tabs']);
  const [tab, setTab] = useState<Tab>('home');
  const [cover, setCover] = useState(false);
  const [bootErr, setBootErr] = useState(false);
  const bgAt = useRef<number | null>(null);
  const keysRef = useRef<DeviceKeys | null>(null);
  /** 지난 잠금의 정리(진행 중 작업 대기 → 세대 넘김 → 키 지우기). 다시 풀 때 이것이 끝난 뒤 상태를 읽는다. */
  const settling = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    sweepCaptureTemps();
    ensureFreshInstall().then(setBoot, () => setBootErr(true));
  }, []);

  const lock = useCallback(() => {
    // 진행 중 저장·전송이 끝난 뒤 지운다(같은 배열을 쓰는 작업이 0 키로 봉인하지 않게, src/inflight.ts)
    const k = keysRef.current;
    clearDeviceToken();
    settling.current = drained(LOCK_DRAIN_MS).then(() => {
      endEpoch();
      forget(k);
    });
    keysRef.current = null;
    setUnlocked(null);
    setStack(['tabs']);
    setTab('home');
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        setCover(false);
        if (bgAt.current !== null && Date.now() - bgAt.current >= LOCK_AFTER_MS) lock();
        bgAt.current = null;
      } else {
        setCover(true);
        if (st === 'background' && bgAt.current === null) bgAt.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const onUnlocked = async (keys: DeviceKeys) => {
    await settling.current;
    keysRef.current = keys;
    let data = emptyData();
    try {
      data = await loadData(keys.fileKey);
    } catch {
      // 상태 파일 봉인이 깨졌으면 빈 상태로 시작한다(페어링을 다시 한다)
    }
    setBoot({ hasDevice: true });
    setUnlocked({ keys, data });
  };

  let body;
  if (bootErr) body = <View style={st.center}><T c="attention">보호된 저장 공간을 열 수 없어요. 앱을 다시 설치해 주세요.</T></View>;
  else if (!boot) body = <View style={[st.fill, { backgroundColor: p.canvas }]} />;
  else if (!unlocked) body = <LockScreen firstRun={!boot.hasDevice} onUnlocked={(k) => void onUnlocked(k)} onReset={() => setBoot({ hasDevice: false })} />;
  else {
    const route = stack[stack.length - 1] ?? 'tabs';
    const go = (r: MainRoute) => {
      setStack((x) => [...x, r]);
    };
    const back = () => setStack((x) => (x.length > 1 ? x.slice(0, -1) : x));
    const home = () => {
      setTab('home');
      setStack(['tabs']);
    };
    body = (
      <SessionProvider keys={unlocked.keys} initial={unlocked.data}>
        <QueueProvider>
        {route === 'tabs' && <MainScreen tab={tab} onTab={setTab} go={go} />}
        {route === 'pair' && <PairScreen onDone={home} />}
        {route === 'capture' && <CaptureScreen onDone={back} />}
        {route === 'cash' && <CashScreen onDone={back} />}
        {route === 'settings' && <SettingsScreen onDone={back} onConnection={() => go('connection')} onPair={() => go('pair')} />}
        {route === 'queue' && <QueueScreen onDone={back} onConnection={() => go('connection')} onOpen={home} />}
        {route === 'issue' && <IssueScreen counterparties={[]} onDone={back} onCapture={() => go('capture')} onSubmitted={home} />}
        {route === 'connection' && (
          <ConnectionScreen
            onDone={back}
            onRepair={() => go('pair')}
            onReset={() => {
              lock();
              setBoot({ hasDevice: false });
            }}
          />
        )}
        <ApprovalHost />
        </QueueProvider>
      </SessionProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {body}
      {cover && <View style={[StyleSheet.absoluteFill, { backgroundColor: p.canvas }]} testID="privacy-cover" />}
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
