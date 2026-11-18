// 잠금이 풀린 동안의 앱 상태: 메모리 키, 봉인된 상태 파일, 보관함, PC 연결. 잠그면 통째로 버린다(P-01).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { RECONNECT_MS } from './config';
import { inflight } from './inflight';
import type { DeviceKeys } from './keyring';
import { syncWithPc, type PcStatus } from './net/pc';
import { statusWhileSyncing } from './net/pcWhy';
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
  useEffect(
    () => () => {
      alive.current = false;
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
    setSyncing(true);
    setPc(statusWhileSyncing);
    try {
      const r = await inflight(() => syncWithPc({ keys, data: () => dataRef.current, update, outbox, onLive: () => alive.current && setPc('online'), alive: () => alive.current }));
      setPc(r.status);
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshPending();
    }
  }, [keys, update, outbox, refreshPending]);

  useEffect(() => {
    void refreshPending();
    void sync();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, RECONNECT_MS);
    // 앱이 다시 앞으로 오면 주기를 기다리지 않고 바로 붙는다(잠자기·망 전환 뒤 반쯤 열린 연결 대신 새 연결)
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void sync();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [sync, refreshPending]);

  const value = useMemo<Session>(() => ({ keys, data, outbox, pending, pc, syncing, update, sync, refreshPending }), [keys, data, outbox, pending, pc, syncing, update, sync, refreshPending]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
