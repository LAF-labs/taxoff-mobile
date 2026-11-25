import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { REJECT_LINE } from '../phoneCmd';
import type { Job } from '../queue';
import { ACTION_LABEL, AUTH_APPS, STEPS, STEP_LABEL, STOP_COPY, actionsOf, chipOf, elapsed, groupApprovalNo, mmss, pcTurnOf, stepOf, type IssueResult, type RunAction, type RunView } from '../run';
import { space, usePalette } from '../theme';
import { Actions, Card, Kv, KvRow, type CardKind } from '../ui/card';
import { Button, Check, Chevron, StatusDot, T, success, won } from '../ui/kit';
import { CardApprove } from './CardApprove';
import { UnlockInline } from './UnlockHost';


const pcTurn = (r: RunView) => r.kind === 'myTurn' && (r.auth.method === 'pc' || (r.auth.method === 'simple' && !!r.auth.pc));

export function actionLabel(a: RunAction, r: RunView): string {
  if (a === 'openApp' && r.kind === 'myTurn' && r.auth.method === 'simple') return `${r.auth.app} 열기`;
  return ACTION_LABEL[a];
}

export function openAuthApp(r: RunView) {
  if (r.kind !== 'myTurn' || r.auth.method !== 'simple') return;
  const url = AUTH_APPS[r.auth.app];
  if (url) Linking.openURL(url).catch(() => {});
}

export function useNow(fixed?: number, on = true): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined || !on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixed, on]);
  return fixed ?? now;
}

/** 대화와 진행 화면의 발급 카드. 겉모양은 공용 Card(src/ui/card.tsx)이고, 상태는 제목 앞 아이콘으로만 나눈다. */
export function RunCard({ job, now: fixedNow, compact, onOpen, onAction, onApprove }: {
  job: Job;
  now?: number;
  compact?: boolean;
  onOpen?: () => void;
  onAction?: (a: RunAction) => void;
  onApprove?: () => void;
}) {
  const r = job.run;
  const ticking = !!r && (r.kind === 'running' || r.kind === 'myTurn' || r.kind === 'inDoubt');
  const now = useNow(fixedNow, ticking);
  if (!r) return null;
  const chip = chipOf(r);
  const approving = !!onApprove && !!job.gate && job.state === 'approval';
  const kind: CardKind = r.kind === 'done' ? 'done' : r.kind === 'refused' || r.kind === 'stopped' ? 'failed' : chip.tone === 'attention' ? 'check' : 'doc';
  const tone = approving ? 'wait' : chip.tone === 'attention' ? 'attention' : 'quiet';
  return (
    <Card kind={kind} tone={tone} title={job.title} testID={`run-${job.id}`}>
      {r.kind === 'done' ? (
        <ResultRows result={r.result} full={!compact} />
      ) : approving ? (
        <CardApprove job={job} gate={job.gate!} onDetail={onApprove!} now={fixedNow} />
      ) : (
        <>
          {job.amount !== null && (
            <Kv>
              <KvRow label="합계" value={won(job.amount)} total />
            </Kv>
          )}
          <View style={st.chipLine}>
            <StatusDot tone={chip.tone} label={chip.label} busy={chip.busy} v="sub" />
            {ticking &&
              (r.kind === 'myTurn' && r.auth.method === 'simple' && r.auth.deadline !== undefined ? (
                <T v="sub" c="attention" testID="run-left" style={{ fontVariant: ['tabular-nums'] }}>
                  {r.auth.deadline > now ? `${mmss(r.auth.deadline - now)} 남았어요` : '시간이 지났어요'}
                </T>
              ) : compact ? null : (
                <T v="sub" c="ink3" testID="run-elapsed">
                  {elapsed(now - r.startedAt)}
                </T>
              ))}
          </View>
          {r.kind !== 'refused' && !(r.kind === 'stopped' && (r.reason === 'pcStopped' || r.reason === 'appOld')) && (compact ? <FoldSteps id={job.id} r={r} /> : <StepBar r={r} />)}
          <StateLines r={r} />
          <UnlockInline job={job} />
        </>
      )}
      {compact && (!job.pcOnly || pcTurn(r) || r.kind === 'done') && <CardActions r={r} now={now} onAction={onAction} onOpen={onOpen} />}
    </Card>
  );
}

