// 받을 돈·낼 돈 목록(돈 탭에서). 거래처 · 작성일 · 남은 돈 · 기한 지난 날수.
// 받을 돈은 줄마다 [받았어요] → 받은 방법·금액·날짜 → PC로(꺼져 있으면 밀린 일로). 처리하면 줄 아래 "받음 처리했어요 · [되돌리기]".
// 낼 돈은 보기만(낸 처리는 PC에서).
import { StyleSheet, View } from 'react-native';
import { dueLine, exactWon, md, sortOpen, type ReceivableView } from '../money';
import { useMoney, type MarkState } from '../moneyStore';
import { space, usePalette } from '../theme';
import { Button, Check, Empty, Group, Pill, Screen, T } from '../ui/kit';
import { Amount } from './MoneyScreen';

const NB = ' ';

export function MoneyListScreen({ kind, onDone, onMark }: { kind: 'recv' | 'pay'; onDone: () => void; onMark: () => void }) {
  const m = useMoney();
  const list = sortOpen((kind === 'recv' ? m.snap?.receivables : m.snap?.payables) ?? []);
  const title = kind === 'recv' ? '받을 돈' : '낼 돈';
  if (!list.length) {
    return (
      <Screen title={title} onBack={onDone} scroll={false} testID={`money-${kind}-list`} footer={<Button kind="secondary" label="돈으로 돌아가기" onPress={onDone} />}>
        <Empty title={kind === 'recv' ? '받을 돈이 없어요' : '낼 돈이 없어요'} sub={m.live ? undefined : 'PC에서 마지막으로 받은 값 기준이에요.'} />
      </Screen>
    );
  }
  return (
    <Screen title={title} onBack={onDone} testID={`money-${kind}-list`}>
      <Group note={kind === 'pay' ? '낸 처리는 PC에서 해요' : m.live ? undefined : 'PC에서 마지막으로 받은 값이에요. 받음 처리는 PC가 켜지면 해요.'}>
        {list.map((v) => (
          <Item
            key={v.id}
            v={v}
            kind={kind}
            mark={m.marks[v.id]}
            onMark={() => {
              m.setFocus(v.id);
              onMark();
            }}
            onUndo={() => m.undo(v.id)}
          />
        ))}
      </Group>
    </Screen>
  );
}

function Item({ v, kind, mark, onMark, onUndo }: { v: ReceivableView; kind: 'recv' | 'pay'; mark?: MarkState; onMark: () => void; onUndo: () => void }) {
  const p = usePalette();
  const overdue = v.overdue && v.status !== 'unknown';
  return (
    <View style={st.row} testID={`money-item-${v.id}`}>
      <View style={st.line}>
        <T style={{ flex: 1 }}>{v.cpName ?? '거래처 모름'}</T>
        <Amount n={v.remaining} v="value" />
      </View>
      <View style={st.line}>
        <T v="sub" c={overdue ? 'attention' : v.status === 'unknown' ? 'ink3' : 'ink2'} style={{ flex: 1 }}>
          {`${md(v.writtenOn)}${NB}작성 · ${dueLine(v, kind)}${v.received > 0 ? ` · ${exactWon(v.received)} 받음` : ''}`}
        </T>
        {kind === 'recv' && (!mark || mark.kind === 'undone') && <Pill label="받았어요" onPress={onMark} testID={`money-mark-${v.id}`} />}
      </View>
      {kind === 'recv' && mark && mark.kind !== 'undone' && (
        <View style={st.done} testID={`money-mark-state-${v.id}`}>
          {mark.kind === 'done' ? (
            <>
              <Check color={p.ink3} />
              <T v="meta" c="ink2" style={{ flex: 1 }}>
                받음 처리했어요
              </T>
              <Pill quiet label="되돌리기" onPress={onUndo} testID={`money-undo-${v.id}`} />
            </>
          ) : mark.kind === 'queued' ? (
            <T v="meta" c="ink2">
              PC 켜지면 받음 처리해요 · 밀린 일에 있어요
            </T>
          ) : (
            <T v="meta" c="ink2">
              이미 처리됐어요
            </T>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  row: { paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s1, minHeight: 64 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: 36 },
});
