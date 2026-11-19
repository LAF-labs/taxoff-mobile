// 발급 진행·결과 화면(P-04): 대화 카드나 밀린 일 [진행 보기]·[결과 보기]에서 연다.
// 바닥에 기본 행동 하나 + 보조 하나가 늘 보인다. 결과 모름·확인 필요에는 다시 발급하는 단추가 없다.
import { useState } from 'react';
import { useQueue } from '../queueStore';
import { SimpleAuthForm, checkDraft, draftOf, type SimpleDraft } from './SimpleAuthForm';
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
  // 폰에서 간편인증 시작: 값 받기 화면(같은 화면 안). 보내면 진행 카드로 돌아간다
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<SimpleDraft>(() => draftOf(s.data.simpleId));
  const [errors, setErrors] = useState<Partial<Record<keyof SimpleDraft, string>>>({});
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
    if (a === 'simpleAuth') {
      setDraft(draftOf(s.data.simpleId));
      setErrors({});
      return setAsking(true);
    }
    q.runAction(job.id, a);
    if (a === 'stop') onDone();
  };
  const sendSimple = () => {
    const c = checkDraft(draft);
    if (!c.ok) return setErrors(c.errors);
    q.simpleAuth(job.id, c.id);
    setAsking(false);
  };
  if (asking && job.pcOnly && r.kind === 'myTurn' && r.auth.method === 'pc') {
    return (
      <Screen
        title="간편인증"
        onBack={() => setAsking(false)}
        testID="simple-screen"
        footer={
          <>
            <Button label="승인 요청 보내기" onPress={sendSimple} testID="simple-send" />
            <Button kind="quiet" label="취소" onPress={() => setAsking(false)} testID="simple-cancel" />
          </>
        }
      >
        <SimpleAuthForm draft={draft} onChange={(d) => (setDraft(d), setErrors({}))} errors={errors} failed={r.auth.failed} />
      </Screen>
    );
  }
  let footer;
  if (job.pcOnly && r.kind === 'myTurn' && (r.auth.method === 'pc' || (r.auth.method === 'simple' && r.auth.pc)) && actionsOf(r, now)[0] !== 'close') {
    // 폰 발급 명령이 로그인에서 기다린다: 폰에서 간편인증·[인증서로 다시 시도]·[승인했어요]
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
    // 폰 발급 명령: 승인·중지·서류는 PC가 맡는다. 폰은 지켜보기만 한다.
    footer = <Button kind="secondary" label="닫기" onPress={onDone} testID="run-main-close" />;
  } else if (r.kind === 'done') {
    footer = (
      <>
        <Button label="서류 보기" onPress={onDoc} testID="run-doc" />
        <Button kind="secondary" label="공유" onPress={() => void shareDoc(r.result.doc.name)} testID="run-share" />
      </>
    );
  } else {
    // 기본 행동 하나(ink 알약) + 보조(글자). 진행 중에는 닫기가 기본이고 중지는 보조다.
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
        {/* 카드 아래 안내: 어디서 하고 있는지, 앱을 닫아도 되는지 */}
        {(r.kind === 'running' || r.kind === 'myTurn' || r.kind === 'inDoubt') && (
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
