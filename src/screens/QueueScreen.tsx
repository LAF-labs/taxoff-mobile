// 밀린 일(P-13, 홈 "지금 할 일" 줄에서). 레퍼런스: iOS 알림 센터(알림마다 카드 하나, 옆으로 밀어 지우기, 묶음 머리 [지우기]).
// - 일마다 카드 하나(tint 면, 둥근 모서리, 카드 사이 여백). 첫 줄 거래처 + 금액, 둘째 줄 지금 상태 한 문장.
// - 상태 문장은 짧은 말로("중지됐어요", "PC가 다른 일 중이었어요"). 가운데점으로 낱말을 잇지 않는다. 긴 이유는 카드를 눌러 진행 화면에서.
// - 할 일이 있는 카드만 단추 하나(승인하기 · 취소 · 다시 맡기기). PC가 거절하거나 멈춰 끝난 일은 "발급 안 된 일"에 모으고,
//   카드를 좌우로 밀어 치우거나 머리의 [모두 치우기]로 한 번에 치운다.
// - 시작 확인이 있으면 바닥 주요 단추 [모두 시작]. 비었으면 "밀린 일이 없어요".
import { Pressable, StyleSheet, View } from 'react-native';
import { clock } from '../chat';
import { pcTurnOf, type RefuseReason, type RunView, type Step } from '../run';
import { actionFor, groupJobs, type Job, type JobAction, type JobState, type NeedPcReason } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { radius, space, usePalette } from '../theme';
import { Button, Empty, Group, Row, Screen, T, tap, won } from '../ui/kit';
import { SwipeAway } from '../ui/SwipeAway';

const NB = ' ';

/** 묶음 이름(사장님 쪽에서 본 말) */
const SECTION: Record<JobState, string> = {
  confirmStart: '시작할 일',
  approval: '승인할 일',
  needPc: 'PC에서 할 일',
  verify: '확인할 일',
  running: '하고 있는 일',
  entrusted: 'PC가 켜지면 할 일',
  phoneWaiting: '기다리는 일',
  expired: '취소된 일',
  done: '끝난 일',
};

const REFUSED: Record<RefuseReason, string> = {
  playbook_unavailable: 'PC가 아직 발급 준비가 안 됐어요',
  input_invalid: '내용을 다시 확인해 주세요',
  counterparty_unknown: 'PC에 없는 거래처예요',
  duplicate: '이미 맡긴 일이에요',
  pc_busy: 'PC가 다른 일 중이었어요',
  hometax_paused: '홈택스가 잠시 쉬고 있어요',
  pc_old: 'PC 앱을 업데이트해 주세요',
};

const RUNNING: Record<Step, string> = {
  prepare: '준비하고 있어요',
  login: '홈택스에 로그인하고 있어요',
  readback: '값을 맞춰 보고 있어요',
  approve: '승인을 기다리고 있어요',
  issue: '발급하고 있어요',
  verify: '발급됐는지 보고 있어요',
};

const NEED_PC: Record<NeedPcReason, string> = {
  firstCounterparty: '처음 거래하는 곳은 PC에서 승인해요',
  dailyLimit: '오늘 폰 승인을 다 썼어요. PC에서 승인해요',
  notApprover: '이 폰은 아직 승인 기기가 아니에요',
};

const PLAIN: Record<JobState, string> = {
  entrusted: 'PC가 켜지면 시작해요',
  phoneWaiting: '앞의 일이 끝나면 이어서 해요',
  confirmStart: '시작하면 PC가 바로 해요',
  running: 'PC가 홈택스에서 하고 있어요',
  approval: '승인하면 바로 발급해요',
  needPc: 'PC 앞에서 해 주세요',
  verify: '홈택스에서 발급됐는지 확인해 주세요',
  expired: '3일이 지나 취소됐어요',
  done: '발급했어요',
};

