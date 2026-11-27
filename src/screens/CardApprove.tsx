import { useEffect, useMemo, useState } from 'react';
import { APPROVE_CTX, approveMessage, readGate, sheetState, showValue, type PhoneGate } from '../approval';
import type { Job } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { Actions, Kv, KvRow } from '../ui/card';
import { Button, T, success } from '../ui/kit';
import { ConfirmSheet } from '../ui/sheet';
import { approvalKeyFor } from './ApprovalHost';

const ROWS: ReadonlyArray<{ key: string; label: string; strong?: boolean }> = [
  { key: 'supplyAmount', label: '공급가액' },
  { key: 'taxAmount', label: '부가세' },
  { key: 'totalAmount', label: '합계', strong: true },
];

export function CardApprove({ job, gate, onDetail, now: fixedNow }: { job: Job; gate: PhoneGate; onDetail: () => void; now?: number }) {
  const q = useQueue();
  const s = useSession();
  const [openedAt] = useState(() => fixedNow ?? Date.now());
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixedNow]);
  const key = useMemo(() => approvalKeyFor(job.id, q.approval.attest), [job.id, q.approval.attest]);
  const state = sheetState(gate, { now, openedAt: openedAt - 1000, attest: q.approval.attest, iosAllowed: q.approval.iosAllowed, usedToday: q.approval.usedToday, acked: new Set(), inDoubt: job.state === 'verify' });
  const r = readGate(gate);
  const direct = state.kind === 'open' && !state.needsAck;

  const answer = async (decision: 'approve' | 'deny') => {
    setBusy(true);
    try {
      // 거절은 일을 멈추기만 해서 Face ID를 묻지 않는다(PC는 서명 없는 거절을 받는다).
      const signed = decision === 'deny' ? { sig: '' } : await key.sign(APPROVE_CTX, approveMessage(s.data.pair?.pairId ?? '', gate.reqId, gate.challenge, gate.actionHash, decision));
      if (!signed) return;
      if (decision === 'approve') success();
      q.decide(job.id, decision, { reqId: gate.reqId, actionHash: gate.actionHash, sig: signed.sig });
    } finally {
      setBusy(false);
    }
  };

  // 받는 곳은 카드 제목에 있다(기준판 Phone-Approve). 값 줄과 단추 줄만 그린다.
  return (
    <>
      <Kv testID={`card-approve-${job.id}`}>
        {r.amend && <KvRow label="사유" value={r.amend.label} testID="card-approve-amend" />}
        {ROWS.map((x) => (r.values[x.key] !== undefined ? <KvRow key={x.key} label={x.label} value={showValue(x.key, r.values[x.key]!)} total={x.strong} /> : null))}
      </Kv>
      {direct ? (
        <Actions>
          <Button
            kind="approve"
            label="승인하고 발급"
            hint="얼굴이나 지문으로 확인한 뒤 홈택스에서 바로 발급해요"
            onPress={() => void answer('approve')}
            busy={busy}
            disabled={!state.armed}
            testID="card-approve"
          />
          <Button kind="secondary" label="거절" onPress={() => setAsking(true)} disabled={busy} testID="card-deny" />
        </Actions>
      ) : (
        <>
          <T v="sub" c="attention">
            {state.kind === 'expired' ? '시간이 지나 승인이 취소됐어요' : state.kind === 'inDoubt' ? '발급됐는지 확인하고 있어요' : '확인할 것이 있어요'}
          </T>
          <Actions>
            <Button kind="secondary" label="자세히" onPress={onDetail} testID="card-approve-detail" />
          </Actions>
        </>
      )}
      {asking && (
        <ConfirmSheet
          title="이 발급을 거절할까요?"
          body="거절하면 발급하지 않고 이 일을 멈춰요."
          yes="거절"
          no="돌아가기"
          onYes={() => {
            setAsking(false);
            void answer('deny');
          }}
          onNo={() => setAsking(false)}
        />
      )}
    </>
  );
}
