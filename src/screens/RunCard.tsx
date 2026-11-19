// 진행 카드·결과 카드(P-04, 기획 v2 PR 6). 대화 안 카드(compact)와 진행 화면(RunScreen)이 같은 부품을 쓴다.
// - 머리: 일 이름 + 합계, 상태 칩(점 + 글자) · 경과 시간
// - 단계 줄: 준비 → 홈택스 로그인 → 값 확인 → 승인 → 발급 → 확인, 지금 단계만 ink 600
// - 상태 한 줄(08 §11 표를 폰 길이로). 결과 모름·확인 필요에는 다시 발급하는 단추가 없다.
// - 결과: 승인번호(4자리씩, 길게 누르면 원문 복사) · 거래처 · 합계 · 받는 이메일로 보냄 여부, [서류 보기] [공유]
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { REJECT_LINE } from '../phoneCmd';
import type { Job } from '../queue';
import { ACTION_LABEL, AUTH_APPS, STEPS, STEP_LABEL, STOP_COPY, actionsOf, chipOf, elapsed, groupApprovalNo, mmss, pcTurnOf, stepOf, type IssueResult, type RunAction, type RunView } from '../run';
import { radius, space, usePalette } from '../theme';
import { Check, Chevron, Pill, StatusDot, T, success, won } from '../ui/kit';
import { CardApprove, GateLeft } from './CardApprove';


/** PC가 맡은 일의 로그인 차례(폰에서 할 수 있는 일이 있다) */
const pcTurn = (r: RunView) => r.kind === 'myTurn' && (r.auth.method === 'pc' || (r.auth.method === 'simple' && !!r.auth.pc));

export function actionLabel(a: RunAction, r: RunView): string {
  if (a === 'openApp' && r.kind === 'myTurn' && r.auth.method === 'simple') return `${r.auth.app} 열기`;
  return ACTION_LABEL[a];
}

/** 간편인증 앱 열기(이름을 아는 앱만). 열 수 없으면 조용히 넘긴다: 그 앱을 직접 열면 된다. */
export function openAuthApp(r: RunView) {
  if (r.kind !== 'myTurn' || r.auth.method !== 'simple') return;
  const url = AUTH_APPS[r.auth.app];
  if (url) Linking.openURL(url).catch(() => {});
}

/** 1초마다 흐르는 시계. fixed가 있으면(갤러리) 멈춘다. */
export function useNow(fixed?: number, on = true): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined || !on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixed, on]);
  return fixed ?? now;
}