const opened = new Set<string>();
function FoldSteps({ id, r }: { id: string; r: RunView }) {
  const p = usePalette();
  const [open, setOpen] = useState(() => opened.has(id));
  const cur = STEPS.indexOf(stepOf(r));
  const toggle = () => {
    const next = !open;
    if (next) opened.add(id);
    else opened.delete(id);
    setOpen(next);
  };
  return (
    <View style={{ gap: space.s2 }}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${STEPS.length}단계 중 ${cur + 1}단계, ${STEP_LABEL[STEPS[cur]!]}. ${open ? '단계 접기' : '단계 보기'}`}
        style={({ pressed }) => [st.foldRow, pressed && { opacity: 0.6 }]}
        testID="run-steps-toggle"
      >
        <T v="sub" c="ink2" lines={1} style={{ flex: 1 }}>
          {cur + 1}/{STEPS.length} <T v="subStrong">{STEP_LABEL[STEPS[cur]!]}</T>
        </T>
        <T v="meta" c="ink3">
          {open ? '접기' : '단계 보기'}
        </T>
        <View style={{ marginTop: open ? 4 : -4 }}>
          <Chevron color={p.ink3} dir={open ? 'up' : 'down'} sizePx={7} />
        </View>
      </Pressable>
      {open && (
        <View style={st.stepList} testID="run-step-list">
          {STEPS.map((x, i) => (
            <View key={x} style={st.stepItem}>
              <View style={[st.stepDot, { backgroundColor: i < cur ? p.ink3 : i === cur ? p.ink : p.ink4 }]} />
              <T v={i === cur ? 'subStrong' : 'sub'} c={i <= cur ? 'ink' : 'ink3'}>
                {STEP_LABEL[x]}
              </T>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StepBar({ r }: { r: RunView }) {
  const p = usePalette();
  const cur = STEPS.indexOf(stepOf(r));
  return (
    <View style={{ gap: space.s1 }} accessible accessibilityLabel={`${STEPS.length}단계 중 ${cur + 1}단계, ${STEP_LABEL[STEPS[cur]!]}`} testID="run-steps">
      <View style={st.bar}>
        {STEPS.map((s, i) => (
          <View key={s} style={[st.seg, i === cur && st.segCur, { backgroundColor: i < cur ? p.ink3 : i === cur ? p.ink : p.sunken }]} />
        ))}
      </View>
      <T v="sub" c="ink2" lines={1}>
        <T v="subStrong">{STEP_LABEL[STEPS[cur]!]}</T> {cur + 1}/{STEPS.length}
      </T>
    </View>
  );
}

function StateLines({ r }: { r: RunView }) {
  const p = usePalette();
  switch (r.kind) {
    case 'running':
      return r.pcApproval && r.step === 'approve' ? (
        <T v="sub" c="attention" testID="run-pc-approve">
          PC가 승인을 기다리고 있어요
        </T>
      ) : null;
    case 'refused':
      return (
        <T v="sub" c="ink2" testID={`run-refused-${r.reason}`}>
          {REJECT_LINE[r.reason]}
        </T>
      );
    case 'myTurn':
      return (
        <T v="sub" c="attention" testID="run-my-turn">
          {r.auth.method === 'simple' ? `${r.auth.app} 앱에서 승인해 주세요` : r.auth.method === 'pc' ? pcTurnOf(r.auth.code).line : '인증서 비밀번호가 필요해요'}
        </T>
      );
    case 'stopped':
      return (
        <View style={{ gap: space.s1 }}>
          <T v="sub" c="ink2" testID={`run-stop-${r.reason}`}>
            {STOP_COPY[r.reason].line}
          </T>
          {r.reserved && (
            <View style={st.doneChip}>
              <Check color={p.ink3} />
              <T v="meta" c="ink3">
                PC에서 열기를 예약했어요
              </T>
            </View>
          )}
        </View>
      );
    case 'inDoubt':
      return (
        <View style={{ gap: space.s1 }} testID="run-in-doubt">
          <T v="sub" c="attention">
            발급목록을 {r.tries}번째 조회하고 있어요
          </T>
          <T v="meta" c="ink2">
            발급됐는지 확인되기 전에는 다시 발급하지 않아요
          </T>
        </View>
      );
    case 'verify':
      return (
        <View style={{ gap: space.s1 }} testID="run-verify">
          <T v="sub" c="attention">
            홈택스에서 직접 확인해 주세요
          </T>
          <T v="meta" c="ink2">
            발급목록 조회로 확인하지 못했어요. 확인되기 전에는 다시 발급하지 않아요
          </T>
        </View>
      );
    default:
      return null;
  }
}

function ResultRows({ result, full }: { result: IssueResult; full: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(result.approvalNo).catch(() => {});
    success();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const d = new Date(result.issuedAt);
  return (
    <Kv>
      <KvRow label="작성일" value={`${d.getMonth() + 1}월 ${d.getDate()}일`} />
      {full && (
        <KvRow label="승인번호">
          <Pressable onLongPress={() => void copy()} accessibilityRole="button" accessibilityLabel={`승인번호 ${result.approvalNo}`} accessibilityHint="길게 누르면 복사해요" testID="result-approval-no">
            <T v="subValue" style={{ textAlign: 'right' }}>
              {copied ? '복사했어요' : groupApprovalNo(result.approvalNo)}
            </T>
          </Pressable>
        </KvRow>
      )}
      {full && <KvRow label="거래처" value={result.counterpart} />}
      {result.emailSent !== undefined && (
        <KvRow label="받는 이메일" testID="result-email">
          {full && result.email ? <EmailText value={result.email} /> : <T v="subValue" c={result.emailSent ? 'ink' : 'ink3'}>{result.emailSent ? '보냈어요' : '보내지 않았어요'}</T>}
        </KvRow>
      )}
      <KvRow label="합계" value={won(result.total)} total />
    </Kv>
  );
}

function EmailText({ value }: { value: string }) {
  const at = value.lastIndexOf('@');
  const parts = at > 0 ? [value.slice(0, at), value.slice(at)] : [value];
  return (
    <View style={st.email} accessible accessibilityLabel={value}>
      {parts.map((part, gi) => (
        <View key={gi} style={st.emailGroup}>
          {part
            .split(/(?<=\.)/)
            .filter(Boolean)
            .map((x, i) => (
              <T key={i} v="meta" c="ink3" lines={1} style={st.nowrap}>
                {x}
              </T>
            ))}
        </View>
      ))}
    </View>
  );
}

function CardActions({ r, now, onAction, onOpen }: { r: RunView; now: number; onAction?: (a: RunAction) => void; onOpen?: () => void }) {
  if (r.kind === 'done') {
    return onOpen ? (
      <Actions>
        <Button kind="secondary" label="자세히" onPress={onOpen} testID="result-detail" />
      </Actions>
    ) : null;
  }
  const acts = actionsOf(r, now).filter((a) => a !== 'close');
  if (!acts.length) return null;
  return (
    <Actions>
      {acts.map((a, i) => (
        <Button key={a} kind={i === 0 ? 'primary' : 'secondary'} label={actionLabel(a, r)} onPress={() => (a === 'openApp' ? openAuthApp(r) : onAction?.(a))} testID={`run-action-${a}`} />
      ))}
    </Actions>
  );
}

const st = StyleSheet.create({
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  chipLine: { flexDirection: 'row', alignItems: 'center', gap: space.s3, flexWrap: 'wrap' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: space.s1 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  segCur: { height: 6, borderRadius: 3 },
  nowrap: { flexShrink: 0, ...({ whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal' } as object) },
  email: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' },
  emailGroup: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' },
  foldRow: { flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 32 },
  stepList: { gap: space.s2, paddingLeft: 2 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  stepDot: { width: 6, height: 6, borderRadius: 3 },
});
