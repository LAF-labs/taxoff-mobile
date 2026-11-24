import { useEntrust } from './entrust';
import type { Counterparty, Amounts } from './issue';
import { counterpartiesOf } from './net/pcCopy';
import { useSession } from './session';

interface IssueInput {
  cp: Counterparty | null;
  item: string;
  a: Amounts;
  draftId?: string;
}

export type IssueSubmit = 'sent' | 'save_failed' | 'new_counterparty';

export function useViaPc(): (cp: Counterparty | null) => boolean {
  const s = useSession();
  const copy = s.data.pcCopy ?? null;
  return (cp) => !!cp && !!copy && !!s.data.pair && counterpartiesOf(copy).some((c) => c.id === cp.id);
}

export function useIssueSubmit(): (x: IssueInput) => Promise<IssueSubmit> {
  const entrust = useEntrust();
  const viaPc = useViaPc();
  return async ({ cp, item, a, draftId }) => {
    if (!cp || !viaPc(cp)) return 'new_counterparty';
    return (await entrust({ cp, supply: a.supply, total: a.total, item, draftId })) ? 'sent' : 'save_failed';
  };
}
