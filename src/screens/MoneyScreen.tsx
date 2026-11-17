// 돈 탭(기획 v2 PR 8, 11-cash-flow §3.7 폰): 이번 달 한 줄(들어온 돈·나간 돈·남은 돈) → 받을 돈 → 낼 돈 → 앞으로 30일.
// - 기준 시각과 넣은 자료(계좌 수)를 늘 함께. PC가 꺼져 있으면 "PC에서 마지막으로 받은 값"과 그 시각.
// - 알림 후보는 맨 위 한 줄만(§3.5 문구 그대로). 한 화면에 주의 면은 하나.
// - 자료가 모자라면 0이 아니라 "확인 못 함"과 이유(§3.4). 계좌가 없으면 받을 돈은 세금계산서 기준으로만.
// - 큰 금액은 줄바꿈 없이, 1억이 넘으면 줄여 보이고 누르면 정확한 값.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { clock } from '../chat';
import { alertLine, dueSoon, exactWon, shortWon, unsureLine, type PayableSummary } from '../money';
import { useMoney } from '../moneyStore';
import { useSession } from '../session';
import { radius, space, usePalette, type Ink } from '../theme';
import { Button, Chevron, Empty, Notice, Screen, T } from '../ui/kit';
import type { HomeRoute } from './HomeScreen';

const NB = ' ';

export function MoneyScreen({ go }: { go: (to: HomeRoute) => void }) {
  const s = useSession();
  const m = useMoney();
  const p = usePalette();
  const paired = !!s.data.pair;

  if (!paired) {
    return (
      <Screen title="돈" tabbed scroll={false} testID="money">
        <Empty testID="money-unpaired" title="PC와 연결하면 돈 흐름이 보여요" sub="먼저 이 폰을 PC와 연결해 주세요." action={<Button label="PC 연결하기" onPress={() => go('pair')} />} />
      </Screen>
    );
  }
  if (m.status === 'loading') {
    return (
      <Screen title="돈" tabbed scroll={false} testID="money">
        <View style={st.center} testID="money-loading">
          <ActivityIndicator color={p.ink3} />
          <T v="sub" c="ink2">
            PC에서 돈 요약을 받는 중이에요
          </T>
        </View>
      </Screen>
    );
  }
  if (m.status === 'error') {
    return (
      <Screen title="돈" tabbed scroll={false} testID="money">
        <Empty testID="money-error" title="돈 요약을 받지 못했어요" sub="PC와 연결이 잠깐 끊겼을 수 있어요." action={<Button label="다시 불러오기" onPress={m.reload} testID="money-reload" />} />
      </Screen>
    );
  }
  if (!m.snap) {
    return (
      <Screen title="돈" tabbed scroll={false} testID="money">
        <Empty
          testID="money-none"
          title="PC가 켜지면 돈 요약을 받아 와요"
          sub="한 번 받으면 PC가 꺼져 있어도 마지막 값을 보여 드려요."
          action={<Button kind="secondary" label="연결한 PC 보기" onPress={() => go('connection')} />}
        />
      </Screen>
    );
  }

  const { summary, cashflow, receivables } = m.snap;
  const month = cashflow.month;
  const noAcct = !summary.hasAccounts;
  const unsure = unsureLine(month, cashflow.snapshot.today);
  const alert = !noAcct ? cashflow.alerts[0] : undefined;
  const recvSoon = dueSoon(receivables);
  const n30 = cashflow.snapshot.next30;
  const monthNo = Number(month.month.slice(5, 7));

  return (
    <Screen title="돈" tabbed testID="money">
      {alert && <Notice testID={`money-alert-${alert.kind}`}>{alertLine(alert)}</Notice>}

      <View style={{ gap: space.s2 }}>
        {noAcct ? (
          <View style={[st.card, { backgroundColor: p.tint }]} testID="money-no-account">
            <T v="subStrong">계좌 연결은 PC에서 해요</T>
            <T v="sub" c="ink2">
              연결하면 들어온 돈·나간 돈이 보여요. 지금 받을 돈은 세금계산서 기준이에요.
            </T>
          </View>
        ) : (
          <View style={[st.card, { backgroundColor: p.tint }]} testID="money-month">
            <T v="label" c="ink3">
              {monthNo}월
            </T>
            {/* 세 칸을 나란히 두면 큰 금액·음수가 잘린다: 라벨 왼쪽, 금액 오른쪽 세 줄 */}
            <MonthLine label="들어온 돈" n={unsure ? null : month.cash.in.total} />
            <MonthLine label="나간 돈" n={unsure ? null : month.cash.out.total} />
            <MonthLine label="남은 돈" n={unsure ? null : month.cash.net} strong />
            {unsure && (
              <T v="meta" c="attention" testID="money-unsure">
                {unsure}
              </T>
            )}
          </View>
        )}
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }} testID="money-basis">
          {m.live ? `기준 ${when(m.snap.at)}${noAcct ? '' : ` · 계좌 ${m.snap.accounts}개`}` : `PC에서 마지막으로 받은 값이에요 · ${relWhen(m.snap.at)}`}
        </T>
      </View>

      <SideCard
        testID="money-recv"
        title="받을 돈"
        s={{ unpaidCount: summary.unpaidCount, unpaidTotal: summary.unpaidTotal, overdueCount: summary.overdueCount, overdueTotal: summary.overdueTotal, dueSoonCount: recvSoon.count, dueSoonTotal: recvSoon.total, reviewCount: summary.reviewCount }}
        unpaidWord="안 받음"
        onPress={() => go('recv')}
      />
      <SideCard testID="money-pay" title="낼 돈" s={summary.payable} unpaidWord="안 냄" onPress={() => go('pay')} />

      {!noAcct && (
        <View style={{ gap: space.s2 }}>
          <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
            앞으로 30일
          </T>
          <View style={[st.card, { backgroundColor: p.tint }]} testID="money-next30">
            <Line label="들어올 돈" n={n30.payIn} />
            <Line label="나갈 돈" n={n30.payOut + n30.payOverdue} sub={n30.payOverdue ? `기한 지난 ${exactWon(n30.payOverdue)} 포함` : undefined} />
          </View>
          {(n30.noDuePay > 0 || n30.noDueRecv > 0) && (
            <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }} testID="money-nodue">
              {[n30.noDuePay > 0 && `기한 없는 낼 돈 ${n30.noDuePay}건`, n30.noDueRecv > 0 && `기한 없는 받을 돈 ${n30.noDueRecv}건`].filter(Boolean).join(' · ')}은 넣지 않았어요
            </T>
          )}
        </View>
      )}

      <T v="meta" c="ink4" style={{ paddingHorizontal: space.s1 }}>
        PC가 계산한 값이에요. 세무·회계 의견이 아니에요.
      </T>
    </Screen>
  );
}

