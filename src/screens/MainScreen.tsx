// 앱 틀(기획 v2): 아래 탭 셋 — 홈(대화) · 돈 · 기록. 설정은 홈 오른쪽 위.
// 탭 줄은 글자만 쓴다(아이콘 묶음을 들이지 않는다). 고른 탭은 ink 600 + 밑 막대, 나머지는 ink3.
// 키보드가 올라오면 탭 줄을 숨겨 입력 줄이 키보드 바로 위에 오게 한다.
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatItem } from '../chat';
import { radius, size, space, usePalette } from '../theme';
import { T, tap } from '../ui/kit';
import type { OfflineChatView } from '../offline/useOfflineChat';
import { HomeScreen, type HomeRoute, type Todo } from './HomeScreen';
import { MoneyScreen } from './MoneyScreen';
import { RecordsScreen } from './RecordsScreen';

export type Tab = 'home' | 'money' | 'records';
export type MainRoute = HomeRoute;

const TABS: Array<{ key: Tab; label: string; a11y: string }> = [
  { key: 'home', label: '홈', a11y: '홈, 대화' },
  { key: 'money', label: '돈', a11y: '돈' },
  { key: 'records', label: '기록', a11y: '기록' },
];

export function MainScreen({
  tab, onTab, go, chat, todo, draft, phone,
}: { tab: Tab; onTab: (t: Tab) => void; go: (to: MainRoute) => void; chat?: ChatItem[]; todo?: Todo; draft?: string; phone?: OfflineChatView }) {
  const kb = useKeyboardShown();
  return (
    <View style={st.fill}>
      <View style={st.fill}>
        {tab === 'home' && <HomeScreen go={go} chat={chat} todo={todo} draft={draft} phone={phone} />}
        {tab === 'money' && <MoneyScreen go={go} />}
        {tab === 'records' && <RecordsScreen go={go} />}
      </View>
      {!kb && <TabBar tab={tab} onTab={onTab} />}
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
