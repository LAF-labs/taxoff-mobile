import { useState } from 'react';
import { View } from 'react-native';
import { METHOD_LABEL, exactWon, md, type PhoneMarkMethod } from '../money';
import { useMoney } from '../moneyStore';
import { useSession } from '../session';
import { space } from '../theme';
import { Field, masked } from '../ui/field';
import { Button, Empty, Group, Replies, Row, Screen, T } from '../ui/kit';
import { localDay } from './CashScreen';

const METHODS: PhoneMarkMethod[] = ['cash', 'other_account', 'offset', 'other'];
const SUB: Record<PhoneMarkMethod, string> = { cash: '현금으로 받았어요', other_account: '연결하지 않은 다른 계좌로 받았어요', offset: '서로 줄 돈과 받을 돈을 맞췄어요', other: '그 밖의 방법' };

export function MarkReceivedScreen({ onDone }: { onDone: () => void }) {
  const m = useMoney();
  const s = useSession();
  const v = m.focus;
  const [method, setMethod] = useState<PhoneMarkMethod | null>(null);
  const [amount, setAmount] = useState(v ? masked('won', String(v.remaining)) : '');
  const [on, setOn] = useState(localDay());
  if (!v) {
    return (
      <Screen title="받음 표시" onBack={onDone} scroll={false} footer={<Button kind="secondary" label="닫기" onPress={onDone} />}>
        <Empty title="이 건을 찾지 못했어요" sub="받을 돈 목록에서 다시 골라 주세요." />
      </Screen>
    );
  }
  const n = Number(amount.replace(/\D/g, ''));
  const badAmount = amount !== '' && (n <= 0 || n > v.remaining) ? `남은 돈 ${exactWon(v.remaining)}까지 적을 수 있어요` : null;
  const badDay = /^\d{4}-\d{2}-\d{2}$/.test(on) ? null : '날짜는 2026-11-17처럼 적어 주세요';
  const online = s.pc === 'online';
  const ready = !!method && n > 0 && !badAmount && !badDay;
  return (
    <Screen
      title="받음 표시"
      onBack={onDone}
      testID="money-mark"
      footer={
        <Button
          label={online ? '받음 처리하기' : 'PC 켜지면 처리하기'}
          disabled={!ready}
          onPress={() => {
            m.markReceived(v, { method: method!, amount: n, on }, online);
            onDone();
          }}
          testID="money-mark-send"
        />
      }
    >
      <Group>
        <Row label={v.cpName ?? '거래처 모름'} sub={`${md(v.writtenOn)} 작성`} value={exactWon(v.remaining)} valueInk="ink" />
      </Group>
      <View style={{ gap: space.s2 }}>
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          받은 방법
        </T>
        <Replies testID="money-method" options={METHODS.map((k) => ({ key: k, label: METHOD_LABEL[k], sub: SUB[k] }))} chosen={method} onChoose={setMethod} />
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          연결한 계좌로 들어온 돈은 PC가 거래내역으로 맞춰요
        </T>
      </View>
      <Group>
        <Field label="금액" mask="won" unit="원" value={amount} onChange={setAmount} error={badAmount} testID="money-mark-amount" />
        <Field label="받은 날" mask="day" value={on} onChange={setOn} error={badDay} testID="money-mark-day" />
      </Group>
    </Screen>
  );
}
