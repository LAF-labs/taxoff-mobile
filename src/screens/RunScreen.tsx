import { useQueue } from '../queueStore';
import { actionsOf, type RunAction } from '../run';
import { Button, Empty, Screen } from '../ui/kit';
import { Pressable, View } from 'react-native';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { Chevron, T } from '../ui/kit';
import { RunCard, actionLabel, openAuthApp, useNow } from './RunCard';
import { shareDoc } from '../doc';

export function RunScreen({ onDone, onDoc, onRecords, now: fixedNow }: { onDone: () => void; onDoc: () => void; onRecords: () => void; now?: number }) {
  const q = useQueue();
  const s = useSession();
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
        <Button kind="secondary" label="공유" onPress={() => void shareDoc(r.result.doc.name)} testID="run-share" />
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
        {(r.kind === 'running' || r.kind === 'inDoubt') && (
          <View style={{ gap: 2, paddingHorizontal: space.s1 }} testID="run-hint">
            <T v="meta" c="ink3">
              {`${s.data.pair?.desktopName ?? '내 PC'}에서 하고 있어요`}
            </T>
            <T v="meta" c="ink3">
              {job.pcOnly
                ? '앱을 닫아도 PC는 계속해요. 다시 열면 지금 상태를 받아 와요'
                : r.kind === 'inDoubt'
                  ? '앱을 닫아도 확인을 계속해요. 결과가 나오면 알려 드려요'
                  : '앱을 닫아도 계속돼요. 끝나면 알림으로 알려 드려요'}
            </T>
          </View>
        )}
        {r.kind === 'done' && job.pcOnly && (
          <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }} testID="run-doc-on-pc">
            서류는 PC 기록에 있어요
          </T>
        )}
        {r.kind === 'done' && !job.pcOnly && (
          <Pressable onPress={onRecords} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 44, paddingHorizontal: space.s1 }, pressed && { opacity: 0.6 }]} testID="run-records">
            <T v="meta" c="ink3">
              기록 탭에도 남겨 뒀어요
            </T>
            <Chevron color={p.ink4} sizePx={7} />
          </Pressable>
        )}
      </View>
    </Screen>
  );
}
