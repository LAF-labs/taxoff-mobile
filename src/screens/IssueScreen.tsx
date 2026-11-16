// 세금계산서 발급 작성(기획 v2 PR 1에서는 자리만): 다음 할 일은 대화로 PC에 부탁하기.
import { Button, Empty, Screen } from '../ui/kit';

export function IssueScreen({ onDone, onAsk }: { onDone: () => void; onAsk: () => void }) {
  return (
    <Screen title="세금계산서 발급" onBack={onDone} scroll={false} testID="issue" footer={<Button label="대화로 PC에 부탁하기" onPress={onAsk} testID="issue-ask" />}>
      <Empty title="발급 작성 화면은 준비 중이에요" sub="지금은 대화에 받는 곳과 금액을 적어 PC에 부탁해 주세요." />
    </Screen>
  );
}
