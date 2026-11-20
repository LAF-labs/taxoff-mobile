import { useEntrust } from './entrust';
import type { Counterparty, Amounts } from './issue';
import { counterpartiesOf } from './net/pcCopy';
import type { Job } from './queue';
import { useQueue } from './queueStore';
import { useSession } from './session';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

interface IssueInput {
  cp: Counterparty | null;
  name: string;
  bizNo: string;
  item: string;
  day: string;
  a: Amounts;
  draftId?: string;
}

export function useViaPc(): (cp: Counterparty | null) => boolean {
  const s = useSession();
  const copy = s.data.pcCopy ?? null;
  return (cp) => !!cp && !!copy && !!s.data.pair && counterpartiesOf(copy).some((c) => c.id === cp.id);
}

export function useIssueSubmit(): (x: IssueInput) => Promise<boolean> {
  const s = useSession();
  const queue = useQueue();
  const entrust = useEntrust();
  const viaPc = useViaPc();
  return async ({ cp, name, bizNo, item, day, a, draftId }) => {
    if (cp && viaPc(cp)) return entrust({ cp, supply: a.supply, total: a.total, item, draftId });
    const who = cp?.name ?? name.trim();
    const online = s.pc === 'online';
    const job: Job = { id: `job-${Date.now()}`, title: `${who} 세금계산서`, amount: a.total, createdAt: Date.now(), state: online ? 'running' : 'entrusted' };
    const readback = {
      counterpartBizNo: cp?.bizNo ?? bizNo, counterpartName: who, counterpartEmail: '', itemName: item, itemCount: '1',
      supplyAmount: String(a.supply), taxAmount: String(a.tax), totalAmount: String(a.total), issueDate: day, remark: '', receiptType: '청구',
    };
    queue.add({ ...job }, online ? `${job.title} ${won(a.total)}을 홈택스에서 준비하고 있어요` : `${job.title} ${won(a.total)}을 맡겼어요. PC 켜지면 준비해요`, online ? { supplierBizNo: '', supplierName: '', ...readback } : undefined);
    return true;
  };
}
