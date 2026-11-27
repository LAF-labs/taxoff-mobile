import { CAP, type Channel, type PhoneCopyBody } from '@sax/remote';
import type { PhoneCopy } from '@sax/chat-core';
import type { Counterparty } from '../issue.ts';
import { phoneCopyFrom } from '../offline/copy.ts';
import { customersOf, type BookCmd, type Customer } from '../book.ts';

/** reportCap: 이 사본을 보낸 PC가 report.v1을 알렸는지(리포트가 없을 때 옛 PC인지, PC가 만들지 못했는지 가른다) */
export type CachedPhoneCopy = PhoneCopyBody & { ownerDesktopDeviceId?: string; reportCap?: boolean };

export const PHONE_CAPS: readonly string[] = [CAP.copy, CAP.issue, CAP.sync, CAP.issued, CAP.book, CAP.amend, CAP.report];

const COPY_WAIT_MS = 2000;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function receiveCopy(ch: Channel, peerCaps: readonly string[], ms = COPY_WAIT_MS): Promise<PhoneCopyBody | null> {
  if (!peerCaps.includes(CAP.copy)) return null;
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0 || ch.closed) return null;
    const e = await ch.recv(left);
    if (!e) return null;
    if (e.type === 'phone.copy') return e.body as PhoneCopyBody;
  }
}

/**
 * 새 사본으로 바꾼다. PC가 돈 요약이나 리포트를 읽지 못했거나 한 프레임에 넣으려 뺐으면(그 칸 없이 온 사본) 같은 PC의 마지막 값을 그대로 둔다.
 */
export function newerCopy(have: CachedPhoneCopy | null | undefined, got: CachedPhoneCopy): CachedPhoneCopy {
  if (have && have.asOf >= got.asOf) return have;
  const same = !!have?.ownerDesktopDeviceId && have.ownerDesktopDeviceId === got.ownerDesktopDeviceId;
  if (!same) return got;
  return { ...got, ...(!got.money && have!.money ? { money: have!.money } : {}), ...(!got.report && have!.report ? { report: have!.report } : {}) };
}

/** '2026-11-03' → '11월 3일'. */
export const dayLabel = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;

const noonOf = (day: string) => Date.parse(`${day}T12:00:00+09:00`);

/** 대화와 발급 화면이 쓰는 거래처 목록: PC 사본에 폰에서 넣고 고친 것(아직 사본에 없는 것)을 겹친다. */
export function counterpartiesOf(body: PhoneCopyBody | null | undefined, book: readonly BookCmd[] = []): Counterparty[] {
  return customersOf(body, book).map(counterpartyOf);
}

export function counterpartyOf(c: Customer): Counterparty {
  const row: Counterparty = { id: c.id, name: c.name, bizNo: c.bizNo, issued: c.last ? 1 : 0 };
  if (c.rep) row.ceo = c.rep;
  if (c.item) row.item = c.item;
  if (c.state && c.stateOn && DAY.test(c.stateOn)) row.status = { kind: 'closed', what: c.state === 'paused' ? '휴업' : '폐업', on: dayLabel(c.stateOn) };
  if (c.last && DAY.test(c.last.day)) {
    row.lastSupply = c.last.supply;
    row.lastItem = c.last.item;
    row.lastAt = noonOf(c.last.day);
  }
  return row;
}

export function chatCopyOf(body: PhoneCopyBody | null | undefined): PhoneCopy | null {
  if (!body) return null;
  const copy = phoneCopyFrom({ asOf: body.asOf, profile: null, counterparties: counterpartiesOf(body), receivables: null });
  const issued = body.issued?.map((r) => {
    const signed = typeof r.supply === 'number' && typeof r.tax === 'number';
    return {
      counterpartyId: r.ref ?? null,
      counterparty: r.name,
      date: r.day,
      total: r.total ?? (signed ? r.supply! + r.tax! : null),
      approvalNo: r.approvalNo ?? null,
      // 수정세금계산서(ADR-058)에 쓰는 값: PC가 amend.v1 사본으로 넘길 때만 있다
      ...(signed ? { supply: r.supply!, tax: r.tax! } : {}),
      ...(r.item ? { item: r.item } : {}),
      ...(r.wrtDay ? { issueDate: r.wrtDay } : {}),
      ...(r.amendOf ? { amendOf: r.amendOf } : {}),
      ...(r.amendState || r.adjSupply || r.adjTax ? { amend: { cancelled: r.amendState === 'cancelled', replaced: r.amendState === 'replaced', adjusted: { supply: r.adjSupply ?? 0, tax: r.adjTax ?? 0 } } } : {}),
    };
  });
  return { ...copy, counterparties: copy.counterparties.map((c) => ({ ...c, bizNo: c.bizNo || null })), ...(issued ? { issued, sales: issued } : {}) };
}
