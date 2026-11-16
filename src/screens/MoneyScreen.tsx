// 돈 탭(기획 v2 PR 1): 아직 빈 화면. 계좌 연결은 PC에서 하므로 다음 할 일은 PC 쪽을 가리킨다.
import { useSession } from '../session';
import { Button, Empty, Screen } from '../ui/kit';
import type { HomeRoute } from './HomeScreen';

export function MoneyScreen({ go }: { go: (to: HomeRoute) => void }) {
  const s = useSession();
  const paired = !!s.data.pair;
  return (
    <Screen title="돈" tabbed scroll={false} testID="money">
      <Empty
        testID="money-empty"
        title="PC에서 계좌를 연결하면 보여요"
        sub={paired ? 'PC의 택스오프에서 계좌를 한 번 연결하면, 들어오고 나간 돈이 여기에도 보여요.' : '먼저 이 폰을 PC와 연결해 주세요.'}
        action={paired ? <Button kind="secondary" label="연결한 PC 보기" onPress={() => go('connection')} /> : <Button label="PC 연결하기" onPress={() => go('pair')} />}
      />
    </Screen>
  );
}
