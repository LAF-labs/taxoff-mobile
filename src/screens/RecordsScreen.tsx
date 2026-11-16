// 기록 탭(기획 v2 PR 1): 발급한 세금계산서가 쌓일 곳. 아직 빈 화면 + [세금계산서 발급].
import { useSession } from '../session';
import { Button, Empty, Screen } from '../ui/kit';
import type { HomeRoute } from './HomeScreen';

export function RecordsScreen({ go }: { go: (to: HomeRoute) => void }) {
  const s = useSession();
  const paired = !!s.data.pair;
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
