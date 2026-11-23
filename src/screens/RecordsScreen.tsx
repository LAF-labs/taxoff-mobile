import { fullDay } from '../money';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { Button, Empty, Group, Row, Screen, won } from '../ui/kit';
import type { HomeRoute } from './HomeScreen';

export function RecordsScreen({ go }: { go: (to: HomeRoute) => void }) {
  const s = useSession();
  const q = useQueue();
  const paired = !!s.data.pair;
  const done = q.jobs.filter((j) => j.run?.kind === 'done').sort((a, b) => b.createdAt - a.createdAt);
  if (paired && done.length > 0) {
    return (
      <Screen title="기록" tabbed testID="records">
        <Group title="발급한 세금계산서" testID="records-list">
          {done.map((j) => {
            const r = j.run?.kind === 'done' ? j.run.result : null;
            return (
              <Row
                key={j.id}
                label={r?.counterpart ?? j.title}
                sub={r ? `${fullDay(r.doc.issuedOn)}, 승인번호 끝 ${r.approvalNo.replace(/\D/g, '').slice(-4)}` : undefined}
                value={r ? won(r.total) : undefined}
                valueInk="ink"
                onPress={() => {
                  q.setFocus(j.id);
                  go('run');
                }}
                testID={`record-${j.id}`}
              />
            );
          })}
        </Group>
      </Screen>
    );
  }
  return (
    <Screen title="기록" tabbed scroll={false} testID="records">
      <Empty
        testID="records-empty"
        title="아직 발급한 게 없어요"
        sub={paired ? '폰이나 PC에서 발급한 세금계산서가 여기에 모여요.' : '먼저 이 폰을 PC와 연결해 주세요.'}
        action={paired ? <Button label="세금계산서 발급" onPress={() => go('issue')} testID="records-issue" /> : <Button label="PC 연결하기" onPress={() => go('pair')} />}
      />
    </Screen>
  );
}
