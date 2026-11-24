import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LOCK_AFTER_MS, LOCK_DRAIN_MS } from './src/config';
import { drained, endEpoch } from './src/inflight';
import { clearDeviceToken } from './src/net/devauth';
import { closeOfflineChat } from './src/offline/device';
import { ensureFreshInstall, forget, markOnboarded, type DeviceKeys } from './src/keyring';
import { sweepCaptureTemps } from './src/storage/files';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { CashScreen } from './src/screens/CashScreen';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { DevicesScreen } from './src/screens/DevicesScreen';
import { LockScreen } from './src/screens/LockScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { MainScreen, type MainRoute, type Tab } from './src/screens/MainScreen';
import { PairScreen } from './src/screens/PairScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { QueueProvider } from './src/queueStore';
import { ApprovalHost } from './src/screens/ApprovalHost';
import { SimpleAuthHost } from './src/screens/SimpleAuthHost';
import { UnlockHost } from './src/screens/UnlockHost';
import { NotifyHost } from './src/notify/NotifyHost';
import { PushHost } from './src/notify/PushHost';
import { installWakeTap } from './src/notify/push';
import { showCard } from './src/cardFocus';
import { TextSizeHost } from './src/ui/TextSizeHost';
import { DocScreen } from './src/screens/DocScreen';
import { BizRegScreen } from './src/screens/BizRegScreen';
import { MoneyListScreen } from './src/screens/MoneyListScreen';
import { MarkReceivedScreen } from './src/screens/MarkReceivedScreen';
import { MoneyProvider } from './src/moneyStore';
import { RunScreen } from './src/screens/RunScreen';
import { SessionProvider } from './src/session';
import { emptyData, loadData, type AppData } from './src/storage/state';
import { usePalette } from './src/theme';
import { T } from './src/ui/kit';

type Route = 'tabs' | MainRoute;

SplashScreen.preventAutoHideAsync().catch(() => {});
installWakeTap();

