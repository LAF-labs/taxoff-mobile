import type { ReactNode } from 'react';
import { InputAccessoryView, Keyboard, Modal, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, usePalette } from '../theme';
import { Check, T } from './kit';

/**
 * 확정 기준 v3.0(docs/design.md)의 공용 부품: 카드 종류 아이콘, 카드, 단추 한 줄, 시트.
 * 화면은 테두리, 딤, 색 값을 직접 쓰지 않고 이 부품을 쓴다.
 */
export type CardKind = 'doc' | 'amend' | 'cancel' | 'done' | 'failed' | 'check';
export type CardTone = 'quiet' | 'wait' | 'attention';

const ICON = 18;
const LINE = 1.5;

/** 제목 앞 18px 선 아이콘. 그림 라이브러리 없이 면과 선으로 그린다. 취소는 늘 danger, 그 밖은 기본 ink2, 승인 대기 accent, 확인 필요 attention. */
export function CardIcon({ kind, tone = 'quiet' }: { kind: CardKind; tone?: CardTone }) {
  const p = usePalette();
  const color = kind === 'cancel' ? p.danger : tone === 'wait' ? p.accent : tone === 'attention' ? p.attention : p.ink2;
  const ring = { width: ICON - 2, height: ICON - 2, borderRadius: ICON, borderWidth: LINE, borderColor: color, alignItems: 'center' as const, justifyContent: 'center' as const };
  const bar = (rot: string, w = 8) => <View style={{ position: 'absolute', width: w, height: LINE, backgroundColor: color, transform: [{ rotate: rot }] }} />;
  let body: ReactNode;
  if (kind === 'amend') {
    body = (
      <View style={{ width: 5, height: 15, borderWidth: LINE, borderColor: color, borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs, transform: [{ rotate: '45deg' }] }} />
    );
  } else if (kind === 'doc') {
    body = (
      <View style={{ width: 12, height: 15, borderWidth: LINE, borderColor: color, borderRadius: radius.xs, gap: 2.5, paddingTop: 4, alignItems: 'center' }}>
        <View style={{ width: 6, height: LINE, backgroundColor: color }} />
        <View style={{ width: 6, height: LINE, backgroundColor: color }} />
      </View>
    );
  } else if (kind === 'cancel') {
    body = <View style={ring}>{bar('45deg')}{bar('-45deg')}</View>;
  } else if (kind === 'done') {
    body = (
      <View style={ring}>
        <View style={{ width: 7, height: 4, borderLeftWidth: LINE, borderBottomWidth: LINE, borderColor: color, transform: [{ rotate: '-45deg' }], marginTop: -2 }} />
      </View>
    );
  } else {
    body = (
      <View style={[ring, kind === 'check' && { borderRadius: radius.xs, transform: [{ rotate: '0deg' }] }]}>
        <View style={{ width: LINE, height: 5, backgroundColor: color, marginBottom: 1.5 }} />
        <View style={{ width: LINE, height: LINE, backgroundColor: color }} />
      </View>
    );
  }
  return (
    <View style={{ width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
    </View>
  );
}

/** 카드: tint 채움 면 하나, 모서리 lg, 안쪽 20. 머리 줄은 종류 아이콘과 제목. */
export function Card({ kind, tone, title, children, testID }: { kind: CardKind; tone?: CardTone; title: string; children?: ReactNode; testID?: string }) {
  const p = usePalette();
  return (
    <View style={[cst.card, { backgroundColor: p.tint }]} testID={testID}>
      <View style={cst.head}>
        <CardIcon kind={kind} tone={tone} />
        <T v="subStrong" style={{ flexShrink: 1 }} role="header">
          {title}
        </T>
      </View>
      {children}
    </View>
  );
}

/** 단추 한 줄(v3.0): 하나면 가득, 둘이면 반씩, 셋이면 셋이 한 줄을 나눈다. 가장 중요한 단추가 맨 앞. 두 줄로 쌓지 않는다. */
export function Actions({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[cst.actions, style]}>{children}</View>;
}
/** Actions 안의 단추 한 칸 폭(같은 몫). */
export const actionFlex = { flex: 1, paddingHorizontal: space.s2 } as const;

/**
 * 시트(v3.0): 바닥에서 올라오는 overlay 면, 위 모서리 22, 손잡이, 머리 줄 오른쪽 닫기 단추. 닫기 단추와 바깥 누르기로 닫힌다.
 * 바닥 단추 줄은 footer로 넘긴다.
 */
export function Sheet({ title, kind, onClose, children, footer, testID }: { title: string; kind?: CardKind; onClose: () => void; children?: ReactNode; footer?: ReactNode; testID?: string }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} testID={testID}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="닫기" accessibilityRole="button" />
        <View style={[cst.sheet, { backgroundColor: p.overlay, paddingBottom: Math.max(inset.bottom, space.s4) }]} accessibilityViewIsModal>
          <View style={[cst.grab, { backgroundColor: p.sunken }]} />
          <View style={cst.sheetHead}>
            <View style={[cst.head, { flex: 1 }]}>
              {kind && <CardIcon kind={kind} />}
              <T v="subStrong" role="header" style={{ flexShrink: 1 }}>
                {title}
              </T>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={6} style={({ pressed }) => [cst.close, { backgroundColor: pressed ? p.sunken : p.tint }]} testID={testID ? `${testID}-close` : 'sheet-close'}>
              <View style={{ position: 'absolute', width: 13, height: 1.6, backgroundColor: p.ink2, transform: [{ rotate: '45deg' }] }} />
              <View style={{ position: 'absolute', width: 13, height: 1.6, backgroundColor: p.ink2, transform: [{ rotate: '-45deg' }] }} />
            </Pressable>
          </View>
          <View style={cst.sheetBody}>{children}</View>
          {footer && <View style={cst.sheetFoot}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

/**
 * 시트 안 고르기 목록(기준판 "폰 사유 고르기"): 묶음 이름, 두 줄 글 줄(굵지 않은 제목과 아래 한 줄), 고른 줄 끝 체크.
 * 줄을 누르면 onPick. 고른 뒤 닫는 것은 부르는 쪽이 한다.
 */
export function PickRows<V extends string>({ groups, value, onPick, testID }: { groups: ReadonlyArray<{ label?: string; items: ReadonlyArray<{ value: V; label: string; hint?: string }> }>; value: V | null; onPick: (v: V) => void; testID?: string }) {
  const p = usePalette();
  // 어두운 화면에서는 시트 면(overlay)과 tint가 같아 한 단계 밝게
  const face = p.overlay === p.tint ? p.sunken : p.tint;
  return (
    <View style={{ gap: space.s5 }} testID={testID}>
      {groups.map((g, gi) => (
        <View key={gi} style={{ gap: space.s2 }}>
          {g.label && (
            <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              {g.label}
            </T>
          )}
          <View style={[cst.rows, { backgroundColor: face }]} accessibilityRole="radiogroup">
            {g.items.map((x, i) => (
              <Pressable
                key={x.value}
                onPress={() => onPick(x.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: x.value === value }}
                accessibilityLabel={x.hint ? `${x.label}, ${x.hint}` : x.label}
                style={({ pressed }) => [cst.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }, pressed && { backgroundColor: p.overlay === p.tint ? p.tint : p.sunken }]}
                testID={testID ? `${testID}-${x.value}` : undefined}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <T>{x.label}</T>
                  {x.hint && (
                    <T v="meta" c="ink3">
                      {x.hint}
                    </T>
                  )}
                </View>
                {x.value === value && (
                  <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                    <Check color={p.ink} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 숫자 자판 위 [완료] 줄(iOS 숫자 자판에는 완료 키가 없다). 입력 칸은 inputAccessoryViewID={KEYBOARD_DONE_ID}로 붙는다. */
export const KEYBOARD_DONE_ID = 'keyboard-done';
export function KeyboardDone() {
  const p = usePalette();
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID} backgroundColor={p.tint}>
      <View style={cst.doneBar}>
        <Pressable onPress={() => Keyboard.dismiss()} accessibilityRole="button" hitSlop={8} style={cst.doneBtn} testID="keyboard-done">
          <T v="subStrong" c="accent">
            완료
          </T>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const cst = StyleSheet.create({
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.s5, gap: space.s4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  actions: { flexDirection: 'row', gap: space.s2 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: radius.xs, marginBottom: space.s2 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s5, paddingTop: space.s1, gap: space.s3 },
  close: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s4, gap: space.s4 },
  sheetFoot: { paddingHorizontal: space.s5, paddingTop: space.s2 },
  rows: { borderRadius: radius.lg, overflow: 'hidden' },
  doneBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.s4, minHeight: 44, alignItems: 'center' },
  doneBtn: { paddingHorizontal: space.s2, minHeight: 44, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: 14 },
});
