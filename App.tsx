// tex 폰 앱(Phase 1, ADR-034 · 기획 v2 앱 틀): 첫 실행 온보딩(한 번) → 잠금(P-01) → 탭(홈 대화 · 돈 · 기록) → 연결(S-03)·설정·연결 상태(P-06)·촬영(P-08)·현금매출(P-09).
// 잠금: 앱을 열 때 생체, 백그라운드 30초 뒤 다시 잠그고 메모리 키를 지운다. 앱 전환기 미리보기는 가린다.
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
import { IssueScreen } from './src/screens/IssueScreen';
import { LockScreen } from './src/screens/LockScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { MainScreen, type MainRoute, type Tab } from './src/screens/MainScreen';
import { PairScreen } from './src/screens/PairScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { QueueProvider } from './src/queueStore';
import { ApprovalHost } from './src/screens/ApprovalHost';
import { NotifyHost } from './src/notify/NotifyHost';
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

// 시스템 스플래시(app.json, 바탕색 + 표시)를 첫 화면이 그려질 때까지 둔다. 빈 바탕 한 장이 끼지 않게.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const p = usePalette();
  const [boot, setBoot] = useState<{ hasDevice: boolean; onboarded: boolean } | null>(null);
  const [unlocked, setUnlocked] = useState<{ keys: DeviceKeys; data: AppData } | null>(null);
  /** 화면 쌓기: 맨 아래는 늘 탭. 뒤로는 하나 내린다. */
  const [stack, setStack] = useState<Route[]>(['tabs']);
  /** 첫 실행 온보딩의 마지막 단계(PC와 연결)로 연 페어링 화면인지 */
  const [firstPair, setFirstPair] = useState(false);
  /** 열쇠·PC 연결 단계에서 뒤로 왔을 때 온보딩 마지막 장을 다시 보인다(다음을 누르면 그 단계로 돌아간다) */
  const [review, setReview] = useState(false);
  /** 스플래시가 걷혔는지(온보딩 표시 이동은 그 뒤에 시작한다) */
  const [splashGone, setSplashGone] = useState(false);
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
    // 방금 열쇠를 만든 첫 실행이면 온보딩이 PC와 연결(5/5)까지 이어진다
    if (created && !data.pair) {
      setFirstPair(true);
      setStack(['tabs', 'pair']);
    }
    setUnlocked({ keys, data });
  };

  let body;
  if (bootErr) body = <View style={st.center}><T c="attention">보호된 저장 공간을 열 수 없어요. 앱을 다시 설치해 주세요.</T></View>;
  // 부팅 중에는 스플래시가 덮고 있다(아래 hideAsync). 바탕만 같은 색으로 깔아 둔다.
  else if (!boot) body = <View style={[st.fill, { backgroundColor: p.canvas }]} />;
  else if (review)
    // 뒤로: 온보딩 마지막 장(보안)부터. [다음]·[건너뛰기]는 온 단계(열쇠 만들기 또는 PC와 연결)로 돌아간다. 열쇠는 다시 만들지 않는다
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
        {/* 돈 탭: PC에서 마지막으로 받은 요약(봉인 보관). 지금 받아 오기는 다음 PR(프로토콜) */}
        <MoneyProvider status={unlocked.data.money ? 'ready' : 'none'} snap={unlocked.data.money ?? null}>
        {route === 'tabs' && <MainScreen tab={tab} onTab={setTab} go={go} />}
        {route === 'pair' && (
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
        {route === 'issue' && <IssueScreen onDone={back} onCapture={() => go('bizreg')} onSubmitted={home} />}
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
    // 첫 화면(잠금·첫 실행·오류)이 그려진 다음 프레임에 스플래시를 걷는다.
    // 처음 설치한 뒤 첫 실행은 온보딩의 스플래시 덮개가 표시를 1.5초 더 숨 쉬게 보인다(합쳐 약 1.8~2초).
    if (!ready) return;
    let id = 0;
    // 첫 실행: 온보딩이 같은 모습의 덮개(표시가 숨 쉬는 스플래시)를 이미 그려 두었으니 시스템 스플래시는 바래지 않고 바로 걷는다
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