export function RunCard({ job, now: fixedNow, compact, onOpen, onAction, onDoc, onShare, onApprove }: {
  job: Job;
  /** 갤러리: 시계를 멈춘다 */
  now?: number;
  /** 대화 안 카드: 단추는 작게, 닫기는 두지 않는다. 누르면 진행 화면 */
  compact?: boolean;
  onOpen?: () => void;
  onAction?: (a: RunAction) => void;
  onDoc?: () => void;
  onShare?: () => void;
  /** 이 폰으로 승인할 요청이 열려 있을 때: 카드에서 바로 승인, [자세히 보기]면 승인 시트 */
  onApprove?: () => void;
}) {
  const p = usePalette();
  const r = job.run;
  const ticking = !!r && (r.kind === 'running' || r.kind === 'myTurn' || r.kind === 'inDoubt');
  const now = useNow(fixedNow, ticking);
  if (!r) return null;
  const chip = chipOf(r);
  const body = (
    <View style={[st.card, { backgroundColor: p.tint }]} testID={`run-${job.id}`}>
      <View style={st.head}>
        <T v="subStrong" style={{ flex: 1 }}>
          {job.title}
        </T>
        {job.amount !== null && (
          <T v="figure" lines={1} style={st.nowrap}>
            {won(job.amount)}
          </T>
        )}
      </View>
      <View style={st.chipLine}>
        {r.kind === 'done' ? (
          <View style={st.doneChip} accessible accessibilityLabel="발급됨">
            <Check color={p.ink} />
            <T v="label">발급됨</T>
          </View>
        ) : (
          <StatusDot tone={chip.tone} label={chip.label} busy={chip.busy} v="label" />
        )}
        {ticking &&
          (r.kind === 'myTurn' && r.auth.method === 'simple' && r.auth.deadline !== undefined ? (
            r.auth.deadline > now ? (
              <T v="meta" c="attention" testID="run-left" style={{ fontVariant: ['tabular-nums'] }}>
                {mmss(r.auth.deadline - now)} 남았어요
              </T>
            ) : (
              <T v="meta" c="attention" testID="run-left">
                시간이 지났어요
              </T>
            )
          ) : (
            <T v="meta" c="ink3" testID="run-elapsed">
              {elapsed(now - r.startedAt)}
            </T>
          ))}
        {onApprove && job.gate && job.state === 'approval' && <GateLeft gate={job.gate} now={now} />}
      </View>
      {/* 이유 없는 PC 멈춤은 어느 단계였는지 모르니 단계 막대를 두지 않는다 */}
      {r.kind !== 'done' && r.kind !== 'refused' && !(r.kind === 'stopped' && (r.reason === 'pcStopped' || r.reason === 'appOld')) && (compact ? <FoldSteps id={job.id} r={r} /> : <StepBar r={r} />)}
      <StateLines r={r} />
      {onApprove && job.gate && job.state === 'approval' && <CardApprove job={job} gate={job.gate} onDetail={onApprove} now={fixedNow} leftInside={false} />}
      {r.kind === 'done' && <ResultRows result={r.result} />}
      {/* 폰 발급 명령은 지켜보기만 한다. 로그인 차례(간편인증·인증서로 다시·승인했어요)만 대화 카드에서 바로 한다 */}
      {compact && (!job.pcOnly || pcTurn(r)) && <CardActions r={r} now={now} onAction={onAction} onDoc={onDoc} onShare={onShare} />}
    </View>
  );
  if (!compact || !onOpen) return body;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${job.title} ${chip.label}. 자세히 보기`} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {body}
    </Pressable>
  );
}

/**
 * 대화 안 카드의 단계(11-19): 닫힌 채로 시작하고 사용자가 연 카드만 기억한다.
 * 닫힌 것을 기억하지 않는 까닭: 나중에 온 카드가 "닫힘 목록"에 없어 한 번 펼쳐 그려졌다가 닫히며 화면이 튄다
 * (Happy docs/chat-list-scrolling.md "Collapsed-by-default"). 연 것은 이 앱이 켜져 있는 동안 기억한다.
 */
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

/**
 * 단계: 얇은 6칸 막대(지난 칸 ink3, 지금 칸 ink로 조금 두껍게, 남은 칸 sunken) + 아래 한 줄 "홈택스 로그인 2/6".
 * 파랑은 PC 켜짐·승인 단추에만 쓰므로 지금 칸은 ink와 두께로 강조한다. 어느 폭에서도 한 줄이다.
 */
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
      // 폰 발급 명령(pc_only): 승인은 PC 승인 바에서
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
            발급목록을 조회하고 있어요 · {r.tries}회째
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

/** 결과 줄. 승인번호는 4자리씩 띄워 보이고, 길게 누르면 원문을 복사한다. */
export function ResultRows({ result }: { result: IssueResult }) {
  const p = usePalette();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(result.approvalNo).catch(() => {});
    success();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View style={[st.rows, { borderTopColor: p.line }]}>
      {/* 승인번호는 라벨 옆에 다 들어가지 않아 라벨 아래 한 줄로(숫자 사이에서 끊지 않는다) */}
      <Pressable onLongPress={() => void copy()} accessibilityRole="button" accessibilityLabel={`승인번호 ${result.approvalNo}`} accessibilityHint="길게 누르면 복사해요" style={st.stack} testID="result-approval-no">
        <View style={st.stackHead}>
          <T v="sub" c="ink2">
            승인번호
          </T>
          <T v="meta" c="ink3">
            {copied ? '복사했어요' : '길게 누르면 복사'}
          </T>
        </View>
        <T v="value" style={st.mono}>
          {groupApprovalNo(result.approvalNo)}
        </T>
      </Pressable>
      <View style={st.row}>
        <T v="sub" c="ink2" style={st.label}>
          거래처
        </T>
        <T style={st.value}>{result.counterpart}</T>
      </View>
      <View style={st.row}>
        <T v="sub" c="ink2" style={st.label}>
          합계
        </T>
        <T v="figure" lines={1} style={[st.value, st.nowrap]}>
          {won(result.total)}
        </T>
      </View>
      <View style={st.row} testID="result-email">
        <T v="sub" c="ink2" style={st.label}>
          받는 이메일
        </T>
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
          <T v="sub" c={result.emailSent ? 'ink' : 'ink3'}>
            {result.emailSent ? '보냈어요' : '보내지 않았어요'}
          </T>
          {result.email && <EmailText value={result.email} />}
        </View>
      </View>
    </View>
  );
}

/** 이메일: 넘칠 때 @ 앞에서만, 그래도 넘치면 점 뒤에서만 줄을 바꾼다(승인 시트와 같은 규칙). */
export function EmailText({ value }: { value: string }) {
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

/** 대화 카드 안 단추: 기본 행동은 바탕색 알약(tint 카드 위), 나머지는 글자만. 화면의 주요 단추는 입력 줄 [보내기]다. 닫기는 두지 않는다. */
function CardActions({ r, now, onAction, onDoc, onShare }: { r: RunView; now: number; onAction?: (a: RunAction) => void; onDoc?: () => void; onShare?: () => void }) {
  if (r.kind === 'done') {
    return (
      <View style={st.actions}>
        <Pill label="서류 보기" onPress={() => onDoc?.()} testID="result-doc" />
        <Pill quiet label="공유" onPress={() => onShare?.()} testID="result-share" />
      </View>
    );
  }
  const acts = actionsOf(r, now).filter((a) => a !== 'close');
  if (!acts.length) return null;
  return (
    <View style={st.actions}>
      {acts.map((a, i) => (
        <Pill key={a} quiet={i > 0} label={actionLabel(a, r)} onPress={() => (a === 'openApp' ? openAuthApp(r) : onAction?.(a))} testID={`run-action-${a}`} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  approve: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  card: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.s3 },
  chipLine: { flexDirection: 'row', alignItems: 'center', gap: space.s3, flexWrap: 'wrap' },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: space.s1 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  segCur: { height: 6, borderRadius: 3 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.s1, paddingTop: space.s1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingVertical: space.s2, minHeight: 44 },
  label: { width: 84, flexShrink: 0, paddingTop: 2 },
  value: { flex: 1, minWidth: 0, textAlign: 'right' },
  stack: { paddingVertical: space.s2, gap: space.s1, minHeight: 44 },
  stackHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s3 },
  mono: { textAlign: 'right', fontVariant: ['tabular-nums'], letterSpacing: 0.5, ...({ whiteSpace: 'nowrap' } as object) },
  nowrap: { flexShrink: 0, ...({ whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal' } as object) },
  email: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' },
  emailGroup: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' },
  foldRow: { flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 32 },
  stepList: { gap: space.s2, paddingLeft: 2 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  stepDot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2, marginTop: space.s1 },
});
