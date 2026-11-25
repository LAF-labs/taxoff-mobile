import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { RECONNECT_MS } from './config';
import { inflight } from './inflight';
import type { DeviceKeys } from './keyring';
import SaxNative from '../modules/sax-native/src/SaxNativeModule';
import { deviceApprovalKey } from './approvalKey';
import { closeLive, onPresence, syncWithPc, type PcStatus } from './net/pc';
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
  const [pc, setPc] = useState<PcStatus>(initial.pair ? 'connecting' : 'unpaired');
  const [syncing, setSyncing] = useState(false);
  const px = useMemo(() => deviceApprovalKey(SaxNative), []);
  const busy = useRef(false);
  const alive = useRef(true);
  const netGen = useRef(0);
  const retryAfterSync = useRef<number | null>(null);
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
      closeLive();
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
    if (!dataRef.current.pair) {
      setPc('unpaired');
      return;
    }
    if (busy.current) {
      // 도는 중에 새로 맡긴 것이 생기면 끝난 뒤 한 번 더 돈다(버리지 않는다).
      retryAfterSync.current ??= NET_SETTLE_MS;
      return;
    }
    busy.current = true;
    retryAfterSync.current = null;
    setSyncing(true);
    setPc(statusWhileSyncing);
    const gen = netGen.current;
    const current = () => alive.current && netGen.current === gen;
    let ok = false;
    try {
      const r = await inflight(() =>
        syncWithPc({ keys, data: () => dataRef.current, update, outbox, px, onLive: () => current() && setPc('online'), alive: current }),
      );
      if (current()) {
        setPc(r.status);
        ok = !failed(r.status);
      }
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshPending();
    }
    if (!alive.current || AppState.currentState !== 'active') return;
    if (retryAfterSync.current !== null) {
      fails.current = 0;
      later(retryAfterSync.current);
    } else if (!current()) {
      return;
    } else if (ok) {
      fails.current = 0;
    } else {
      fails.current += 1;
      later(retryDelay(fails.current, RECONNECT_MS));
    }
  }, [keys, update, outbox, refreshPending, px, later]);
  syncRef.current = sync;

  useEffect(() => {
    onPresence((p) => {
      if (!alive.current) return;
      if (p === 'down') {
        setPc((prev) => (prev === 'online' ? 'offline' : prev));
        void update((x) => ({ ...x, lastSeenPc: Date.now() })).catch(() => undefined);
      } else if (AppState.currentState === 'active') later(p === 'up' ? 0 : NET_SETTLE_MS);
    });
    return () => onPresence(null);
  }, [update, later]);

  useEffect(() => {
    void refreshPending();
    void sync();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, RECONNECT_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        if (busy.current) retryAfterSync.current ??= 0;
        else void sync();
      } else if (st === 'background') {
        netGen.current += 1;
        closeLive();
        setPc((prev) => (prev === 'online' ? 'connecting' : prev));
      }
    });
    let net: NetShape | null = null;
    const unNet = NetInfo.addEventListener((st) => {
      const next: NetShape = { type: String(st.type), reachable: st.isInternetReachable ?? st.isConnected ?? null };
      const changed = netChanged(net, next);
      net = next;
      if (!changed) return;
      netGen.current += 1;
      fails.current = 0;
      if (busy.current) retryAfterSync.current = NET_SETTLE_MS;
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
