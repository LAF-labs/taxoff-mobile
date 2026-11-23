import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { shareDoc } from '../doc';
import { fullDay } from '../money';
import { useQueue } from '../queueStore';
import type { DocRef } from '../run';
import { radius, space, usePalette } from '../theme';
import { Button, Check, Empty, Screen, T } from '../ui/kit';
import preview from '../../assets/sample/tax-invoice.png';

export type DocState = { kind: 'loading' } | { kind: 'receiving'; pct: number } | { kind: 'pcOff'; asked?: boolean } | { kind: 'error' } | { kind: 'ready'; backup?: boolean };

const SAMPLE_REF: DocRef = { name: '세금계산서_가나식자재_20261116.pdf', issuedOn: '2026-11-16', uri: '' };

export function DocScreen({ onDone, state: initial = { kind: 'ready' } }: { onDone: () => void; state?: DocState }) {
  const p = usePalette();
  const q = useQueue();
  const r = q.focus?.run;
  const doc = r?.kind === 'done' ? r.result.doc : SAMPLE_REF;
  const [state, setState] = useState<DocState>(initial);
  const [fail, setFail] = useState(false);
  const { width } = useWindowDimensions();
  const imgW = width - space.s5 * 2 - space.s2 * 2;
  const share = async (purpose: 'share' | 'save') => setFail(!(await shareDoc(doc.name, purpose)));
  const open = state.kind === 'ready';

  let footer;
  if (open) {
    footer = (
      <>
        <Button label="공유" onPress={() => void share('share')} testID="doc-share" />
        <Button kind="secondary" label="파일에 저장" onPress={() => void share('save')} testID="doc-save" />
      </>
    );
  } else if (state.kind === 'pcOff') {
    footer = state.asked ? (
      <Button kind="secondary" label="닫기" onPress={onDone} />
    ) : (
      <>
        <Button label="PC 켜지면 받기" onPress={() => setState({ kind: 'pcOff', asked: true })} testID="doc-when-on" />
        <Button kind="quiet" label="닫기" onPress={onDone} />
      </>
    );
  } else if (state.kind === 'error') {
    footer = (
      <>
        <Button label="다시 받기" onPress={() => setState({ kind: 'loading' })} testID="doc-retry" />
        <Button kind="quiet" label="닫기" onPress={onDone} />
      </>
    );
  } else {
    footer = <Button kind="secondary" label="닫기" onPress={onDone} />;
  }

  return (
    <Screen title="서류 보기" onBack={onDone} testID="doc-screen" footer={footer} scroll={open}>
      <View style={{ gap: space.s1 }}>
        <T v="strong" style={st.name} testID="doc-name">
          {doc.name}
        </T>
        <T v="meta" c="ink3">
          발급일 {fullDay(doc.issuedOn)}
          {open && state.backup ? ', 백업에서 열었어요' : ''}
        </T>
      </View>
      {open ? (
        <View style={{ gap: space.s2 }}>
          <View style={[st.page, { backgroundColor: p.tint }]}>
            <Image source={preview} style={[st.img, { width: imgW, height: (imgW * 2246) / 1588 }]} resizeMode="contain" accessibilityLabel={`${doc.name} 첫 쪽`} />
          </View>
          {fail && (
            <T v="meta" c="attention" testID="doc-share-fail">
              이 기기에서 공유 창을 열 수 없어요
            </T>
          )}
        </View>
      ) : state.kind === 'loading' ? (
        <View style={st.center} testID="doc-loading">
          <ActivityIndicator color={p.ink3} />
          <T v="sub" c="ink2">서류를 여는 중이에요</T>
        </View>
      ) : state.kind === 'receiving' ? (
        <View style={st.center} testID="doc-receiving">
          <T v="sub" c="ink2">PC에서 받는 중 {state.pct}%</T>
          <View style={[st.track, { backgroundColor: p.tint }]} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: state.pct }}>
            <View style={[st.fill, { width: `${state.pct}%`, backgroundColor: p.ink }]} />
          </View>
        </View>
      ) : state.kind === 'pcOff' ? (
        <Empty
          testID="doc-pc-off"
          title="이 서류는 PC가 켜지면 받아요"
          sub={state.asked ? undefined : 'PC에만 있는 서류예요. 백업을 켠 서류는 PC가 꺼져 있어도 열려요.'}
          action={
            state.asked ? (
              <View style={st.asked}>
                <Check color={p.ink3} />
                <T v="sub" c="ink2">PC가 켜지면 받아 둘게요</T>
              </View>
            ) : undefined
          }
        />
      ) : (
        <Empty testID="doc-error" title="이 서류를 열 수 없어요" sub="받은 파일이 깨졌거나 이 폰에서 풀 수 없어요. 다시 받아 볼게요." />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  name: { ...({ overflowWrap: 'anywhere' } as object) },
  page: { borderRadius: radius.md, padding: space.s2, overflow: 'hidden' },
  img: { borderRadius: radius.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s3, paddingBottom: space.s7 },
  track: { width: '70%', height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  asked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s2 },
});