/** 카드 둘째 줄: 지금 상태 한 문장 */
export function statusLine(job: Job, state: JobState): string {
  const r: RunView | undefined = job.run;
  if (job.wait === 'pcBusy') return '다른 일이 끝나면 할게요';
  if (job.wait === 'newDay' && job.waitDay) return `${Number(job.waitDay.slice(5, 7))}월 ${Number(job.waitDay.slice(8, 10))}일로 맡긴 일이에요. 오늘 날짜로 바꿔야 발급할 수 있어요`;
  if (r?.kind === 'refused') return REFUSED[r.reason];
  if (r?.kind === 'stopped') return '중지됐어요';
  if (state === 'needPc' && job.reason) return NEED_PC[job.reason];
  if (r?.kind === 'myTurn') return r.auth.method === 'cert' ? 'PC에서 인증서로 로그인해 주세요' : r.auth.method === 'pc' ? pcTurnOf(r.auth.code).short : '간편인증을 승인해 주세요';
  if (r?.kind === 'inDoubt') return '발급됐는지 보고 있어요';
  if (state === 'running' && r?.kind === 'running') return RUNNING[r.step];
  return PLAIN[state];
}

/** PC가 거절·중지해 끝난 폰 발급 명령(치울 수 있는 카드) */
const closed = (j: Job, state: JobState) => actionFor(j, state)?.key === 'dismiss';

