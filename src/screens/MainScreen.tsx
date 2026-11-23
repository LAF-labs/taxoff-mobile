import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatItem } from '../chat';
import { radius, size, space, usePalette } from '../theme';
import { T, tap } from '../ui/kit';
import type { OfflineChatView } from '../offline/useOfflineChat';
import { HomeScreen, type DraftFields, type HomeRoute, type Todo } from './HomeScreen';
import { MoneyScreen } from './MoneyScreen';
import { RecordsScreen } from './RecordsScreen';
import { IssueSheet, issueCard, type IssueSheetPreview } from './IssueSheet';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { counterpartiesOf } from '../net/pcCopy';
import type { Counterparty } from '../issue';

export type Tab = 'home' | 'money' | 'records';
export type MainRoute = HomeRoute;

const TABS: Array<{ key: Tab; label: string; a11y: string }> = [
  { key: 'home', label: '홈', a11y: '홈, 대화' },
  { key: 'money', label: '돈', a11y: '돈' },
  { key: 'records', label: '기록', a11y: '기록' },
];

export function MainScreen({
  tab, onTab, go, chat, todo, draft, phone, menu, focusAfter, issue: issuePreview, issueCps,
}: { tab: Tab; onTab: (t: Tab) => void; go: (to: MainRoute) => void; chat?: ChatItem[]; todo?: Todo; draft?: string; phone?: OfflineChatView; menu?: boolean; focusAfter?: number; issue?: IssueSheetPreview; issueCps?: Counterparty[] }) {
  const kb = useKeyboardShown();
  const q = useQueue();
  const s = useSession();
  const [issueOpen, setIssueOpen] = useState(!!issuePreview);
  const [draftEdits, setDraftEdits] = useState<ReadonlyMap<string, DraftFields>>(() => new Map());
  const confirmDraft = (id: string, fields: DraftFields) => setDraftEdits((edits) => new Map(edits).set(id, fields));
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
  return (
    <View style={st.fill}>
      <View style={st.fill}>
        {tab === 'home' && <HomeScreen go={goMain} chat={chat} todo={todo} draft={draft} phone={phone} menu={menu} focusAfter={focusAfter} onIssue={() => setIssueOpen(true)} draftEdits={draftEdits} onConfirmDraft={confirmDraft} />}
        {tab === 'money' && <MoneyScreen go={goMain} />}
        {tab === 'records' && <RecordsScreen go={goMain} />}
      </View>
      {(tab === 'home' || !kb) && <TabBar tab={tab} onTab={onTab} />}
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

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  return (
    <View style={[st.bar, { paddingBottom: inset.bottom, backgroundColor: p.canvas, borderTopColor: p.line }]} accessibilityRole="tablist" testID="tabbar">
      {TABS.map((t) => {
        const on = t.key === tab;
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
            style={({ pressed }) => [st.tab, pressed && !on && { opacity: 0.6 }]}
          >
            <T v={on ? 'subStrong' : 'sub'} c={on ? 'ink' : 'ink3'} style={on ? { fontWeight: '600' } : undefined}>
              {t.label}
            </T>
            <View style={[st.mark, { backgroundColor: on ? p.ink : 'transparent' }]} />
          </Pressable>
        );
      })}
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
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: size.row, alignItems: 'center', justifyContent: 'center', gap: space.s1, paddingTop: space.s2 },
  mark: { width: 16, height: 3, borderRadius: radius.full },
});
