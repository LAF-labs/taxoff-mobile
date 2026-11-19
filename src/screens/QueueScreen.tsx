// 밀린 일(P-13, 홈 "지금 할 일" 줄에서): 상태별로 묶고, 줄마다 쉬운 말 한 줄과 동작 하나.
// 시작 확인이 있으면 바닥 주요 단추 [모두 시작]. 비었으면 "밀린 일이 없어요" + 마지막으로 끝난 일 한 줄.
// 줄 모양(iOS 알림 센터·목록 앱 기준): 첫 줄 일 이름 + 금액, 둘째 줄 회색 짧은 상태(문장 대신 "상태 · 이유" 낱말).
// 긴 이유는 줄을 눌러 진행 화면에서 본다. PC가 거절·중지해 이미 끝난 발급은 "발급 안 된 일" 묶음으로 따로 모으고,
// 묶음 머리 오른쪽 [모두 치우기] 하나로 지운다(줄마다 단추를 두지 않는다).
import { Pressable, StyleSheet, View } from 'react-native';
import { clock } from '../chat';
import { STEP_LABEL } from '../run';
import { REASON_LINE, STATE_LINE, STATE_NAME, actionFor, groupJobs, type Job, type JobAction, type JobState } from '../queue';
import type { RefuseReason } from '../run';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { radius, space, usePalette } from '../theme';
import { Button, Chevron, Empty, Group, Pill, Row, Screen, T, tap, won } from '../ui/kit';

const NB = ' ';
/** 둘째 줄의 짧은 이유(긴 문장은 진행 화면에 있다, phoneCmd REJECT_LINE) */
const REFUSE_SHORT: Record<RefuseReason, string> = {
  playbook_unavailable: 'PC 발급 절차 준비 전',
  input_invalid: 'PC가 내용을 받지 않음',
  counterparty_unknown: 'PC에 없는 거래처',
  duplicate: '이미 맡긴 일',
  pc_busy: 'PC가 다른 일 하는 중',
  hometax_paused: '홈택스 접속 쉬는 중',
  pc_old: 'PC 앱 업데이트 필요',
};

/** PC가 거절·중지해 끝난 폰 발급 명령(치울 수 있는 줄) */
const closed = (j: Job, state: JobState) => actionFor(j, state)?.key === 'dismiss';

export function QueueScreen({ onDone, onConnection, onOpen, now = Date.now() }: { onDone: () => void; onConnection: () => void; onOpen: (job: Job, action: JobAction) => void; now?: number }) {
  const s = useSession();
  const q = useQueue();
  const groups = groupJobs(q.jobs, now);
  const confirm = groups.find((g) => g.state === 'confirmStart');
  const pending = s.pending.receipts + s.pending.cash;
  const empty = groups.length === 0 && pending === 0;
  const p = usePalette();
  const done = groups.flatMap((g) => g.jobs.filter((j) => closed(j, g.state)).map((job) => ({ job, state: g.state })));
  const act = (j: Job, a: JobAction) => {
    if (a === 'cancel' || a === 'retry' || a === 'dismiss') return q.act(j.id, a);
    if (a === 'approve' && j.gate) return q.openSheet(j.id);
    q.setFocus(j.id);
    onOpen(j, a);
  };

  const footer = confirm ? (
    <Button testID="queue-start-all" label={`모두 시작${NB}·${NB}${confirm.jobs.length}건`} onPress={q.startAll} />
  ) : empty ? (
    <Button kind="secondary" label="대화로 돌아가기" onPress={onDone} />
  ) : undefined;

  return (
    <Screen title="밀린 일" onBack={onDone} testID="queue" scroll={!empty} footer={footer}>
      {empty ? (
        <Empty
          testID="queue-empty"
          title="밀린 일이 없어요"
          sub={q.last ? `마지막으로 끝난 일: ${q.last.title}${NB}·${NB}${clock(q.last.finishedAt).replace(' ', NB)}` : '맡긴 일은 PC가 다 했어요.'}
        />
      ) : (
        <>
          {groups.map((g) => {
            const open = g.jobs.filter((j) => !closed(j, g.state));
            if (!open.length) return null;
            return (
              <Group key={g.state} title={`${STATE_NAME[g.state]} · ${open.length}건`} testID={`queue-${g.state}`}>
                {open.map((j) => (
                  <JobRow key={j.id} job={j} state={g.state} onAction={(a) => act(j, a)} />
                ))}
              </Group>
            );
          })}
          {done.length > 0 && (
            <View style={{ gap: space.s2 }} testID="queue-closed">
              <View style={st.head}>
                <T v="label" c="ink3" style={{ flex: 1 }}>
                  {`발급 안 된 일 · ${done.length}건`}
                </T>
                <Pressable
                  testID="queue-dismiss-all"
                  accessibilityRole="button"
                  accessibilityLabel={`발급 안 된 일 ${done.length}건 모두 치우기`}
                  hitSlop={12}
                  onPress={() => {
                    tap();
                    for (const d of done) q.act(d.job.id, 'dismiss');
                  }}
                  style={({ pressed }) => [st.headBtn, { backgroundColor: pressed ? p.sunken : p.tint }]}
                >
                  <T v="label" c="ink2">
                    모두 치우기
                  </T>
                </Pressable>
              </View>
              <Group note="PC가 시작하지 않았거나 멈춘 일이에요. 아무것도 발급하지 않았어요. 눌러서 이유를 볼 수 있어요.">
                {done.map((d) => (
                  <JobRow key={d.job.id} job={d.job} state={d.state} onAction={(a) => act(d.job, a)} />
                ))}
              </Group>
            </View>
          )}
          {pending > 0 && (
            <Group title="아직 PC로 못 보낸 것" note="PC가 켜지면 저절로 보내요.">
              {s.pending.receipts > 0 && <Row label="사진" value={`${s.pending.receipts}장`} />}
              {s.pending.cash > 0 && <Row label="현금 매출" value={`${s.pending.cash}건`} />}
              <Row label="연결 상태 보기" onPress={onConnection} />
            </Group>
          )}
        </>
      )}
    </Screen>
  );
}

