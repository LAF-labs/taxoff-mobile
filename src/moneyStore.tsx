import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { METHOD_LABEL, exactWon, storeable, type MoneySnapshot, type PhoneMarkMethod, type ReceivableView } from './money';
import { useQueue } from './queueStore';
import { josa } from './ui/josa';
import type { AppData } from './storage/state';

export type MoneyStatus = 'loading' | 'ready' | 'error' | 'none';

export type MarkState =
  | { kind: 'done'; seq: number; method: PhoneMarkMethod; amount: number }
  | { kind: 'queued' }
  | { kind: 'already' }
  | { kind: 'undone' };

interface MoneyStore {
  status: MoneyStatus;
  snap: MoneySnapshot | null;
  live: boolean;
  marks: Record<string, MarkState>;
  focus: ReceivableView | null;
  setFocus: (id: string | null) => void;
  markReceived: (rv: ReceivableView, p: { method: PhoneMarkMethod; amount: number; on: string }, pcOnline: boolean) => void;
  undo: (rid: string) => void;
}

const Ctx = createContext<MoneyStore | null>(null);

export function MoneyProvider({
  status: initialStatus = 'none', snap = null, live = false, marks: initialMarks = {}, focus: initialFocus = null, children,
}: {
  status?: MoneyStatus;
  snap?: MoneySnapshot | null;
  live?: boolean;
  marks?: Record<string, MarkState>;
  focus?: string | null;
  children: ReactNode;
}) {
  const q = useQueue();
  const [status] = useState<MoneyStatus>(initialStatus);
  const [marks, setMarks] = useState<Record<string, MarkState>>(initialMarks);
  const [focusId, setFocusId] = useState<string | null>(initialFocus);
  const [seq, setSeq] = useState(100);

  const store = useMemo<MoneyStore>(
    () => ({
      status,
      snap,
      live,
      marks,
      focus: snap?.receivables.find((r) => r.id === focusId) ?? null,
      setFocus: setFocusId,
      markReceived: (rv, p, pcOnline) => {
        if (!pcOnline) {
          q.add(
            { id: `mark-${rv.id}-${Date.now()}`, title: `${rv.cpName ?? '거래처'} 받음 처리`, amount: p.amount, createdAt: Date.now(), state: 'entrusted' },
            `${josa(rv.cpName ?? '거래처', '을', '를')} ${exactWon(p.amount)} 받음(${METHOD_LABEL[p.method]})으로 맡겼어요. PC 켜지면 처리해요`,
          );
          setMarks((m) => ({ ...m, [rv.id]: { kind: 'queued' } }));
          return;
        }
        const prev = marks[rv.id];
        if (rv.remaining <= 0 || prev?.kind === 'done') {
          setMarks((m) => ({ ...m, [rv.id]: { kind: 'already' } }));
          return;
        }
        setSeq((n) => n + 1);
        setMarks((m) => ({ ...m, [rv.id]: { kind: 'done', seq: seq + 1, method: p.method, amount: p.amount } }));
      },
      undo: (rid) => setMarks((m) => ({ ...m, [rid]: { kind: 'undone' } })),
    }),
    [status, snap, live, marks, focusId, seq, q],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export async function keepSnapshot(update: (f: (d: AppData) => AppData) => Promise<void>, snap: MoneySnapshot): Promise<void> {
  await update((d) => ({ ...d, money: storeable(snap) }));
}

export function useMoney(): MoneyStore {
  const m = useContext(Ctx);
  if (!m) throw new Error('money: no provider');
  return m;
}
