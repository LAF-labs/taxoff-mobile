import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { APPROVE_CTX, approveMessage, readGate, sheetState, showValue, type PhoneGate } from '../approval';
import type { Job } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { Button, ConfirmSheet, T, success } from '../ui/kit';
import { approvalKeyFor } from './ApprovalHost';

const ROWS: ReadonlyArray<{ key: string; label: string; strong?: boolean }> = [
  { key: 'counterpartName', label: '받는 곳' },
  { key: 'supplyAmount', label: '공급가액' },
  { key: 'taxAmount', label: '세액' },
  { key: 'totalAmount', label: '합계', strong: true },
];

export function CardApprove({ job, gate, onDetail, now: fixedNow }: { job: Job; gate: PhoneGate; onDetail: () => void; now?: number }) {
  const q = useQueue();
  const s = useSession();
  const p = usePalette();
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
      const signed = await key.sign(APPROVE_CTX, approveMessage(s.data.pair?.pairId ?? '', gate.reqId, gate.challenge, gate.actionHash, decision));
      if (!signed) return;
      if (decision === 'approve') success();
      q.decide(job.id, decision, { reqId: gate.reqId, actionHash: gate.actionHash, sig: signed.sig });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={st.wrap} testID={`card-approve-${job.id}`}>
      <View style={[st.rows, { borderColor: p.line }]}>
        {ROWS.map((x) =>
          r.values[x.key] !== undefined ? (
            <View key={x.key} style={st.row}>
              <T v="sub" c="ink2">
                {x.label}
              </T>
              <T v={x.strong ? 'subStrong' : 'sub'} style={st.value} lines={1}>
                {showValue(x.key, r.values[x.key]!)}
              </T>
            </View>
          ) : null,
        )}
      </View>
      {direct ? (
        <>
          <View style={st.buttons}>
            <Button kind="secondary" small label="거절" onPress={() => setAsking(true)} disabled={busy} style={{ flex: 1 }} testID="card-deny" />
            <Button
              kind="approve"
              small
              label="승인하고 발급"
              hint="얼굴이나 지문으로 확인한 뒤 홈택스에서 바로 발급해요"
              onPress={() => void answer('approve')}
              busy={busy}
              disabled={!state.armed}
              style={{ flex: 2 }}
              testID="card-approve"
            />
          </View>
        </>
      ) : (
        <View style={st.buttons}>
          <T v="sub" c="ink2" style={{ flex: 1 }}>
            {state.kind === 'expired' ? '시간이 지나 승인이 취소됐어요' : state.kind === 'inDoubt' ? '발급됐는지 확인하고 있어요' : '확인할 것이 있어요'}
          </T>
          <Button kind="secondary" small label="자세히 보기" onPress={onDetail} testID="card-approve-detail" />
        </View>
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
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: space.s3, paddingTop: space.s1 },
  rows: { gap: space.s1, paddingTop: space.s2, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 28 },
  value: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
});