function JobRow({ job, state, onAction }: { job: Job; state: JobState; onAction: (a: JobAction) => void }) {
  const p = usePalette();
  const action = actionFor(job, state);
  const r = job.run;
  const isClosed = action?.key === 'dismiss';
  const line =
    r?.kind === 'refused'
      ? `시작 못 함 · ${REFUSE_SHORT[r.reason]}`
      : r?.kind === 'stopped'
        ? '중지됨 · 발급 안 됨'
        : state === 'needPc' && job.reason
          ? `${REASON_LINE[job.reason]} · PC에서 승인`
          : r?.kind === 'inDoubt'
            ? `확인 중 · 발급목록 조회 ${r.tries}회째`
            : r?.kind === 'myTurn'
              ? '내 차례 · 홈택스 로그인 확인'
              : state === 'running' && r?.kind === 'running'
                ? `진행 중 · ${STEP_LABEL[r.step]}`
                : STATE_LINE[state];
  // 줄 전체를 누르면 진행 화면(이유·결과). 줄 안 단추는 그 자리에서 끝나는 동작(취소·승인·다시 맡기기)만.
  const canOpen = !!r;
  const pill = action && !isClosed && action.key !== 'progress' && action.key !== 'result' ? action : null;
  const dim = state === 'expired' || isClosed;
  const body = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={st.line}>
          <T style={{ flex: 1 }} c={dim ? 'ink2' : 'ink'} lines={1}>
            {job.title}
          </T>
          {job.amount !== null && (
            <T
              v="value"
              c={dim ? 'ink3' : 'ink'}
              // 만료는 색만으로 말하지 않는다: 취소선 + 읽기 도구에는 "취소됨"
              style={[{ flexShrink: 0 }, state === 'expired' && { textDecorationLine: 'line-through' }]}
            >
              {won(job.amount)}
            </T>
          )}
        </View>
        <T v="meta" c={state === 'verify' ? 'attention' : 'ink3'} lines={1} testID={`job-${job.id}-line`}>
          {line}
        </T>
      </View>
      {pill && <Pill quiet={state === 'confirmStart'} testID={`job-${job.id}-${pill.key}`} label={pill.label} onPress={() => onAction(pill.key)} />}
      {canOpen && !pill && <Chevron color={p.ink4} />}
    </>
  );
  if (!canOpen || pill) return <View style={st.row} testID={`job-${job.id}`}>{body}</View>;
  return (
    <Pressable
      testID={`job-${job.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${job.title}, ${line}`}
      accessibilityHint="누르면 진행 화면을 열어요"
      onPress={() => onAction(state === 'done' ? 'result' : 'progress')}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: p.sunken }]}
    >
      {body}
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s3, minHeight: 64 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space.s3 },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.s1, gap: space.s2 },
  headBtn: { borderRadius: radius.full, paddingHorizontal: space.s3, minHeight: 28, justifyContent: 'center' },
});
