import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, size, space, usePalette } from '../theme';
import { Glyph } from './glyph';
import { Chevron, T, tap } from './kit';

/**
 * 월 리포트 부품(기준판 kit.css "월 리포트", 2026-11-25 대표 승인 Phone-Report, Phone-Report-1y, Phone-Report-Press, Phone-Report-Partner).
 * 리포트 화면은 이것과 card.tsx(Card, Kv, KvRow, Actions), kit의 Seg만 써서 짓는다.
 */

/** 달 넘기기 줄(rp-month-row): ‹ 11월 › 40 단추 둘과 20/700 달, 오른쪽 PDF로 내보내기 40 단추. */
export function MonthStep({ label, prev, next, onPdf, pdfBusy, testID = 'report-month' }: {
  label: string;
  prev: { a11y: string; onPress: (() => void) | null };
  next: { a11y: string; onPress: (() => void) | null };
  /** 없으면 PDF 단추를 두지 않는다(만들 수 없는 기기) */
  onPdf?: () => void;
  pdfBusy?: boolean;
  testID?: string;
}) {
  const p = usePalette();
  const step = (dir: 'left' | 'right', s: typeof prev) => (
    <Pressable
      testID={`${testID}-${dir === 'left' ? 'prev' : 'next'}`}
      accessibilityRole="button"
      accessibilityLabel={s.a11y}
      accessibilityState={{ disabled: !s.onPress }}
      disabled={!s.onPress}
      onPress={() => {
        tap();
        s.onPress?.();
      }}
      style={({ pressed }) => [st.icon, pressed && { opacity: 0.5 }]}
    >
      <Chevron dir={dir} color={s.onPress ? p.ink2 : p.ink4} sizePx={9} />
    </Pressable>
  );
  return (
    <View style={st.monthRow}>
      <View style={st.month}>
        {step('left', prev)}
        <T v="month" style={st.monthText} testID={testID}>
          {label}
        </T>
        {step('right', next)}
      </View>
      {onPdf && (
        <Pressable
          testID="report-pdf"
          accessibilityRole="button"
          accessibilityLabel="PDF로 저장"
          accessibilityState={{ busy: !!pdfBusy }}
          disabled={pdfBusy}
          onPress={onPdf}
          style={({ pressed }) => [st.icon, (pressed || pdfBusy) && { opacity: 0.5 }]}
        >
          <Glyph kind="share" color={p.ink2} size={20} />
        </Pressable>
      )}
    </View>
  );
}

/** 막대 범례(rp-legend): 매출 진한 칸, 매입 옅은 칸. */
export function Legend({ a, b }: { a: string; b: string }) {
  const p = usePalette();
  return (
    <View style={st.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[
        [a, p.ink2],
        [b, p.ink4],
      ].map(([label, color]) => (
        <View key={label} style={st.legendItem}>
          <View style={[st.legendDot, { backgroundColor: color }]} />
          <T v="sub" c="ink2">
            {label}
          </T>
        </View>
      ))}
    </View>
  );
}

export interface TipRow {
  k: string;
  v?: string;
  /** 묶음 머리 줄(굵게) */
  head?: boolean;
  warn?: boolean;
}

