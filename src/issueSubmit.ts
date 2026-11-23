import { useEntrust } from './entrust';
import type { Amounts, Counterparty } from './issue';
import { counterpartiesOf } from './net/pcCopy';
import { useSession } from './session';

export const ISSUE_SUBMIT_ERRORS = {
  'recipient-not-on-pc': 'PC 거래처 목록에 없는 곳은 폰에서 발급할 수 없어요. PC에 먼저 등록해 주세요.',
  'save-failed': '폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요',
};

export type IssueSubmitResult = 'submitted' | keyof typeof ISSUE_SUBMIT_ERRORS;

interface IssueInput {
  cp: Counterparty | null;
  item: string;
  a: Pick<Amounts, 'supply' | 'total'>;
  draftId?: string;
}

export function useViaPc(): (cp: Counterparty | null) => boolean {
  const s = useSession();
  const copy = s.data.pcCopy ?? null;
  return (cp) => !!cp && !!copy && !!s.data.pair && counterpartiesOf(copy).some((c) => c.id === cp.id);
}

export function useIssueSubmit(): (x: IssueInput) => Promise<IssueSubmitResult> {
  const entrust = useEntrust();
  const viaPc = useViaPc();
  return async ({ cp, item, a, draftId }) => {
    if (!cp || !viaPc(cp)) return 'recipient-not-on-pc';
    const ok = await entrust({ cp, supply: a.supply, total: a.total, item, draftId });
    return ok ? 'submitted' : 'save-failed';
  };
}
