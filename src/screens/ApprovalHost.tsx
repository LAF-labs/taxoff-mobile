import { useMemo } from 'react';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { deviceApprovalKey, fakeApprovalKey, type ApprovalKey } from '../approvalKey';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { ApprovalSheet } from './ApprovalSheet';

export function approvalKeyFor(jobId: string | undefined, attest: Parameters<typeof fakeApprovalKey>[0]): ApprovalKey {
  return jobId?.startsWith('cmd-') ? (deviceApprovalKey(SaxNative) ?? fakeApprovalKey('none')) : fakeApprovalKey(attest);
}

export function ApprovalHost({ approvalKey, preview }: { approvalKey?: ApprovalKey; preview?: { now: number; openedAt: number; acked?: string[] } }) {
  const q = useQueue();
  const s = useSession();
  const job = q.sheetJob;
  const id = job?.id;
  const key = useMemo(() => approvalKey ?? approvalKeyFor(id, q.approval.attest), [approvalKey, id, q.approval.attest]);
  if (!job?.gate) return null;
  return (
    <ApprovalSheet
      key={`${job.id}:${job.gate.exp}`}
      gate={job.gate}
      settings={q.approval}
      approvalKey={key}
      pairId={s.data.pair?.pairId ?? ''}
      inDoubt={job.state === 'verify'}
      onAnswer={(a) => q.decide(job.id, a.decision, a)}
      onPark={(reason) => q.park(job.id, reason)}
      onRerequest={() => q.rerequest(job.id)}
      onClose={q.closeSheet}
      preview={preview}
    />
  );
}