/** 이번 달 한 줄: 확인 못 함이면 0 대신 "—" */
function MonthLine({ label, n, strong }: { label: string; n: number | null; strong?: boolean }) {
  return (
    <View style={st.line}>
      <T v={strong ? 'subStrong' : 'sub'} c={strong ? 'ink' : 'ink2'} style={{ flex: 1 }}>
        {label}
      </T>
      {n === null ? (
        <T v="value" c="ink4">
          —
        </T>
      ) : (
        <Amount n={n} v={strong ? 'figure' : 'value'} />
      )}
    </View>
  );
}

/** 받을 돈·낼 돈 카드: 안 받은(안 낸) 합계·건수, 기한 지남(황토 글자), 7일 안. 누르면 목록. */
function SideCard({ title, s, unpaidWord, onPress, testID }: { title: string; s: PayableSummary; unpaidWord: string; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title} ${exactWon(s.unpaidTotal)}, ${s.unpaidCount}건. 목록 보기`} style={({ pressed }) => [st.card, { backgroundColor: pressed ? p.sunken : p.tint }]} testID={testID}>
      <View style={st.head}>
        <T v="subStrong" style={{ flex: 1 }}>
          {title}
        </T>
        <Chevron color={p.ink4} />
      </View>
      <View style={st.big}>
        <Amount n={s.unpaidTotal} v="figure" />
        <T v="sub" c="ink2">{`${s.unpaidCount}건${NB}${unpaidWord}`}</T>
      </View>
      <View style={[st.sep, { backgroundColor: p.line }]} />
      <Line label="기한 지남" n={s.overdueTotal} count={s.overdueCount} ink={s.overdueCount ? 'attention' : 'ink3'} />
      <Line label="7일 안" n={s.dueSoonTotal} count={s.dueSoonCount} />
    </Pressable>
  );
}

function Line({ label, n, count, ink = 'ink', sub }: { label: string; n: number; count?: number; ink?: Ink; sub?: string }) {
  return (
    <View style={st.line}>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="sub" c={ink === 'attention' ? 'attention' : 'ink2'}>
          {count !== undefined ? `${label}${NB}·${NB}${count}건` : label}
        </T>
        {sub && (
          <T v="meta" c="ink3">
            {sub}
          </T>
        )}
      </View>
      <Amount n={n} v="value" ink={ink === 'attention' ? 'attention' : count === 0 ? 'ink3' : 'ink'} />
    </View>
  );
}

/** 금액: 줄바꿈 없이, 1억이 넘으면 줄여 보이고 누르면 정확한 값. */
export function Amount({ n, v = 'value', ink = 'ink' }: { n: number; v?: 'value' | 'figure'; ink?: Ink }) {
  const [exact, setExact] = useState(false);
  const big = Math.abs(n) >= 100_000_000;
  const text = big && !exact ? shortWon(n) : exactWon(n);
  const body = (
    <T v={v} c={ink} lines={1} style={st.nowrap}>
      {text}
    </T>
  );
  if (!big) return body;
  return (
    <Pressable onPress={() => setExact((x) => !x)} accessibilityRole="button" accessibilityLabel={exactWon(n)} accessibilityHint="누르면 정확한 금액을 보여요" hitSlop={8}>
      {body}
    </Pressable>
  );
}

/** "11월 17일 오전 9:10" */
function when(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock(ts)}`;
}
/** "오늘 오전 9:10" · "어제 오후 6:20" · "11월 15일 오후 6:20" */
export function relWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const t = new Date(now);
  if (d.toDateString() === t.toDateString()) return `오늘 ${clock(ts)}`;
  if (new Date(now - 86_400_000).toDateString() === d.toDateString()) return `어제 ${clock(ts)}`;
  return when(ts);
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s3, paddingBottom: space.s7 },
  card: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  big: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.s2 },
  sep: { height: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 32 },
  nowrap: { flexShrink: 0, ...({ whiteSpace: 'nowrap' } as object) },
});
