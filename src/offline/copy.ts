// 폰 화면이 가진 거래처 목록(issue.ts Counterparty) → 대화 코어의 폰 사본(PhoneCopy).
// 사본은 PC가 넘긴 것만 쓴다(폰이 지어내지 않는다). PC가 거래처·최근 발급을 넘기는 봉투가 생기면 그 값을 이 함수로 바꿔 넣는다.
import type { CopyRow, PhoneCopy } from '@sax/chat-core';
import { taxOf, type Counterparty } from '../issue.ts';

/** KST 날짜(YYYY-MM-DD). 한국은 서머타임이 없다. */
const kst = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

interface CopySource {
  /** PC가 이 목록을 만든 시각(ms) */
  asOf: number;
  profile: PhoneCopy['profile'];
  counterparties: Counterparty[];
  /** 입금 확인 전 목록. 계좌를 잇지 않았거나 PC가 넘기지 않았으면 null */
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