/** 말풍선(sx-tip): overlay 면, 모서리 14, 그림자. 제목 한 줄과 라벨 값 줄. */
export function Tip({ title, rows, testID }: { title: string; rows: TipRow[]; testID?: string }) {
  const p = usePalette();
  return (
    <View style={[st.tip, { backgroundColor: p.overlay, shadowColor: p.ink }]} testID={testID} accessibilityRole="summary" pointerEvents="none">
      <T v="subFigure">{title}</T>
      <View style={st.tipRows}>
        {rows.map((r, i) => (
          <View key={i} style={[st.tipRow, r.head && i > 0 && { marginTop: space.s2 }]}>
            <T v={r.head ? 'subFigure' : 'sub'} c={r.head ? 'ink' : 'ink3'}>
              {r.k}
            </T>
            {r.v !== undefined && (
              <T v={r.head ? 'subFigure' : 'subValue'} c={r.warn ? 'attention' : 'ink'}>
                {r.v}
              </T>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface BarCol {
  key: string;
  label: string;
  /** 매출, 매입. null은 막대 없이 */
  a: number | null;
  b: number | null;
  /** 고른 달(굵은 라벨) */
  on?: boolean;
  /** 고른 기간 밖(흐린 막대) */
  out?: boolean;
  a11y: string;
}

const BARS_H = 120;

/**
 * 달마다 막대(rp-chart): 6칸이면 막대 12, 12칸이면 7. 누르면 그 달로(onPick), 누르고 있으면 그 달 말풍선(tip), 떼면 닫힌다.
 * 말풍선은 막대 위, 카드 폭에 맞춰 뜬다(기준판 Phone-Report-Press).
 */
export function BarChart({ cols, onPick, tip, label, testID = 'report-chart', holding = null }: {
  cols: BarCol[]; onPick?: (key: string) => void; tip: (key: string) => ReactNode; label: string; testID?: string;
  /** 갤러리: 처음부터 누르고 있는 칸 */
  holding?: string | null;
}) {
  const p = usePalette();
  const [held, setHeld] = useState<string | null>(holding);
  const dense = cols.length > 6;
  const max = Math.max(1, ...cols.flatMap((c) => [c.a ?? 0, c.b ?? 0]));
  const h = (v: number | null) => Math.max(v ? 2 : 0, Math.round(((v && v > 0 ? v : 0) / max) * BARS_H));
  return (
    <View testID={testID} accessibilityLabel={label}>
      {held && (
        <View style={st.tipAt} pointerEvents="none">
          {tip(held)}
        </View>
      )}
      <View style={[st.chart, dense && { gap: space.s1 }]}>
        {cols.map((c) => (
          <Pressable
            key={c.key}
            testID={`${testID}-${c.key}`}
            accessibilityRole="button"
            accessibilityLabel={c.a11y}
            accessibilityState={{ selected: !!c.on }}
            delayLongPress={250}
            onLongPress={() => {
              tap();
              setHeld(c.key);
            }}
            onPressOut={() => setHeld(null)}
            onPress={() => {
              // 누르고 있다 뗀 것(말풍선)은 onPress가 오지 않는다
              if (c.on || !onPick) return;
              tap();
              onPick(c.key);
            }}
            style={st.col}
          >
            <View style={[st.bars, dense && { gap: 2 }, c.out && held !== c.key && { opacity: 0.35 }]}>
              <View style={[st.bar, dense && st.barDense, { height: h(c.a), backgroundColor: p.ink2 }]} />
              <View style={[st.bar, dense && st.barDense, { height: h(c.b), backgroundColor: p.ink4 }]} />
            </View>
            <T v={c.on ? 'label' : 'meta'} c={c.on || held === c.key ? 'ink' : 'ink3'} style={c.on && st.colOn} lines={1}>
              {c.label}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export interface RankItem {
  key: string;
  name: string;
  amount: string;
  /** 비율 글(34%). 건수 줄이면 없다 */
  pct?: string;
  /** 건수 글(6건). 품목 줄 */
  count?: string;
  /** 0~1, 막대 길이 */
  share: number;
  /** 그 밖에 묶음(흐린 이름) */
  rest?: boolean;
  onPress?: () => void;
}

/** 순위 목록(rp-rank): 이름, 금액, 비율(또는 이름, 건수, 금액), 그 아래 2 높이 비율 막대. 줄 사이 12. */
export function RankRows({ rows, testID }: { rows: RankItem[]; testID?: string }) {
  const p = usePalette();
  return (
    <View style={st.rank} testID={testID}>
      {rows.map((r) => {
        const body = (
          <>
            <View style={st.rankTop}>
              <T v="sub" c={r.rest ? 'ink2' : 'ink'} lines={1} style={st.rankName}>
                {r.name}
              </T>
              {r.count !== undefined && (
                <T v="subValue" c="ink2" style={st.rankCount}>
                  {r.count}
                </T>
              )}
              <T v="subValue" style={st.rankAmount}>
                {r.amount}
              </T>
              {r.pct !== undefined && (
                <T v="subValue" c="ink2" style={st.rankPct}>
                  {r.pct}
                </T>
              )}
            </View>
            <View style={[st.track, { backgroundColor: p.sunken }]}>
              <View style={[st.fill, { width: `${Math.round(Math.min(1, Math.max(0, r.share)) * 100)}%`, backgroundColor: p.ink2 }]} />
            </View>
          </>
        );
        return r.onPress ? (
          <Pressable
            key={r.key}
            testID={testID ? `${testID}-${r.key}` : undefined}
            accessibilityRole="button"
            accessibilityLabel={`${r.name} ${r.amount}${r.pct ? ` ${r.pct}` : ''}`}
            onPress={r.onPress}
            style={({ pressed }) => [st.rankRow, pressed && { opacity: 0.5 }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={r.key} style={st.rankRow} testID={testID ? `${testID}-${r.key}` : undefined} accessible accessibilityLabel={`${r.name} ${r.amount}${r.count ? ` ${r.count}` : ''}${r.pct ? ` ${r.pct}` : ''}`}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flexDirection: 'row', alignItems: 'center', gap: space.s1 },
  monthText: { paddingHorizontal: space.s1 },
  icon: { width: size.buttonSm, height: size.buttonSm, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: space.s4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: radius.xs - 1 },
  // 말풍선 아래 끝이 카드 제목 줄 바로 밑에 온다(기준판: 카드 위에서 60, 막대 위로 24)
  tipAt: { position: 'absolute', left: 0, right: 0, bottom: '100%', paddingBottom: space.s4 + space.s2, zIndex: 5 },
  tip: { gap: space.s2, paddingVertical: space.s3, paddingHorizontal: 14, borderRadius: radius.tip, shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  tipRows: { gap: 2 },
  tipRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s4 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s2 },
  col: { flex: 1, minWidth: 0, alignItems: 'center', gap: space.s2 },
  colOn: { fontWeight: '600' },
  bars: { height: BARS_H, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.s1 },
  bar: { width: 12, borderTopLeftRadius: radius.xs + 1, borderTopRightRadius: radius.xs + 1 },
  barDense: { width: 7 },
  rank: { gap: space.s3 },
  rankRow: { gap: 6 },
  rankTop: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  rankName: { flex: 1, minWidth: 0 },
  rankCount: { width: 36, textAlign: 'right' },
  rankAmount: { textAlign: 'right' },
  rankPct: { width: 44, textAlign: 'right' },
  track: { height: 2, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: 2 },
});
