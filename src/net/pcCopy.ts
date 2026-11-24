import { CAP, type Channel, type PhoneCopyBody } from '@sax/remote';
import type { PhoneCopy } from '@sax/chat-core';
import type { Counterparty } from '../issue.ts';
import { phoneCopyFrom } from '../offline/copy.ts';

export const PHONE_CAPS: readonly string[] = [CAP.copy, CAP.issue, CAP.sync, CAP.issued];

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

export function newerCopy(have: PhoneCopyBody | null | undefined, got: PhoneCopyBody): PhoneCopyBody {
  if (have && have.asOf >= got.asOf) return have;
  return !got.money && have?.money ? { ...got, money: have.money } : got;
}

const noonOf = (day: string) => Date.parse(`${day}T12:00:00+09:00`);

export function counterpartiesOf(body: PhoneCopyBody): Counterparty[] {
  return body.counterparties.map((c) => {
    const row: Counterparty = { id: c.ref, name: c.name, bizNo: c.bizNo ?? '', issued: c.last ? 1 : 0 };
    if (c.last && DAY.test(c.last.day)) {
      row.lastSupply = c.last.supply;
      row.lastItem = c.last.item;
      row.lastAt = noonOf(c.last.day);
    }
    return row;
  });
}

export function chatCopyOf(body: PhoneCopyBody | null | undefined): PhoneCopy | null {
  if (!body) return null;
  const copy = phoneCopyFrom({ asOf: body.asOf, profile: null, counterparties: counterpartiesOf(body), receivables: null });
  const issued = body.issued?.map((r) => ({ counterpartyId: r.ref ?? null, counterparty: r.name, date: r.day, total: r.total, approvalNo: null }));
  return { ...copy, counterparties: copy.counterparties.map((c) => ({ ...c, bizNo: c.bizNo || null })), ...(issued ? { issued, sales: issued } : {}) };
}