export default function App() {
  const p = usePalette();
  const [boot, setBoot] = useState<{ hasDevice: boolean; onboarded: boolean } | null>(null);
  const [unlocked, setUnlocked] = useState<{ keys: DeviceKeys; data: AppData } | null>(null);
  const [stack, setStack] = useState<Route[]>(['tabs']);
  const [firstPair, setFirstPair] = useState(false);
  const [review, setReview] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [cover, setCover] = useState(false);
  const [bootErr, setBootErr] = useState(false);
  const bgAt = useRef<number | null>(null);
  const keysRef = useRef<DeviceKeys | null>(null);
  const settling = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    sweepCaptureTemps();
    ensureFreshInstall().then(setBoot, () => setBootErr(true));
  }, []);

  const lock = useCallback(() => {
    const k = keysRef.current;
    clearDeviceToken();
    closeOfflineChat();
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

  const onUnlocked = async (keys: DeviceKeys, created = false) => {
    await settling.current;
    keysRef.current = keys;
    let data = emptyData();
    try {
      data = await loadData(keys.fileKey);
    } catch {
      // 상태 파일 봉인이 깨졌으면 빈 상태로 시작한다(페어링을 다시 한다)
    }
    setBoot({ hasDevice: true, onboarded: true });
    if (created && !data.pair) {
      setFirstPair(true);
      setStack(['tabs', 'pair']);
    }
    setUnlocked({ keys, data });
  };

  let body;
  if (bootErr) body = <View style={st.center}><T c="attention">보호된 저장 공간을 열 수 없어요. 앱을 다시 설치해 주세요.</T></View>;
  else if (!boot) body = <View style={[st.fill, { backgroundColor: p.canvas }]} />;
  else if (review)
    body = <OnboardingScreen start={2} onDone={() => setReview(false)} />;
  else if (!unlocked && !boot.hasDevice && !boot.onboarded)
    body = (
      <OnboardingScreen
        fromSplash
        revealed={splashGone}
        onDone={() => {
          void markOnboarded();
          setBoot({ hasDevice: false, onboarded: true });
        }}
      />
    );
  else if (!unlocked) body = <LockScreen firstRun={!boot.hasDevice} onUnlocked={(k, created) => void onUnlocked(k, created)} onReset={() => setBoot({ hasDevice: false, onboarded: true })} onBack={!boot.hasDevice ? () => setReview(true) : undefined} />;
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
        <TextSizeHost>
        <QueueProvider>
        {}
        <MoneyProvider status={unlocked.data.money ? 'ready' : 'none'} snap={unlocked.data.money ?? null}>
        {(route === 'tabs' || (route === 'pair' && !firstPair)) && <MainScreen tab={tab} onTab={setTab} go={go} />}
        {route === 'pair' && (
          <View style={firstPair ? { flex: 1 } : StyleSheet.absoluteFill}>
          <PairScreen
            onDone={() => {
              setFirstPair(false);
              home();
            }}
            onboarding={
              firstPair
                ? { onBack: () => setReview(true) }
                : undefined
            }
          />
          </View>
        )}
        {route === 'capture' && <CaptureScreen onDone={back} />}
        {route === 'cash' && <CashScreen onDone={back} />}
        {route === 'settings' && <SettingsScreen onDone={back} onConnection={() => go('connection')} onPair={() => go('pair')} onDevices={() => go('devices')} />}
        {route === 'queue' && <QueueScreen onDone={back} onConnection={() => go('connection')} onOpen={(j) => (j.run ? go('run') : home())} />}
        {route === 'run' && (
          <RunScreen
            onDone={back}
            onDoc={() => go('doc')}
            onRecords={() => {
              setTab('records');
              setStack(['tabs']);
            }}
          />
        )}
        {route === 'doc' && <DocScreen onDone={back} />}
        {route === 'recv' && <MoneyListScreen kind="recv" onDone={back} onMark={() => go('mark')} />}
        {route === 'pay' && <MoneyListScreen kind="pay" onDone={back} onMark={() => go('mark')} />}
        {route === 'mark' && <MarkReceivedScreen onDone={back} />}
        {route === 'bizreg' && <BizRegScreen onDone={back} onSaved={back} onUseExisting={back} />}
        {route === 'devices' && (
          <DevicesScreen
            onDone={back}
            onPair={() => go('pair')}
            onReset={() => {
              lock();
              setBoot({ hasDevice: false, onboarded: true });
            }}
          />
        )}
        {route === 'connection' && (
          <ConnectionScreen
            onDone={back}
            onRepair={() => go('pair')}
            onReset={() => {
              lock();
              setBoot({ hasDevice: false, onboarded: true });
            }}
          />
        )}
        <ApprovalHost />
        <PushHost
          onQueue={() => setStack((x) => (x[x.length - 1] === 'queue' ? x : [...x, 'queue']))}
          onRun={() => setStack((x) => (x[x.length - 1] === 'run' ? x : [...x, 'run']))}
          onCard={(id) => {
            setTab('home');
            setStack(['tabs']);
            showCard(id);
          }}
        />
        <SimpleAuthHost />
        <UnlockHost />
        <NotifyHost
          onRunScreen={route === 'run'}
          onOpen={() => setStack((x) => (x[x.length - 1] === 'run' ? x : [...x, 'run']))}
          onMoney={() => {
            setTab('money');
            setStack(['tabs']);
          }}
        />
        </MoneyProvider>
        </QueueProvider>
        </TextSizeHost>
      </SessionProvider>
    );
  }

  const ready = bootErr || !!boot;
  const fresh = !!boot && !boot.hasDevice && !boot.onboarded;
  useEffect(() => {
    if (!ready) return;
    let id = 0;
    if (fresh) SplashScreen.setOptions({ fade: false, duration: 0 });
    const t = setTimeout(() => {
      id = requestAnimationFrame(() => {
        SplashScreen.hideAsync()
          .catch(() => {})
          .finally(() => setSplashGone(true));
      });
    }, 0);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(id);
    };
  }, [ready, fresh]);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
      <StatusBar style="auto" />
      {body}
      {cover && <View style={[StyleSheet.absoluteFill, { backgroundColor: p.canvas }]} testID="privacy-cover" />}
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
