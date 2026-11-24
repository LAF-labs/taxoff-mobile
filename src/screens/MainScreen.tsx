import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatItem } from '../chat';
import { size, space, usePalette } from '../theme';
import { T, TabInset, TabScroll, tap } from '../ui/kit';
import type { OfflineChatView } from '../offline/useOfflineChat';
import { HomeScreen, type HomeRoute, type Todo } from './HomeScreen';
import { MoneyScreen } from './MoneyScreen';
import { RecordsScreen } from './RecordsScreen';
import { IssueSheet, issueCard, type IssueSheetPreview } from './IssueSheet';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { counterpartiesOf } from '../net/pcCopy';
import type { Counterparty } from '../issue';

export type Tab = 'home' | 'money' | 'records';
export type MainRoute = HomeRoute;

/** 예전 탭바와 같은 높이(줄 52 + 위 여백 8 + 홈 인디케이터)를 차지하게, 알약 60에 인디케이터 쪽 여백을 그만큼 줄인다. */
const BAR_H = 60;
const BAR_LIFT = BAR_H - size.row - space.s2;
const ICON_STROKE = 1.75;
/** 이만큼 넘게 내리면 떠 있는 탭바를 이름 없이 아이콘만 남긴 낮은 막대로 줄이고, 올리면 다시 편다. */
const MINI_STEP = 24;
const BAR_MINI_H = 44;

const TABS: Array<{ key: Tab; label: string; a11y: string }> = [
  { key: 'home', label: '홈', a11y: '홈, 대화' },
  { key: 'money', label: '돈', a11y: '돈' },
  { key: 'records', label: '기록', a11y: '기록' },
];


export function MainScreen({
  tab, onTab, go, chat, todo, draft, phone, menu, focusAfter, issue: issuePreview, issueCps,
}: { tab: Tab; onTab: (t: Tab) => void; go: (to: MainRoute) => void; chat?: ChatItem[]; todo?: Todo; draft?: string; phone?: OfflineChatView; menu?: boolean; focusAfter?: number; issue?: IssueSheetPreview; issueCps?: Counterparty[] }) {
  const kb = useKeyboardShown();
  const p = usePalette();
  const [barH, setBarH] = useState(0);
  const [mini, setMini] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    lastY.current = 0;
    setMini(false);
  }, [tab]);
  const onTabScroll = useCallback((y: number) => {
    const dy = y - lastY.current;
    if (Math.abs(dy) < MINI_STEP) return;
    lastY.current = y;
    const next = y > MINI_STEP && dy > 0;
    setMini((m) => {
      if (m === next) return m;
      LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
      return next;
    });
  }, []);
  const q = useQueue();
  const s = useSession();
  const [issueOpen, setIssueOpen] = useState(!!issuePreview);
  const goMain = (to: MainRoute) => {
    if (to !== 'issue') return go(to);
    onTab('home');
    setIssueOpen(true);
  };
  useEffect(() => {
    if (!q.pickId) return;
    const cp = [...q.counterparties, ...(s.data.pcCopy ? counterpartiesOf(s.data.pcCopy) : [])].find((c) => c.id === q.pickId);
    if (!cp) return;
    q.clearPick();
    onTab('home');
    q.addCard(issueCard({ cp }, q.prefill));
    q.setPrefill(null);
  }, [q.pickId]);
  const scene = (t: Tab) =>
    t === 'home' ? (
      <HomeScreen go={goMain} chat={chat} todo={todo} draft={draft} phone={phone} menu={menu} focusAfter={focusAfter} onIssue={() => setIssueOpen(true)} />
    ) : t === 'money' ? (
      <MoneyScreen go={goMain} />
    ) : (
      <RecordsScreen go={goMain} />
    );
  return (
    <View style={[st.fill, { backgroundColor: p.canvas }]}>
      <TabInset.Provider value={kb ? 0 : barH}>
        <TabScroll.Provider value={onTabScroll}>
          <View style={st.fill}>{scene(tab)}</View>
        </TabScroll.Provider>
      </TabInset.Provider>
      {!kb && <TabBar tab={tab} mini={mini} onTab={onTab} onHeight={setBarH} />}
      {issueOpen && (
        <IssueSheet
          preview={issuePreview}
          counterparties={issueCps}
          onClose={() => {
            setIssueOpen(false);
            q.setPrefill(null);
          }}
          onPick={(pick) => {
            setIssueOpen(false);
            q.addCard(issueCard(pick, q.prefill));
            q.setPrefill(null);
          }}
          onCapture={() => {
            setIssueOpen(false);
            go('bizreg');
          }}
        />
      )}
    </View>
  );
}

