// 밀린 일(P-13, 홈 "지금 할 일" 줄에서): 상태별로 묶고, 줄마다 쉬운 말 한 줄과 동작 하나.
// 시작 확인이 있으면 바닥 주요 단추 [모두 시작]. 비었으면 "밀린 일이 없어요" + 마지막으로 끝난 일 한 줄.
import { StyleSheet, View } from 'react-native';
import { clock } from '../chat';
import { STEP_LABEL } from '../run';
import { REASON_LINE, STATE_ACTION, STATE_LINE, STATE_NAME, groupJobs, type Job, type JobAction, type JobState } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { space } from '../theme';
import { Button, Empty, Group, Pill, Row, Screen, T, won } from '../ui/kit';

const NB = ' ';
const TONE: Partial<Record<JobState, 'attention'>> = { needPc: 'attention', verify: 'attention' };

export function QueueScreen({ onDone, onConnection, onOpen, now = Date.now() }: { onDone: () => void; onConnection: () => void; onOpen: (job: Job, action: JobAction) => void; now?: number }) {
  const s = useSession();
  const q = useQueue();
  const groups = groupJobs(q.jobs, now);
  const confirm = groups.find((g) => g.state === 'confirmStart');
  const pending = s.pending.receipts + s.pending.cash;
  const empty = groups.length === 0 && pending === 0;

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
          {groups.map((g) => (
            <Group key={g.state} title={`${STATE_NAME[g.state]} · ${g.jobs.length}건`} testID={`queue-${g.state}`}>
              {g.jobs.map((j) => (
                <JobRow key={j.id} job={j} state={g.state} onAction={(a) => {
                    if (a === 'cancel' || a === 'retry') return q.act(j.id, a);
                    if (a === 'approve' && j.gate) return q.openSheet(j.id);
                    q.setFocus(j.id);
                    onOpen(j, a);
                  }} />
              ))}
            </Group>
          ))}
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
  const action = STATE_ACTION[state];
  const r = job.run;
  const line =
    state === 'needPc' && job.reason
      ? `${REASON_LINE[job.reason]} · PC에서 해 주세요`
      : r?.kind === 'inDoubt'
        ? `확인 중 · 발급목록 조회 ${r.tries}회째`
        : r?.kind === 'myTurn'
          ? '내 차례 · 폰이나 PC에서 확인해 주세요'
          : r?.kind === 'stopped'
            ? '중지됨 · 아무것도 발급하지 않았어요'
            : state === 'running' && r?.kind === 'running'
              ? `${STATE_LINE[state]} · ${STEP_LABEL[r.step]}`
              : STATE_LINE[state];
  const tone = TONE[state];
  return (
    <View style={st.row} testID={`job-${job.id}`}>
      <View style={st.line}>
        <T style={{ flex: 1 }}>{job.title}</T>
        {job.amount !== null && (
          <T
            v="value"
            c={state === 'expired' ? 'ink3' : 'ink'}
            // 만료는 색만으로 말하지 않는다: 취소선 + 읽기 도구에는 "취소됨"
            style={[{ flexShrink: 0 }, state === 'expired' && { textDecorationLine: 'line-through' }]}
          >
            {won(job.amount)}
          </T>
        )}
      </View>
      <View style={st.line}>
        <T v="sub" c={tone ?? (state === 'expired' ? 'ink3' : 'ink2')} style={{ flex: 1 }}>
          {line}
        </T>
        {action && <Pill quiet={state === 'confirmStart'} testID={`job-${job.id}-${action.key}`} label={action.label} onPress={() => onAction(action.key)} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s1, minHeight: 64, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
