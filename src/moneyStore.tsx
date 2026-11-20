// 돈 탭 저장소(기획 v2 PR 8). PC가 켜져 있으면 물어 받고(db.query.bank.summary·cashflow·받을/낼 돈 목록),
// 꺼져 있으면 폰에 봉인 보관한 마지막 요약(AppData.money)을 날짜와 함께 보인다. PC와 주고받는 프로토콜은 다음 PR이라
// 앱에서는 보관한 값만 쓰고, 갤러리(simulate)는 가짜 값으로 받음 표시·되돌리기를 흉내 낸다.
// 받음 표시는 bank.markReceived → {seq}, 되돌리기는 bank.undo {seq}. PC가 꺼져 있으면 밀린 일로 맡긴다.
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
  /** 지금 PC에서 받은 값인지(아니면 마지막으로 받은 값) */
  live: boolean;
  marks: Record<string, MarkState>;
  /** 받음 표시 화면이 보는 건 */
  focus: ReceivableView | null;
  setFocus: (id: string | null) => void;
  reload: () => void;
  markReceived: (rv: ReceivableView, p: { method: PhoneMarkMethod; amount: number; on: string }, pcOnline: boolean) => void;
  undo: (rid: string) => void;
}

const Ctx = createContext<MoneyStore | null>(null);

export function MoneyProvider({
  status: initialStatus = 'none', snap = null, live = false, simulate = false, marks: initialMarks = {}, focus: initialFocus = null, children,
}: {
  status?: MoneyStatus;
  snap?: MoneySnapshot | null;
  live?: boolean;
  simulate?: boolean;
  marks?: Record<string, MarkState>;
  focus?: string | null;
  children: ReactNode;
}) {
  const q = useQueue();
  const [status, setStatus] = useState<MoneyStatus>(initialStatus);
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
      reload: () => {
        // 프로토콜 전: 시연에서만 잠깐 불러오는 중을 보였다가 돌아온다
        if (!simulate) return;
        setStatus('loading');
        setTimeout(() => setStatus(snap ? 'ready' : 'none'), 900);
      },
      markReceived: (rv, p, pcOnline) => {
        if (!pcOnline) {
          // PC가 꺼져 있으면 밀린 일로 맡긴다(켜지면 bank.markReceived)
          q.add(
            { id: `mark-${rv.id}-${Date.now()}`, title: `${rv.cpName ?? '거래처'} 받음 처리`, amount: p.amount, createdAt: Date.now(), state: 'entrusted' },
            `${josa(rv.cpName ?? '거래처', '을', '를')} ${exactWon(p.amount)} 받음(${METHOD_LABEL[p.method]})으로 맡겼어요. PC 켜지면 처리해요`,
          );
          setMarks((m) => ({ ...m, [rv.id]: { kind: 'queued' } }));
          return;
        }
        // 시연: 이미 처리된 건(남은 돈 0)은 already_received
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
    [status, snap, live, marks, focusId, seq, simulate, q],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/**
 * PC에서 받은 요약을 폰에 보관한다(봉인 상태 파일 AppData.money, 파일 보호 Complete·백업 제외).
 * 거래처 이름·금액·날짜만 남기고 사업자번호·승인번호 끝·계좌 번호는 지운다. 받아 오기(프로토콜)가 생기면 여기로 넣는다.
 */
export async function keepSnapshot(update: (f: (d: AppData) => AppData) => Promise<void>, snap: MoneySnapshot): Promise<void> {
  await update((d) => ({ ...d, money: storeable(snap) }));
}

export function useMoney(): MoneyStore {
  const m = useContext(Ctx);
  if (!m) throw new Error('money: no provider');
  return m;
}
