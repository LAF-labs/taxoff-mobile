// 발급 맡기기: 발급 작성 화면(IssueScreen)과 대화 위 발급 시트(IssueSheet)가 같이 쓴다.
// - PC 사본에서 고른 거래처면 폰 발급 명령(cmd.run, src/entrust.ts)으로 맡긴다. 승인은 PC 승인 바, 작성일자는 오늘.
// - 직접 적은 거래처(또는 사본 밖 거래처)는 밀린 일에 넣는다(PC가 켜져 있으면 바로 준비).
import { useEntrust } from './entrust';
import type { Counterparty, Amounts } from './issue';
import { counterpartiesOf } from './net/pcCopy';
import type { Job } from './queue';
import { useQueue } from './queueStore';
import { useSession } from './session';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

interface IssueInput {
  /** 고른 거래처. 직접 입력이면 null */
  cp: Counterparty | null;
  /** 직접 입력한 상호·등록번호 */
  name: string;
  bizNo: string;
  item: string;
  /** YYYY-MM-DD */
  day: string;
  a: Amounts;
  draftId?: string;
}

/** 이 거래처를 폰 발급 명령으로 맡기나(PC 사본에 있는 거래처이고 PC와 연결돼 있다) */
export function useViaPc(): (cp: Counterparty | null) => boolean {
  const s = useSession();
  const copy = s.data.pcCopy ?? null;
  return (cp) => !!cp && !!copy && !!s.data.pair && counterpartiesOf(copy).some((c) => c.id === cp.id);
}

/** 맡겼으면 true, 폰에 저장하지 못해 맡기지 않았으면 false */
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
    // PC가 되읽을 값(시연 저장소가 승인 요청을 만들 때만 쓴다). 금액은 원 단위 숫자 글자.
    const readback = {
      counterpartBizNo: cp?.bizNo ?? bizNo, counterpartName: who, counterpartEmail: '', itemName: item, itemCount: '1',
      supplyAmount: String(a.supply), taxAmount: String(a.tax), totalAmount: String(a.total), issueDate: day, remark: '', receiptType: '청구',
    };
    queue.add({ ...job }, online ? `${job.title} ${won(a.total)}을 홈택스에서 준비하고 있어요` : `${job.title} ${won(a.total)}을 맡겼어요. PC 켜지면 준비해요`, online ? { supplierBizNo: '', supplierName: '', ...readback } : undefined);
    return true;
  };
}
