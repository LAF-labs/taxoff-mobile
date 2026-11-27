import { useQueue } from '../queueStore';
import { actionsOf, type RunAction } from '../run';
import { Button, Empty, Screen } from '../ui/kit';
import { Pressable, View } from 'react-native';
import { space, usePalette } from '../theme';
import { Chevron, T } from '../ui/kit';
import { RunCard, actionLabel, openAuthApp, useNow } from './RunCard';

export function RunScreen({ onDone, onDoc, onRecords, now: fixedNow }: { onDone: () => void; onDoc: () => void; onRecords: () => void; now?: number }) {
  const q = useQueue();
  const p = usePalette();
  const job = q.focus;
  const r = job?.run;
  const now = useNow(fixedNow, !!r && r.kind === 'myTurn');
  if (!job || !r) {
    return (
      <Screen title="발급 진행" onBack={onDone} scroll={false} footer={<Button kind="secondary" label="닫기" onPress={onDone} />}>
        <Empty title="이 일의 진행을 찾지 못했어요" sub="밀린 일에서 다시 열어 주세요." />
      </Screen>
    );
  }
  const run = (a: RunAction) => {
    if (a === 'close') return onDone();
    if (a === 'openApp') return openAuthApp(r);
    q.runAction(job.id, a);
    if (a === 'stop') onDone();
  };
  let footer;
  if (job.pcOnly && r.kind === 'myTurn' && (r.auth.method === 'pc' || (r.auth.method === 'simple' && r.auth.pc)) && actionsOf(r, now)[0] !== 'close') {
    const [first, ...rest] = actionsOf(r, now);
    footer = (
      <>
        <Button label={actionLabel(first!, r)} onPress={() => run(first!)} testID={`run-main-${first}`} />
        {rest.slice(0, 2).map((a) => (
          <Button key={a} kind="quiet" label={actionLabel(a, r)} onPress={() => run(a)} testID={`run-sub-${a}`} />
        ))}
      </>
    );
  } else if (job.pcOnly) {
    footer = <Button kind="secondary" label="닫기" onPress={onDone} testID="run-main-close" />;
  } else if (r.kind === 'done') {
    footer = (
      <>
        <Button label="서류 보기" onPress={onDoc} testID="run-doc" />
        <Button kind="secondary" label="닫기" onPress={onDone} />
      </>
    );
  } else {
    const raw = actionsOf(r, now);
    const acts: RunAction[] = raw[0] === 'stop' ? ['close', 'stop'] : raw;
    const [first, ...rest] = acts;
    footer = (
      <>
        <Button label={actionLabel(first!, r)} kind={first === 'close' ? 'secondary' : 'primary'} onPress={() => run(first!)} testID={`run-main-${first}`} />
        {rest.slice(0, 2).map((a) => (
          <Button key={a} kind="quiet" label={actionLabel(a, r)} onPress={() => run(a)} testID={`run-sub-${a}`} />
        ))}
        {acts.length === 1 && first !== 'close' && <Button kind="quiet" label="닫기" onPress={onDone} />}
      </>
    );
  }
  return (
    <Screen title={r.kind === 'done' ? '발급 결과' : '발급 진행'} onBack={onDone} testID="run-screen" footer={footer}>
      <View style={{ gap: space.s3 }}>
        <RunCard job={job} now={fixedNow} />
        {}
        {}
        {r.kind === 'done' && !job.pcOnly && (
          <Pressable onPress={onRecords} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 44, paddingHorizontal: space.s1 }, pressed && { opacity: 0.6 }]} testID="run-records">
            <T v="sub" c="ink2">
              기록에서 보기
            </T>
            <Chevron color={p.ink4} sizePx={7} />
          </Pressable>
        )}
      </View>
    </Screen>
  );
}