function TabBar({ tab, mini, onTab, onHeight }: { tab: Tab; mini: boolean; onTab: (t: Tab) => void; onHeight: (h: number) => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const dark = p.overlay === p.tint;
  return (
    <View
      style={[st.barWrap, { paddingBottom: Math.max(inset.bottom - BAR_LIFT, space.s2) }]}
      pointerEvents="box-none"
      // 줄어든 높이는 화면 여백에 넣지 않는다: 여백이 바뀌면 목록이 밀려 스크롤이 거꾸로 읽히고 탭바가 다시 펴진다.
      onLayout={(e) => !mini && onHeight(e.nativeEvent.layout.height)}
    >
      <View style={[st.bar, mini && st.barMini, { backgroundColor: p.overlay, borderColor: p.line, shadowColor: p.ink }]} accessibilityRole="tablist" testID="tabbar">
        {TABS.map((t) => {
          const on = t.key === tab;
          const ink = on ? p.ink : p.ink3;
          return (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              accessibilityRole="tab"
              accessibilityLabel={t.a11y}
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (on) return;
                tap();
                onTab(t.key);
              }}
              style={({ pressed }) => [st.tab, on && { backgroundColor: dark ? p.sunken : p.tint }, pressed && !on && { opacity: 0.6 }]}
            >
              <TabIcon kind={t.key} color={ink} />
              {!mini && (
                <T v="meta" c={on ? 'ink' : 'ink3'} style={on ? st.labelOn : st.label}>
                  {t.label}
                </T>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** PC 레일과 같은 그림(대화 말풍선, 돈 지폐, 기록 목록)을 선으로 그린다. */
function TabIcon({ kind, color }: { kind: Tab; color: string }) {
  const line = { borderColor: color, borderWidth: ICON_STROKE };
  if (kind === 'home') {
    return (
      <View style={st.icon} aria-hidden>
        <View style={[st.bubble, line]} />
        <View style={[st.tail, { borderTopColor: color }]} />
      </View>
    );
  }
  if (kind === 'money') {
    return (
      <View style={st.icon} aria-hidden>
        <View style={[st.bill, line]}>
          <View style={[st.coin, line]} />
        </View>
      </View>
    );
  }
  return (
    <View style={[st.icon, st.list]} aria-hidden>
      {[0, 1, 2].map((i) => (
        <View key={i} style={st.listRow}>
          <View style={[st.listDot, { backgroundColor: color }]} />
          <View style={[st.listLine, { backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const off = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      on.remove();
      off.remove();
    };
  }, []);
  return shown;
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  barMini: { height: BAR_MINI_H, borderRadius: BAR_MINI_H / 2 },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.s4 },
  bar: { flexDirection: 'row', height: BAR_H, padding: 4, borderRadius: BAR_H / 2, borderWidth: StyleSheet.hairlineWidth, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  tab: { flex: 1, borderRadius: (BAR_H - 8) / 2, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 12, lineHeight: 14, fontWeight: '500' },
  labelOn: { fontSize: 12, lineHeight: 14, fontWeight: '600' },
  icon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  bubble: { width: 19, height: 15, borderRadius: 4, marginBottom: 3 },
  tail: { position: 'absolute', left: 5, bottom: 1, width: 0, height: 0, borderTopWidth: 5, borderRightWidth: 5, borderRightColor: 'transparent' },
  bill: { width: 21, height: 14, borderRadius: 2.5, alignItems: 'center', justifyContent: 'center' },
  coin: { width: 7, height: 7, borderRadius: 3.5 },
  list: { gap: 3.5, alignItems: 'flex-start', paddingLeft: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listDot: { width: 2.5, height: 2.5, borderRadius: 1.25 },
  listLine: { width: 14, height: ICON_STROKE, borderRadius: 1 },
});
