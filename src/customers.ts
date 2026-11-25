import { useMemo } from 'react';
import { ulid } from '@sax/remote';
import { addCmd, customersOf, editCmd, findCustomer, newId, trimBook, type Customer } from './book';
import { counterpartiesOf } from './net/pcCopy';
import type { Counterparty } from './issue';
import { useQueue } from './queueStore';
import { useSession } from './session';

export interface CustomerFields {
  bizNo: string;
  name: string;
  rep?: string;
  email?: string;
  item?: string;
}

/**
 * 거래처 목록과 넣기, 고치기(tex ADR-066). 원본은 PC 장부라, 폰은 명령을 남기고 바로 동기화한다.
 * PC가 꺼져 있으면 큐에 맡기고, 목록에는 PC가 받을 때까지 폰이 넣은 값을 겹쳐 보인다.
 * PC와 연결하기 전에 넣은 거래처도 같은 장부 명령으로 이 폰에 저장해 두고, 연결하면 첫 동기화에 PC로 간다
 * (전에는 화면 상태에만 두어 연결하거나 앱을 다시 열면 사라졌다). 갤러리 예시 목록(q.counterparties)은 그 앞에 둔다.
 */
export function useCustomers() {
  const s = useSession();
  const q = useQueue();
  const copy = s.data.pcCopy ?? null;
  const book = s.data.book;
  const paired = !!s.data.pair;
  const list = useMemo<Customer[]>(() => {
    const mine = customersOf(paired ? copy : null, book);
    if (paired) return mine;
    const local = q.counterparties.map((c) => ({ id: c.id, ref: null, name: c.name, bizNo: c.bizNo, rep: c.ceo, item: c.item, pending: true }));
    return [...local, ...mine.filter((m) => !findCustomer(local, m.bizNo))];
  }, [paired, copy, book, q.counterparties]);
  const counterparties = useMemo<Counterparty[]>(() => {
    const mine = counterpartiesOf(paired ? copy : null, book);
    if (paired) return mine;
    return [...q.counterparties, ...mine.filter((m) => !q.counterparties.some((c) => c.bizNo.replace(/\D/g, '') === m.bizNo.replace(/\D/g, '')))];
  }, [paired, copy, book, q.counterparties]);

  /** 넣은 거래처의 화면 ID. 같은 등록번호가 이미 있으면 그 거래처 ID, 입력이 맞지 않거나 저장하지 못하면 null. */
  const add = async (f: CustomerFields): Promise<string | null> => {
    const have = findCustomer(list, f.bizNo);
    if (have) return have.id;
    const cmdId = ulid();
    const b = addCmd(cmdId, f);
    if (!b) return null;
    try {
      await s.update((d) => ({ ...d, book: trimBook([...(d.book ?? []), b], d.pcCopy) }));
    } catch {
      return null;
    }
    if (paired) void s.sync();
    else q.setPick(newId(cmdId));
    return newId(cmdId);
  };

  /** 고친 거래처의 화면 ID(아직 PC가 받지 않은 거래처는 새 명령 ID로 바뀐다). 맞지 않으면 null. */
  const edit = async (c: Customer, f: { name: string; rep: string; email: string; item: string }): Promise<string | null> => {
    if (!paired) return null;
    const cmdId = ulid();
    const next = editCmd(s.data.book ?? [], c, f, cmdId);
    if (!next) return null;
    try {
      await s.update((d) => ({ ...d, book: next }));
    } catch {
      return null;
    }
    void s.sync();
    return c.ref ?? newId(cmdId);
  };

  return { list, counterparties, paired, hasCopy: !!copy, add, edit };
}
