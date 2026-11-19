// 잠금이 풀린 동안의 앱 상태: 메모리 키, 봉인된 상태 파일, 보관함, PC 연결. 잠그면 통째로 버린다(P-01).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { RECONNECT_MS } from './config';
import { inflight } from './inflight';
import type { DeviceKeys } from './keyring';
import { closeLive, syncWithPc, type PcStatus } from './net/pc';
import { statusWhileSyncing } from './net/pcWhy';
import { failed, netChanged, NET_SETTLE_MS, retryDelay, type NetShape } from './net/reconnect';
import { FileOutbox } from './storage/outbox';
import { saveData, type AppData } from './storage/state';

export interface Session {
  keys: DeviceKeys;
  data: AppData;
  outbox: FileOutbox;
  pending: { receipts: number; cash: number };
  pc: PcStatus;
  syncing: boolean;
  update: (f: (d: AppData) => AppData) => Promise<void>;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
/** 화면 갤러리(gallery/)가 가짜 세션을 넣을 때만 쓴다. 앱은 SessionProvider로만 연다. */
export const SessionContext = Ctx;

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('session: locked');
  return s;
}

export function SessionProvider({ keys, initial, children }: { keys: DeviceKeys; initial: AppData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const dataRef = useRef(initial);
  const outbox = useMemo(() => new FileOutbox(keys.fileKey), [keys]);
  const [pending, setPending] = useState({ receipts: 0, cash: 0 });
  const [pc, setPc] = useState<PcStatus>(initial.pair ? 'offline' : 'unpaired');
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);
  /** 잠그면(이 공급자가 내려가면) 거짓. 지켜보던 발급 명령 세션을 멈춘다. */
  const alive = useRef(true);
  /** 망이 바뀔 때마다 오른다. 바뀌기 전에 연 세션은 반쯤 열렸을 수 있어 멈추고 새로 붙는다. */
  const netGen = useRef(0);
  /** 세션이 도는 중에 망이 바뀌었다: 끝나면 바로 다시 붙는다 */
  const again = useRef(false);
  /** 연속 실패 수와 다음 재시도 타이머 */
  const fails = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const later = useCallback((ms: number) => {
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      retry.current = null;
      if (alive.current && AppState.currentState === 'active') void syncRef.current();
    }, ms);
  }, []);
  useEffect(
    () => () => {
      alive.current = false;
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );

  const update = useCallback(
    async (f: (d: AppData) => AppData) => {
      const next = f(dataRef.current);
      dataRef.current = next;
      setData(next);
      await saveData(keys.fileKey, next);
    },
    [keys],
  );

  const refreshPending = useCallback(async () => setPending(await outbox.counts()), [outbox]);

  const sync = useCallback(async () => {
    if (busy.current || !dataRef.current.pair) {
      if (!dataRef.current.pair) setPc('unpaired');
      return;
    }
    busy.current = true;
    again.current = false;
    setSyncing(true);
    setPc(statusWhileSyncing);
    const gen = netGen.current;
    let ok: boolean;
    try {
      const r = await inflight(() =>
        syncWithPc({ keys, data: () => dataRef.current, update, outbox, onLive: () => alive.current && setPc('online'), alive: () => alive.current && netGen.current === gen }),
      );
      setPc(r.status);
      ok = !failed(r.status);
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshPending();
    }
    if (!alive.current) return;
    if (again.current) {
      // 도는 중에 망이 바뀌었다: 새 망으로 바로 다시 붙는다
      fails.current = 0;
      later(NET_SETTLE_MS);
    } else if (ok) {
      fails.current = 0;
    } else {
      // 실패가 이어지면 3초에서 늘려 가며 다시 붙는다(최대 RECONNECT_MS, 지터)
      fails.current += 1;
      later(retryDelay(fails.current, RECONNECT_MS));
    }
  }, [keys, update, outbox, refreshPending, later]);
  syncRef.current = sync;

  useEffect(() => {
    void refreshPending();
    void sync();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, RECONNECT_MS);
    // 앱이 다시 앞으로 오면 주기를 기다리지 않고 바로 붙는다(잠자기·망 전환 뒤 반쯤 열린 연결 대신 새 연결)
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void sync();
      // 뒤로 가면 PC 연결을 닫는다: PC가 폰이 없다고 알아야 승인 요청을 서버 푸시로 알린다(net/pc.ts closeLive)
      else if (st === 'background') closeLive();
    });
    // 망이 바뀌면(와이파이에서 LTE 등) 60초를 기다리지 않고 바로 다시 붙는다. 붙어 있던 세션은 멈춘다(반쯤 열린 연결에 매달리지 않게).
    let net: NetShape | null = null;
    const unNet = NetInfo.addEventListener((st) => {
      const next: NetShape = { type: String(st.type), reachable: st.isInternetReachable ?? st.isConnected ?? null };
      const changed = netChanged(net, next);
      net = next;
      if (!changed) return;
      netGen.current += 1;
      fails.current = 0;
      if (busy.current) again.current = true;
      else if (AppState.currentState === 'active') later(NET_SETTLE_MS);
    });
    return () => {
      clearInterval(t);
      sub.remove();
      unNet();
    };
  }, [sync, refreshPending, later]);

  const value = useMemo<Session>(() => ({ keys, data, outbox, pending, pc, syncing, update, sync, refreshPending }), [keys, data, outbox, pending, pc, syncing, update, sync, refreshPending]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