export function QueueScreen({ onDone, onConnection, onOpen, now = Date.now() }: { onDone: () => void; onConnection: () => void; onOpen: (job: Job, action: JobAction) => void; now?: number }) {
  const s = useSession();
  const q = useQueue();
  const p = usePalette();
  const groups = groupJobs(q.jobs, now);
  const confirm = groups.find((g) => g.state === 'confirmStart');
  const pending = s.pending.receipts + s.pending.cash;
  const empty = groups.length === 0 && pending === 0;
  const done = groups.flatMap((g) => g.jobs.filter((j) => closed(j, g.state)).map((job) => ({ job, state: g.state })));
  const act = (j: Job, a: JobAction) => {
    if (a === 'cancel' || a === 'retry' || a === 'dismiss' || a === 'redate') return q.act(j.id, a);
    if (a === 'approve' && j.gate) return q.openSheet(j.id);
    q.setFocus(j.id);
    onOpen(j, a);
  };

  const footer = confirm ? (
    <Button testID="queue-start-all" label={`${confirm.jobs.length}건 모두 시작`} onPress={q.startAll} />
  ) : empty ? (
    <Button kind="secondary" label="대화로 돌아가기" onPress={onDone} />
  ) : undefined;

  return (
    <Screen title="밀린 일" onBack={onDone} testID="queue" scroll={!empty} footer={footer}>
      {empty ? (
        <Empty
          testID="queue-empty"
          title="밀린 일이 없어요"
          sub={q.last ? `마지막으로 끝난 일은 ${q.last.title}예요. ${clock(q.last.finishedAt).replace(' ', NB)}에 끝났어요.` : '맡긴 일은 PC가 다 했어요.'}
        />
      ) : (
        <>
          {groups.map((g) => {
            const open = g.jobs.filter((j) => !closed(j, g.state));
            if (!open.length) return null;
            return (
              <Section key={g.state} title={`${SECTION[g.state]} ${open.length}건`} testID={`queue-${g.state}`}>
                {open.map((j) => (
                  <JobCard key={j.id} job={j} state={g.state} onAction={(a) => act(j, a)} />
                ))}
              </Section>
            );
          })}
          {done.length > 0 && (
            <Section
              testID="queue-closed"
              title={`발급 안 된 일 ${done.length}건`}
              note="아무것도 발급하지 않았어요. 옆으로 밀면 치워져요."
              right={
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
              }
            >
              {done.map((d) => (
                <SwipeAway key={d.job.id} label={d.job.title} onDismiss={() => q.act(d.job.id, 'dismiss')} testID={`swipe-${d.job.id}`}>
                  <JobCard job={d.job} state={d.state} onAction={(a) => act(d.job, a)} />
                </SwipeAway>
              ))}
            </Section>
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

function Section({ title, note, right, children, testID }: { title: string; note?: string; right?: React.ReactNode; children: React.ReactNode; testID?: string }) {
  return (
    <View style={{ gap: space.s2 }} testID={testID}>
      <View style={st.head}>
        <T v="label" c="ink3" style={{ flex: 1 }}>
          {title}
        </T>
        {right}
      </View>
      <View style={{ gap: space.s2 }}>{children}</View>
      {note && (
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          {note}
        </T>
      )}
    </View>
  );
}

/** 카드 하나에 동작은 많아야 하나. 진행·결과가 있으면 카드 전체를 눌러 진행 화면. */
function JobCard({ job, state, onAction }: { job: Job; state: JobState; onAction: (a: JobAction) => void }) {
  const p = usePalette();
  const action = actionFor(job, state);
  const isClosed = action?.key === 'dismiss';
  const line = statusLine(job, state);
  const attention = state === 'verify' || job.run?.kind === 'myTurn';
  const dim = state === 'expired' || isClosed;
  const button = action && !isClosed && action.key !== 'progress' && action.key !== 'result' ? action : null;
  const canOpen = !!job.run || state === 'done';
  // 채운 단추(아래 줄): 승인하기, 오늘 날짜로 맡기기. 나머지는 상태 줄 끝 글자 단추
  const approve = button?.key === 'approve' || button?.key === 'redate';
  const label = button?.key === 'approve' ? '승인하기' : button?.label;
  // 날짜를 바꿔야 하는 일은 취소도 할 수 있다
  const side = approve ? (button?.key === 'redate' ? { key: 'cancel' as const, label: '취소' } : null) : button && label ? { key: button.key, label } : null;

  const body = (
    <>
      <View style={st.top}>
        <T v="strong" c={dim ? 'ink2' : 'ink'} lines={1} style={{ flex: 1 }}>
          {job.title}
        </T>
        {job.amount !== null && (
          <T v="figure" c={dim ? 'ink3' : 'ink'} style={[{ flexShrink: 0 }, state === 'expired' && { textDecorationLine: 'line-through' }]}>
            {won(job.amount)}
          </T>
        )}
      </View>
      <View style={st.bottom}>
        <T v="sub" c={attention ? 'attention' : dim ? 'ink3' : 'ink2'} style={{ flex: 1 }} testID={`job-${job.id}-line`}>
          {line}
        </T>
        {/* 덜 중요한 동작(빼기·취소·다시 맡기기)은 상태 줄 끝 글자 단추. 승인만 채운 단추로 아래 줄에 */}
        {side && (
          <Pressable
            testID={`job-${job.id}-${side.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${job.title} ${side.label}`}
            hitSlop={12}
            onPress={() => onAction(side.key)}
            style={({ pressed }) => [st.textBtn, pressed && { backgroundColor: p.sunken }]}
          >
            <T v="subStrong" c="ink2">
              {side.label}
            </T>
          </Pressable>
        )}
      </View>
      {approve && button && (
        <View style={st.actions}>
          <Button small label={label ?? ''} onPress={() => onAction(button.key)} testID={`job-${job.id}-${button.key}`} />
        </View>
      )}
    </>
  );
  if (!canOpen || button) return <View style={[st.card, { backgroundColor: p.tint }]} testID={`job-${job.id}`}>{body}</View>;
  return (
    <Pressable
      testID={`job-${job.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${job.title}. ${line}`}
      accessibilityHint={isClosed ? '누르면 이유를 볼 수 있어요. 옆으로 밀면 치워져요' : '누르면 진행 화면을 열어요'}
      onPress={() => onAction(state === 'done' ? 'result' : 'progress')}
      style={({ pressed }) => [st.card, { backgroundColor: pressed ? p.sunken : p.tint }]}
    >
      {body}
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s4, gap: space.s1 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: space.s3 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  textBtn: { borderRadius: radius.full, paddingHorizontal: space.s2, minHeight: 32, justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.s1, gap: space.s2, minHeight: 28 },
  headBtn: { borderRadius: radius.full, paddingHorizontal: space.s3, minHeight: 28, justifyContent: 'center' },
});
