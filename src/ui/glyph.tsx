import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { radius, usePalette } from '../theme';

/**
 * 알림 줄 앞의 종류 아이콘(18pt 선 그림). 대화 카드의 종류 아이콘과 같은 뜻을 쓴다:
 * 발급됨은 동그라미 체크, 멈춤은 동그라미 느낌표, 내 차례와 확인 필요는 세모, 승인 기다림은 문서, 돈은 지폐, 목록은 줄 셋.
 * 더보기 메뉴는 같은 그림을 22로 키워 쓴다(대화 말풍선, 알림 종, 설정 조절 막대, 문서함 폴더).
 * 문서함 줄은 종류마다 문서 속을 바꾼다: 세금계산서는 두 줄(doc), 증명서는 체크(cert), 그 밖은 한 줄(paper). 찾기 칸은 돋보기(search).
 */
export type GlyphKind = 'done' | 'stop' | 'attention' | 'doc' | 'cert' | 'paper' | 'money' | 'list' | 'chat' | 'bell' | 'settings' | 'folder' | 'search';

const W = 1.75;

export function Glyph({ kind, color, size = 18 }: { kind: GlyphKind; color: string; size?: number }) {
  const g = <Base kind={kind} color={color} />;
  if (size === 18) return g;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      <View style={{ transform: [{ scale: size / 18 }] }}>{g}</View>
    </View>
  );
}

function Base({ kind, color }: { kind: GlyphKind; color: string }): ReactNode {
  const p = usePalette();
  const line = { borderColor: color, borderWidth: W };
  const fill = { backgroundColor: color };
  if (kind === 'done') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.circle, line]}>
          <View style={[st.check, { borderColor: color }]} />
        </View>
      </View>
    );
  }
  if (kind === 'stop') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.circle, line, { gap: 2 }]}>
          <View style={[st.bang, fill]} />
          <View style={[st.dot, fill]} />
        </View>
      </View>
    );
  }
  if (kind === 'attention') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.side, fill, { left: 5.1 - W / 2, transform: [{ rotate: '26.6deg' }] }]} />
        <View style={[st.side, fill, { left: 12.9 - W / 2, transform: [{ rotate: '-26.6deg' }] }]} />
        <View style={[st.base, fill]} />
        <View style={[st.triBang, fill]} />
        <View style={[st.triDot, fill]} />
      </View>
    );
  }
  if (kind === 'doc') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.doc, line]}>
          <View style={[st.docLine, fill]} />
          <View style={[st.docLine, fill]} />
        </View>
      </View>
    );
  }
  if (kind === 'cert') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.doc, line]}>
          <View style={[st.check, st.docCheck, { borderColor: color }]} />
        </View>
      </View>
    );
  }
  if (kind === 'paper') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.doc, line]}>
          <View style={[st.docLine, fill]} />
        </View>
      </View>
    );
  }
  if (kind === 'folder') {
    return (
      <View style={[st.box, st.folder]} aria-hidden>
        <View style={[st.folderTab, line]} />
        <View style={[st.folderBody, line]} />
      </View>
    );
  }
  if (kind === 'search') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.lens, line]} />
        <View style={[st.handle, fill]} />
      </View>
    );
  }
  if (kind === 'chat') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.bubble, line]} />
        <View style={[st.tail, { borderTopColor: color }]} />
      </View>
    );
  }
  if (kind === 'bell') {
    return (
      <View style={[st.box, st.bell]} aria-hidden>
        <View style={[st.dome, line]} />
        <View style={[st.rim, fill]} />
        <View style={[st.clapper, fill]} />
      </View>
    );
  }
  if (kind === 'settings') {
    return (
      <View style={[st.box, st.sliders]} aria-hidden>
        {[4, 11].map((x, i) => (
          <View key={i} style={st.slider}>
            <View style={[st.sliderLine, fill]} />
            <View style={[st.knob, line, { left: x, backgroundColor: p.canvas }]} />
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'money') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.bill, line]}>
          <View style={[st.coin, line]} />
        </View>
      </View>
    );
  }
  return (
    <View style={[st.box, st.list]} aria-hidden>
      {[0, 1, 2].map((i) => (
        <View key={i} style={st.listRow}>
          <View style={[st.listDot, fill]} />
          <View style={[st.listLine, fill]} />
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  box: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 17, height: 17, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  check: { width: 7, height: 4, borderLeftWidth: W, borderBottomWidth: W, transform: [{ rotate: '-45deg' }], marginTop: -2 },
  bang: { width: W, height: 5, borderRadius: radius.full },
  dot: { width: W, height: W, borderRadius: radius.full },
  side: { position: 'absolute', top: 0.1, width: W, height: 17.4, borderRadius: radius.full },
  base: { position: 'absolute', left: 1, right: 1, bottom: 0.5, height: W, borderRadius: radius.full },
  triBang: { position: 'absolute', left: 9 - W / 2, top: 6.5, width: W, height: 4.5, borderRadius: radius.full },
  triDot: { position: 'absolute', left: 9 - W / 2, top: 12.5, width: W, height: W, borderRadius: radius.full },
  doc: { width: 13, height: 17, borderRadius: radius.sm / 3, alignItems: 'center', justifyContent: 'center', gap: 2.5, paddingTop: 2 },
  docLine: { width: 6, height: W, borderRadius: radius.full },
  docCheck: { width: 6, height: 3.5, marginTop: 0 },
  folder: { justifyContent: 'flex-end', paddingBottom: 1.5 },
  folderTab: { position: 'absolute', left: 1, top: 2, width: 7, height: 4, borderTopLeftRadius: radius.sm / 4, borderTopRightRadius: radius.sm / 4, borderBottomWidth: 0 },
  folderBody: { width: 17, height: 11.5, borderRadius: radius.sm / 3 },
  lens: { position: 'absolute', left: 1.5, top: 1.5, width: 12, height: 12, borderRadius: radius.full },
  handle: { position: 'absolute', left: 13, top: 11.2, width: W, height: 6, borderRadius: radius.full, transform: [{ rotate: '-45deg' }] },
  bill: { width: 18, height: 12, borderRadius: radius.sm / 3, alignItems: 'center', justifyContent: 'center' },
  coin: { width: 6, height: 6, borderRadius: radius.full },
  bubble: { width: 16, height: 12.5, borderRadius: radius.sm / 2, marginBottom: 2.5 },
  tail: { position: 'absolute', left: 4, bottom: 0.5, width: 0, height: 0, borderTopWidth: 4.5, borderRightWidth: 4.5, borderRightColor: 'transparent' },
  bell: { justifyContent: 'flex-start', paddingTop: 1 },
  dome: { width: 12, height: 11, borderTopLeftRadius: radius.full, borderTopRightRadius: radius.full, borderBottomWidth: 0 },
  rim: { width: 16, height: W, borderRadius: radius.full },
  clapper: { width: 4, height: 2, marginTop: 1.5, borderBottomLeftRadius: radius.full, borderBottomRightRadius: radius.full },
  sliders: { gap: 5 },
  slider: { width: 16, height: 6, justifyContent: 'center' },
  sliderLine: { height: W, borderRadius: radius.full },
  knob: { position: 'absolute', top: 0, width: 6, height: 6, marginLeft: -3, borderRadius: radius.full },
  list: { gap: 3.5, alignItems: 'flex-start', paddingLeft: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listDot: { width: 2.5, height: 2.5, borderRadius: radius.full },
  listLine: { width: 12, height: W, borderRadius: radius.full },
});
