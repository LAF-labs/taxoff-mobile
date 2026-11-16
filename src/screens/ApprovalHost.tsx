// 승인 시트를 화면 맨 위에 띄운다(밀린 일 [승인 열기]나 PC 승인 요청이 오면). 시트는 한 번에 하나.
import { useMemo } from 'react';
import { fakeApprovalKey, type ApprovalKey } from '../approvalKey';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { ApprovalSheet } from './ApprovalSheet';

export function ApprovalHost({ approvalKey, preview }: { approvalKey?: ApprovalKey; preview?: { now: number; openedAt: number; acked?: string[] } }) {
  const q = useQueue();
  const s = useSession();
  const job = q.sheetJob;
  // 진짜 하드웨어 키 연동 전에는 가짜 키(증명 상태는 설정값). 앱 기본 설정은 'none'이라 늘 "PC에서 승인"으로 멈춘다.
  const key = useMemo(() => approvalKey ?? fakeApprovalKey(q.approval.attest), [approvalKey, q.approval.attest]);
  if (!job?.gate) return null;
  return (
    <ApprovalSheet
      key={`${job.id}:${job.gate.exp}`}
      gate={job.gate}
      settings={q.approval}
      approvalKey={key}
      pairId={s.data.pair?.pairId ?? ''}
      inDoubt={job.state === 'verify'}
      onAnswer={(a) => q.decide(job.id, a.decision)}
      onPark={(reason) => q.park(job.id, reason)}
      onRerequest={() => q.rerequest(job.id)}
      onClose={q.closeSheet}
      preview={preview}
    />
  );
}
