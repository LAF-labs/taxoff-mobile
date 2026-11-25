import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ChatItem } from '../chat';
import { usePalette } from '../theme';
import type { OfflineChatView } from '../offline/useOfflineChat';
import { HomeScreen, PcPill, type HomeRoute } from './HomeScreen';
import { MoneyScreen } from './MoneyScreen';
import { RecordsScreen } from './RecordsScreen';
import { CustomersScreen, type CustomersPreview } from './CustomersScreen';
import { InboxScreen } from './InboxScreen';
import { SettingsScreen } from './SettingsScreen';
import { IssueSheet, issueCard, type IssueSheetPreview } from './IssueSheet';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { useCustomers } from '../customers';
import { unreadCount } from '../notify/inbox';
import { showCard } from '../cardFocus';
import type { Counterparty } from '../issue';
import { Shell, type ShellValue } from '../ui/float';
import { Drawer, NavGap, NavPush, NavRow } from '../ui/drawer';
import { Glyph, type GlyphKind } from '../ui/glyph';

/** 더보기 메뉴로 오가는 맨 위 화면. 아래 탭바는 없다(2026-11-24 대표). */
export type Tab = 'home' | 'money' | 'records' | 'customers' | 'inbox' | 'settings';
export type MainRoute = HomeRoute;

const NAV: Array<{ key: Tab; label: string; icon: GlyphKind }> = [
  { key: 'home', label: '대화', icon: 'chat' },
  { key: 'money', label: '돈', icon: 'money' },
  { key: 'records', label: '발급 기록', icon: 'doc' },
  { key: 'customers', label: '거래처', icon: 'building' },
];

export function MainScreen({
  tab, onTab, go, chat, draft, phone, menu, focusAfter, issue: issuePreview, issueCps, drawer: drawerOpen = false, customers: customersPreview,
}: {
  tab: Tab; onTab: (t: Tab) => void; go: (to: MainRoute) => void; chat?: ChatItem[]; draft?: string; phone?: OfflineChatView; menu?: boolean; focusAfter?: number;
  issue?: IssueSheetPreview; issueCps?: Counterparty[]; drawer?: boolean; customers?: CustomersPreview;
}) {
  const p = usePalette();
  const q = useQueue();
  const s = useSession();
  const customers = useCustomers();
  const [drawer, setDrawer] = useState(drawerOpen);
  const [issueOpen, setIssueOpen] = useState(!!issuePreview);
  const unread = unreadCount(s.data.inbox, s.data.inboxSeenAt);
  const goMain = (to: MainRoute) => {
    if (to === 'settings' || to === 'inbox') return onTab(to);
    if (to !== 'issue') return go(to);
    onTab('home');
    setIssueOpen(true);
  };
  useEffect(() => {
    // 거래처 화면에서 등록증을 찍었으면 거래처 화면이 자세히로 연다.
    if (!q.pickId || tab === 'customers') return;
    const cp = customers.counterparties.find((c) => c.id === q.pickId);
    if (!cp) return;
    q.clearPick();
    onTab('home');
    q.addCard(issueCard({ cp }, q.prefill));
    q.setPrefill(null);
  }, [q.pickId, customers.counterparties, tab]);
  const close = useCallback(() => setDrawer(false), []);
  const pick = (t: Tab) => {
    setDrawer(false);
    if (t !== tab) onTab(t);
  };
  const right = s.data.pair ? <PcPill pc={s.pc} lastSeen={s.data.lastSeenPc} onPress={() => go('connection')} /> : null;
  const shell = useMemo<ShellValue>(() => ({ onMenu: () => setDrawer(true), badge: unread > 0, right }), [unread, s.pc, s.data.lastSeenPc, !!s.data.pair]);

  const scene =
    tab === 'home' ? (
      <HomeScreen go={goMain} chat={chat} draft={draft} phone={phone} menu={menu} focusAfter={focusAfter} onIssue={() => setIssueOpen(true)} />
    ) : tab === 'money' ? (
      <MoneyScreen go={goMain} />
    ) : tab === 'records' ? (
      <RecordsScreen go={goMain} />
    ) : tab === 'customers' ? (
      <CustomersScreen
        go={goMain}
        preview={customersPreview}
        onIssue={(cp) => {
          onTab('home');
          q.addCard(issueCard({ cp }));
        }}
      />
    ) : tab === 'inbox' ? (
      <InboxScreen
        onQueue={() => go('queue')}
        onRun={() => go('run')}
        onCard={(id) => {
          onTab('home');
          showCard(id);
        }}
        onMoney={() => onTab('money')}
      />
    ) : (
      <SettingsScreen onConnection={() => go('connection')} onPair={() => go('pair')} onDevices={() => go('devices')} />
    );

  const nav = (
    <>
      {NAV.map((n) => (
        <NavRow key={n.key} testID={`nav-${n.key}`} icon={<Glyph kind={n.icon} size={22} color={n.key === tab ? p.ink : p.ink2} />} label={n.label} on={n.key === tab} onPress={() => pick(n.key)} />
      ))}
      <NavGap />
      <NavRow testID="nav-inbox" icon={<Glyph kind="bell" size={22} color={tab === 'inbox' ? p.ink : p.ink2} />} label="알림함" on={tab === 'inbox'} count={tab === 'inbox' ? 0 : unread} onPress={() => pick('inbox')} />
      <NavPush />
      <NavRow testID="nav-settings" icon={<Glyph kind="settings" size={22} color={tab === 'settings' ? p.ink : p.ink2} />} label="설정" on={tab === 'settings'} onPress={() => pick('settings')} />
    </>
  );

  return (
    <View style={[st.fill, { backgroundColor: p.canvas }]}>
      <Shell.Provider value={shell}>
        <Drawer open={drawer} onClose={close} menu={nav}>
          <View style={[st.fill, { backgroundColor: p.canvas }]}>{scene}</View>
        </Drawer>
      </Shell.Provider>
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
            const pre = q.prefill;
            q.setPrefill(null);
            if (pick.cp) return q.addCard(issueCard(pick, pre));
            // 처음 적은 거래처는 장부에도 넣는다. 저장하지 못해도 카드는 띄우고, 발급은 등록번호로 간다.
            void customers.add({ bizNo: pick.bizNo, name: pick.name }).then((id) => q.addCard(issueCard(id ? { cp: { id, name: pick.name.trim(), bizNo: pick.bizNo, issued: 0 } } : pick, pre)));
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

const st = StyleSheet.create({
  fill: { flex: 1 },
});
