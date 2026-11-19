// 승인 시트를 화면 맨 위에 띄운다(밀린 일 [승인 열기]나 PC 승인 요청이 오면). 시트는 한 번에 하나.
import { useMemo } from 'react';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { deviceApprovalKey, fakeApprovalKey, type ApprovalKey } from '../approvalKey';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { ApprovalSheet } from './ApprovalSheet';

/** 승인 서명 키: 폰 발급 명령(cmd-)은 하드웨어 키만(없으면 'none'이라 멈춘다). 갤러리, 시연의 가짜 일은 가짜 키. 카드 승인도 같이 쓴다. */
export function approvalKeyFor(jobId: string | undefined, attest: Parameters<typeof fakeApprovalKey>[0]): ApprovalKey {
  return jobId?.startsWith('cmd-') ? (deviceApprovalKey(SaxNative) ?? fakeApprovalKey('none')) : fakeApprovalKey(attest);
}

export function ApprovalHost({ approvalKey, preview }: { approvalKey?: ApprovalKey; preview?: { now: number; openedAt: number; acked?: string[] } }) {
  const q = useQueue();
  const s = useSession();
  const job = q.sheetJob;
  // 폰 발급 명령(cmd-)의 승인은 하드웨어 키로만 서명한다(ADR-052). 키가 없는 빌드는 증명 상태가 'none'이라 "PC에서 승인"으로 멈춘다.
  // 갤러리·시연의 가짜 일은 가짜 키(증명 상태는 설정값).
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
