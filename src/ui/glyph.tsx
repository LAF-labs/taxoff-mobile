import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { radius, usePalette } from '../theme';

/**
 * 알림 줄 앞의 종류 아이콘(18pt 선 그림). 대화 카드의 종류 아이콘과 같은 뜻을 쓴다:
 * 발급됨은 동그라미 체크, 멈춤은 동그라미 느낌표, 내 차례와 확인 필요는 세모, 승인 기다림은 문서, 돈은 지폐, 목록은 줄 셋.
 * 더보기 메뉴는 같은 그림을 22로 키워 쓴다(대화 말풍선, 알림 종, 설정 조절 막대, 거래처 건물, 문서함 폴더).
 * 문서함 줄: 세금계산서는 아래가 톱니인 영수증(receipt), 직접 올린 서류는 한 줄과 도장 동그라미(contract). 증명서는 발급처 로고.
 * 거래처 화면: 찾기 돋보기, 더하기, 등록증 찍기 카메라, 바꿀 수 없는 칸 자물쇠, 복사, 닫기 X.
 * 리포트: 더보기 메뉴의 막대 셋(chart), PDF로 내보내기의 위 화살표 상자(share). 기준판 Phone-Menu, Phone-Report.
 */
export type GlyphKind = 'done' | 'stop' | 'attention' | 'doc' | 'cert' | 'paper' | 'receipt' | 'contract' | 'money' | 'list' | 'chat' | 'bell' | 'settings' | 'building' | 'folder' | 'search' | 'plus' | 'camera' | 'lock' | 'copy' | 'close' | 'chart' | 'share';

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
  if (kind === 'receipt') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.slip, line]}>
          <View style={[st.docLine, fill]} />
          <View style={[st.docLine, fill]} />
          <View style={[st.docLine, fill, { width: 3.5 }]} />
        </View>
        <View style={st.teeth}>
          {[0, 1, 2].map((i) => <View key={i} style={[st.tooth, { borderColor: color }]} />)}
        </View>
      </View>
    );
  }
  if (kind === 'contract') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.doc, line, { justifyContent: 'flex-start', paddingTop: 4 }]}>
          <View style={[st.docLine, fill]} />
        </View>
        <View style={[st.seal, line, { backgroundColor: p.canvas }]} />
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
  if (kind === 'building') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.tower, line]} />
        <View style={[st.wing, line]} />
        {[4, 8, 12].map((y) => (
          <View key={y} style={[st.window, fill, { top: y }]} />
        ))}
        <View style={[st.ground, fill]} />
      </View>
    );
  }
  if (kind === 'plus' || kind === 'close') {
    const turn = kind === 'close' ? '45deg' : '0deg';
    return (
      <View style={[st.box, { transform: [{ rotate: turn }] }]} aria-hidden>
        <View style={[st.bar, fill]} />
        <View style={[st.bar, fill, { transform: [{ rotate: '90deg' }] }]} />
      </View>
    );
  }
  if (kind === 'camera') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.camTop, line]} />
        <View style={[st.camBody, line]}>
          <View style={[st.camLens, line]} />
        </View>
      </View>
    );
  }
  if (kind === 'lock') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.shackle, line]} />
        <View style={[st.lockBody, line]} />
      </View>
    );
  }
  if (kind === 'copy') {
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.sheetBack, line]} />
        <View style={[st.sheetFront, line, { backgroundColor: p.tint }]} />
      </View>
    );
  }
  if (kind === 'chart') {
    // 기준판 M5 20V11 M12 20V5 M19 20v-6(24 칸)을 18 칸으로
    return (
      <View style={st.box} aria-hidden>
        {[
          [3.75, 6.75],
          [9, 11.25],
          [14.25, 4.5],
        ].map(([x, h]) => (
          <View key={x} style={[st.chartBar, fill, { left: x! - W / 2, height: h! + W }]} />
        ))}
      </View>
    );
  }
  if (kind === 'share') {
    // 기준판 PDF로 저장: 위 화살표와 위가 열린 상자
    return (
      <View style={st.box} aria-hidden>
        <View style={[st.shareStem, fill]} />
        <View style={[st.shareHead, { borderColor: color }]} />
        <View style={[st.shareBox, line]} />
        <View style={[st.shareLip, fill, { left: 3 }]} />
        <View style={[st.shareLip, fill, { right: 3 }]} />
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
  slip: { position: 'absolute', top: 0.5, width: 13, height: 14, borderBottomWidth: 0, borderTopLeftRadius: radius.sm / 3, borderTopRightRadius: radius.sm / 3, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 1 },
  teeth: { position: 'absolute', top: 12.2, flexDirection: 'row' },
  tooth: { width: 3.1, height: 3.1, marginHorizontal: 0.6, borderRightWidth: W, borderBottomWidth: W, transform: [{ rotate: '45deg' }] },
  seal: { position: 'absolute', right: 1, bottom: 1, width: 7, height: 7, borderRadius: radius.full },
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
  tower: { position: 'absolute', left: 2, bottom: 1, width: 9, height: 15, borderRadius: radius.sm / 8, borderBottomWidth: 0 },
  wing: { position: 'absolute', left: 10, bottom: 1, width: 6, height: 9, borderRadius: radius.sm / 8, borderBottomWidth: 0 },
  window: { position: 'absolute', left: 5, width: 3, height: W, borderRadius: radius.full },
  ground: { position: 'absolute', left: 0.5, right: 0.5, bottom: 0.5, height: W, borderRadius: radius.full },
  bar: { position: 'absolute', left: 9 - W / 2, top: 2, width: W, height: 14, borderRadius: radius.full },
  camTop: { position: 'absolute', left: 6, top: 2, width: 6, height: 3.5, borderTopLeftRadius: radius.sm / 5, borderTopRightRadius: radius.sm / 5, borderBottomWidth: 0 },
  camBody: { position: 'absolute', left: 1, top: 4.5, width: 16, height: 12, borderRadius: radius.sm / 3, alignItems: 'center', justifyContent: 'center' },
  camLens: { width: 6.5, height: 6.5, borderRadius: radius.full },
  shackle: { position: 'absolute', left: 5, top: 1.5, width: 8, height: 8, borderTopLeftRadius: radius.full, borderTopRightRadius: radius.full, borderBottomWidth: 0 },
  lockBody: { position: 'absolute', left: 2.5, top: 8, width: 13, height: 9, borderRadius: radius.sm / 4 },
  sheetBack: { position: 'absolute', left: 1.5, top: 1.5, width: 11, height: 11, borderRadius: radius.sm / 4 },
  sheetFront: { position: 'absolute', left: 5.5, top: 5.5, width: 11, height: 11, borderRadius: radius.sm / 4 },
  chartBar: { position: 'absolute', bottom: 2.25, width: W, borderRadius: radius.full },
  shareStem: { position: 'absolute', left: 9 - W / 2, top: 2.5, width: W, height: 9, borderRadius: radius.full },
  shareHead: { position: 'absolute', left: 9 - 2.6, top: 2.6, width: 5.2, height: 5.2, borderTopWidth: W, borderLeftWidth: W, transform: [{ rotate: '45deg' }] },
  shareBox: { position: 'absolute', left: 3, top: 8.25, width: 12, height: 7.75, borderTopWidth: 0, borderRadius: radius.sm / 5 },
  shareLip: { position: 'absolute', top: 8.25, width: 2, height: W, borderRadius: radius.full },
  list: { gap: 3.5, alignItems: 'flex-start', paddingLeft: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listDot: { width: 2.5, height: 2.5, borderRadius: radius.full },
  listLine: { width: 12, height: W, borderRadius: radius.full },
});
