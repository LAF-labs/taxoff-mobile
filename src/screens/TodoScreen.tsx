// 지금 할 일(홈의 한 줄을 누르면): 승인 대기(폰 승인은 준비 중) · 밀린 일(아직 PC로 못 간 것).
import { useSession } from '../session';
import { Button, Group, Row, Screen } from '../ui/kit';
import type { Todo } from './HomeScreen';

export function TodoScreen({ onDone, onConnection, todo }: { onDone: () => void; onConnection: () => void; todo?: Todo }) {
  const s = useSession();
  const t = todo ?? { approvals: 0, backlog: s.pending.receipts + s.pending.cash };
  return (
    <Screen
      title="지금 할 일"
      onBack={onDone}
      testID="todo-screen"
      footer={t.backlog > 0 ? <Button label="지금 보내기" onPress={() => void s.sync()} busy={s.syncing} /> : <Button kind="secondary" label="대화로 돌아가기" onPress={onDone} />}
    >
      <Group title="승인 대기" note="PC가 사장님 승인을 기다리는 일이에요. 폰에서 승인하는 기능은 준비 중이라 지금은 PC에서 승인해 주세요.">
        <Row label="승인할 일" value={`${t.approvals}건`} valueInk={t.approvals ? 'ink' : 'ink3'} />
      </Group>
      <Group title="밀린 일" note="PC가 꺼져 있어 아직 못 보낸 것이에요. PC가 켜지면 저절로 보내요.">
        <Row label="사진" value={`${s.pending.receipts}장`} />
        <Row label="현금 매출" value={`${s.pending.cash}건`} />
        <Row label="연결 상태 보기" onPress={onConnection} />
      </Group>
    </Screen>
  );
}
