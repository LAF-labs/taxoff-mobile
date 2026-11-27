import { issueTarget } from './book';
import { useCustomers } from './customers';
import { useEntrust } from './entrust';
import type { Counterparty, Amounts } from './issue';
import type { IssueTarget } from './phoneCmd';
import { useSession } from './session';

interface IssueInput {
  cp: Counterparty | null;
  item: string;
  a: Amounts;
  draftId?: string;
}

export type IssueSubmit = 'sent' | 'save_failed' | 'no_counterparty';

/**
 * PC로 보낼 거래처. PC 사본에 있는 거래처는 ID로, 폰에서 넣어 아직 사본에 없는 거래처는 등록번호와 상호로 보낸다
 * (PC가 장부에 먼저 넣고 발급한다, tex ADR-066). PC와 연결하지 않았거나 등록번호가 맞지 않으면 null.
 */
export function useIssueTarget(): (cp: Counterparty | null) => IssueTarget | null {
  const s = useSession();
  const { list } = useCustomers();
  const copy = s.data.pcCopy ?? null;
  return (cp) => {
    if (!cp || !s.data.pair || !copy) return null;
    const c = list.find((x) => x.id === cp.id) ?? { ref: null, name: cp.name, bizNo: cp.bizNo };
    return issueTarget(c, copy);
  };
}

export function useViaPc(): (cp: Counterparty | null) => boolean {
  const target = useIssueTarget();
  return (cp) => !!target(cp);
}

export function useIssueSubmit(): (x: IssueInput) => Promise<IssueSubmit> {
  const entrust = useEntrust();
  const targetOf = useIssueTarget();
  return async ({ cp, item, a, draftId }) => {
    const target = targetOf(cp);
    if (!cp || !target) return 'no_counterparty';
    return (await entrust({ cp, target, supply: a.supply, total: a.total, item, draftId })) ? 'sent' : 'save_failed';
  };
}
