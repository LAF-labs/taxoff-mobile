// 발급 진행·결과 화면(P-04): 대화 카드나 밀린 일 [진행 보기]·[결과 보기]에서 연다.
// 바닥에 기본 행동 하나 + 보조 하나가 늘 보인다. 결과 모름·확인 필요에는 다시 발급하는 단추가 없다.
import { useQueue } from '../queueStore';
import { actionsOf, type RunAction } from '../run';
import { Button, Empty, Screen } from '../ui/kit';
import { RunCard, actionLabel, openAuthApp } from './RunCard';
import { shareDoc } from '../doc';

export function RunScreen({ onDone, onDoc, now }: { onDone: () => void; onDoc: () => void; now?: number }) {
  const q = useQueue();
  const job = q.focus;
  const r = job?.run;
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
  if (r.kind === 'done') {
    footer = (
      <>
        <Button label="서류 보기" onPress={onDoc} testID="run-doc" />
        <Button kind="secondary" label="공유" onPress={() => void shareDoc(r.result.doc.name)} testID="run-share" />
      </>
    );
  } else {
    // 기본 행동 하나(ink 알약) + 보조(글자). 진행 중에는 닫기가 기본이고 중지는 보조다.
    const raw = actionsOf(r);
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
      <RunCard job={job} now={now} />
    </Screen>
  );
}
