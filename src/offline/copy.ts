import type { CopyRow, PhoneCopy } from '@sax/chat-core';
import { taxOf, type Counterparty } from '../issue.ts';

const kst = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

interface CopySource {
  asOf: number;
  profile: PhoneCopy['profile'];
  counterparties: Counterparty[];
  receivables?: CopyRow[] | null;
}

export function phoneCopyFrom(src: CopySource): PhoneCopy {
  const issued: CopyRow[] = [];
  for (const c of src.counterparties) {
    if (c.lastSupply === undefined || c.lastAt === undefined) continue;
    issued.push({ counterpartyId: c.id, counterparty: c.name, date: kst(c.lastAt), total: c.lastSupply + taxOf(c.lastSupply), approvalNo: null });
  }
  return {
    asOf: src.asOf,
    profile: src.profile,
    counterparties: src.counterparties.map((c) => ({ id: c.id, name: c.name, bizNo: c.bizNo, item: c.lastItem ?? null })),
    issued,
    receivables: src.receivables ?? null,
  };
}
