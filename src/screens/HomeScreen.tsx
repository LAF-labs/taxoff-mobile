import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import { AccessibilityInfo, Animated, Easing, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ReplyGlyph, SwipeReply } from '../ui/SwipeReply';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bubbleGroup, chatFromData, clockRange, stampBefore, stateOf, type ChatCard, type ChatItem } from '../chat';
import { useOfflineChat, type OfflineChatView, type ReplyTo } from '../offline/useOfflineChat';
import type { PhoneScreen, ReactionId } from '@sax/chat-core';
import { BRAND } from '../config';
import { useQueue, type DraftEdit } from '../queueStore';
import { RunCard } from './RunCard';
import { Actions, AmountEdit, Card as ShownCard, CardInput, Kv, KvRow } from '../ui/card';
import { useCustomers } from '../customers';
import { useIssueSubmit, type IssueSubmit } from '../issueSubmit';
import { useEntrustAmend } from '../entrust';
import { AmendCard, type AmendIssue } from './AmendCard';
import type { AmendCard as AmendState } from '@sax/chat-core';
import { onShowCard, shownCard } from '../cardFocus';
import { splitAmount, type Counterparty, type VatMode } from '../issue';
import { masked } from '../ui/field';
import { PhotoSlot } from '../ui/PhotoSlot';
import { jpegUri } from '../capture/thumb';
import { useSession } from '../session';
import type { PcStatus } from '../net/pc';
import { MAX_FONT_SCALE, TextSizeContext, radius, size, space, textScale, type, usePalette, useReducedMotion } from '../theme';
import { Button, Check, Chevron, Pill, Seg, T, ago, success, tap, won, type Tone } from '../ui/kit';
import { CAPSULE_SIDE, Capsule, DOWN_GAP, DownButton, FloatPill, ShellTop, TOP_SPACE, useKeyboardShown } from '../ui/float';

export type HomeRoute = 'pair' | 'capture' | 'cash' | 'connection' | 'settings' | 'devices' | 'issue' | 'queue' | 'inbox' | 'run' | 'doc' | 'bizreg' | 'recv' | 'pay' | 'mark';

export function pcLine(pc: PcStatus, lastSeen: number | null): { tone: Tone; label: string; sub?: string; busy?: boolean } {
  switch (pc) {
    case 'online':
      return { tone: 'accent', label: 'PC 켜짐' };
    case 'connecting':
      return { tone: 'quiet', label: 'PC 찾는 중', busy: true };
    case 'stale':
    case 'relink':
      return { tone: 'attention', label: '다시 연결 필요' };
    case 'unpaired':
      return { tone: 'quiet', label: 'PC와 연결 전' };
    default:
      return { tone: 'quiet', label: 'PC 꺼짐', sub: lastSeen ? ago(lastSeen) : undefined };
  }
}

/** 오른쪽 위에 떠 있는 PC 상태 알약. 누르면 PC 연결 화면. */
export function PcPill({ pc, lastSeen, onPress }: { pc: PcStatus; lastSeen: number | null; onPress: () => void }) {
  const p = usePalette();
  const l = pcLine(pc, lastSeen);
  const warn = l.tone === 'attention';
  return (
    <FloatPill testID="pc-status" label={`${l.label}${l.sub ? `, ${l.sub}` : ''}. 연결 상태 보기`} warn={warn} onPress={onPress}>
      <View style={[st.pcDot, l.tone === 'accent' ? { backgroundColor: p.accent } : warn ? { backgroundColor: p.attention } : { borderWidth: 1.5, borderColor: p.ink3 }]} />
      <T v="subStrong" c={warn ? 'attention' : 'ink'}>
        {l.label}
      </T>
      {l.sub && (
        <T v="sub" c="ink3">
          {l.sub}
        </T>
      )}
    </FloatPill>
  );
}

/** 이 폰의 연결이 풀렸을 때 대화 끝에 한 번 보이는 카드. */
function RelinkCard({ onRelink }: { onRelink: () => void }) {
  return (
    <View style={st.relink}>
      <ShownCard kind="check" tone="attention" title="PC와 연결이 풀렸어요" testID="relink-card">
        <T v="sub" c="ink2">
          부탁은 이 폰에 두었어요. 다시 연결하면 바로 보낼게요.
        </T>
        <Actions>
          <Button testID="relink" label="다시 연결" onPress={onRelink} />
        </Actions>
      </ShownCard>
    </View>
  );
}

const FOLLOW_PX = 80;
const KEEP_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: FOLLOW_PX } as const;
const SHOW_END_PX = 160;

export function HomeScreen({ go, chat, draft = '', phone, menu: menuOpen = false, focusAfter, onIssue }: { go: (to: HomeRoute) => void; onIssue?: () => void; chat?: ChatItem[]; draft?: string; phone?: OfflineChatView; menu?: boolean; focusAfter?: number }) {
  const s = useSession();
  const p = usePalette();
  useContext(TextSizeContext);
  const paired = !!s.data.pair;
  const q = useQueue();
  const inset = useSafeAreaInsets();
  const kb = useKeyboardShown();
  /** 떠 있는 더보기와 PC 상태 밑으로 대화 맨 위 글이 숨지 않게 둔 여백. */
  const topPad = inset.top + TOP_SPACE;
  const [mine, setMine] = useState<ChatItem[]>([]);
  const [text, setText] = useState(draft);
  /** iOS 여러 줄 입력칸은 값을 비워도 높이가 줄지 않는다. 보낼 때 새로 만들어 한 줄로 돌린다. */
  const [inputKey, setInputKey] = useState(0);
  const [menu, setMenu] = useState(menuOpen);
  const [held, setHeld] = useState<Held | null>(null);
  const [replying, setReplying] = useState<ReplyTo | null>(null);
  const startReply = (r: ReplyTo) => {
    setReplying({ id: r.id, text: r.text, mine: r.mine });
    input.current?.focus();
  };
  const quick = (to: HomeRoute) => {
    setMenu(false);
    go(to);
  };
  const submitIssue = useIssueSubmit();
  const customers = useCustomers();
  const cpOf = (id: string): Counterparty | null => (id ? (customers.counterparties.find((c) => c.id === id) ?? null) : null);
  const issueFrom = async (d: Draft, itemId: string): Promise<IssueSubmit> => {
    const cp = cpOf(d.counterpartyId) ?? (d.phone?.bizNo ? { id: '', name: d.phone.name, bizNo: d.phone.bizNo, issued: 0 } : null);
    if (!d.phone && !cp) {
      q.setPrefill({ amount: d.amount, vat: d.vat, item: d.item, draftId: d.id });
      go('issue');
      return 'sent';
    }
    const a = splitAmount(d.amount, d.vat === 'included' ? 'incl' : 'excl');
    if (a.supply <= 0) return 'sent';
    const sent = await submitIssue({ cp, item: d.item ?? '', a, draftId: d.phone ? d.phone.draftId : d.id });
    if (sent === 'sent' && d.phone) q.markSent(itemId);
    return sent;
  };
  const entrustAmend = useEntrustAmend();
  const amendFrom = (it: Extract<ChatItem, { kind: 'msg' }>) => ({
    change: (c: AmendState) => void offline.update?.({ ...it, card: { ...it.card!, amend: { id: it.card!.amend!.id, card: c } } }),
    issue: async (c: AmendState): Promise<AmendIssue> => {
      if (!(await entrustAmend(c))) return 'save_failed';
      await offline.update?.({ ...it, card: { ...it.card!, amend: { id: it.card!.amend!.id, card: c }, sent: true } });
      return 'sent';
    },
  });
  const list = useRef<FlatList<ChatItem>>(null);
  const [barH, setBarH] = useState(0);
  const y = useRef(0);
  const [endBtn, setEndBtn] = useState<null | 'end' | 'new'>(null);
  const endRef = useRef<null | 'end' | 'new'>(null);
  const setEnd = (v: null | 'end' | 'new') => {
    if (endRef.current === v) return;
    endRef.current = v;
    setEndBtn(v);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = Math.max(0, e.nativeEvent.contentOffset.y);
    if (y.current <= FOLLOW_PX) setEnd(null);
    else if (y.current > SHOW_END_PX && endRef.current === null) setEnd('end');
  };
  const toEnd = () => {
    setEnd(null);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  const webNode = () => (Platform.OS === 'web' ? (list.current?.getScrollableNode?.() as HTMLElement | undefined) : undefined);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  const catchAnchor = () => {
    const node = webNode();
    if (!node || y.current <= FOLLOW_PX) return null;
    node.style.overflowAnchor = 'none';
    const b = node.getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el && node.contains(el) ? { el, top: el.getBoundingClientRect().top } : null;
  };
  const holdAnchor = () => {
    const node = webNode();
    const a = anchor.current;
    anchor.current = null;
    if (!node || !a || !a.el.isConnected) return;
    for (let k = 0; k < 2; k++) {
      const drift = a.el.getBoundingClientRect().top - a.top;
      if (Math.abs(drift) < 0.5) break;
      const before = node.scrollTop;
      node.scrollTop = before - drift;
      if (Math.abs(a.el.getBoundingClientRect().top - a.top) > Math.abs(drift)) node.scrollTop = before + drift;
    }
    y.current = node.scrollTop;
  };
  const off = s.pc === 'offline' || s.pc === 'queued';
  const relink = s.pc === 'stale' || s.pc === 'relink';
  const pcOff = off || relink;

  const live = useOfflineChat();
  const offline = phone ?? live;
  const canSend = offline.available;
  const phoneAnswers = pcOff && canSend;
  const carded = new Set(q.notes.flatMap((n) => (n.kind === 'run' ? [n.jobId] : [])));
  const cmdRuns: ChatItem[] = q.jobs
    .filter((j) => j.id.startsWith('cmd-') && j.run && !carded.has(j.id))
    .map((j) => ({ kind: 'run', id: `run-${j.id}`, at: j.createdAt, jobId: j.id }));
  const items = [...(chat ?? chatFromData(s.data)), ...q.notes, ...cmdRuns, ...mine, ...(chat && !phone ? [] : offline.items)].sort((a, b) => at(a) - at(b));
  const data = [...items].reverse();
  const last = items.at(-1);
  const lastId = last?.id ?? '';
  const seen = useRef<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(
    () =>
      onShowCard((id) => {
        const index = dataRef.current.findIndex((it) => it.kind === 'run' && it.jobId === id);
        if (index < 0) return;
        shownCard(id);
        setEnd(null);
        requestAnimationFrame(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }));
      }),
    [],
  );
  if (Platform.OS === 'web' && seen.current !== null && seen.current !== lastId && !anchor.current) anchor.current = catchAnchor();
  useLayoutEffect(() => holdAnchor());
  useEffect(() => {
    const prev = seen.current;
    seen.current = lastId;
    if (prev === null || prev === lastId || !last) return;
    if (last.kind === 'msg' && last.from === 'me') toEnd();
    else if (y.current > FOLLOW_PX) setEnd('new');
  }, [lastId]);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (focusAfter === undefined) return;
    const a = setTimeout(() => input.current?.focus(), focusAfter);
    const b = setTimeout(() => input.current?.blur(), focusAfter + 3000);
    return () => (clearTimeout(a), clearTimeout(b));
  }, [focusAfter]);
  const pick = (v: string) => {
    setText(v);
    input.current?.focus();
  };
  const send = () => {
    const v = text.trim();
    if (!v || offline.busy) return;
    setText('');
    setInputKey((k) => k + 1);
    if (canSend) {
      void offline.send(v, replying);
      setReplying(null);
      return;
    }
    const now = Date.now();
    setMine((m) => [
      ...m,
      { kind: 'msg', id: `me-${now}`, from: 'me', at: now, text: v, state: 'failed' },
      { kind: 'note', id: `me-note-${now}`, at: now + 1, text: CANT_SEND_TEXT, failed: {} },
    ]);
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID="home">
      {}
      <KeyboardAvoidingView style={st.fill} behavior="translate-with-padding">
        <View style={st.fill}>
        {!paired || items.length === 0 ? (
          <ScrollView style={st.fill} contentContainerStyle={[st.chat, { paddingTop: topPad }, !paired ? { justifyContent: 'center' } : { paddingBottom: space.s4 + barH }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" testID="chat">
            {!paired ? <Intro onPair={() => go('pair')} /> : relink ? <RelinkCard onRelink={() => go('pair')} /> : <Starter phoneAnswers={phoneAnswers} onPick={pick} />}
          </ScrollView>
        ) : (
          <FlatList
            ref={list}
            data={data}
            inverted
            keyExtractor={(it) => it.id}
            onScrollToIndexFailed={(e) => list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true })}
            maintainVisibleContentPosition={KEEP_POSITION}
            style={st.fill}
            contentContainerStyle={[st.list, { paddingTop: space.s4 + barH, paddingBottom: topPad }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
            scrollEventThrottle={16}
            initialNumToRender={10}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={100}
            windowSize={10}
            testID="chat"
            ListHeaderComponent={
              <View style={st.listEnd}>
          {paired && relink && <RelinkCard onRelink={() => go('pair')} />}
          {paired && canSend && offline.busy && <Typing />}
          {paired && canSend && !offline.busy && offline.chips.length > 0 && (
            <View style={st.replies} testID="chat-chips">
              {offline.chips.map((c) => (
                <Chip key={c.label} label={c.label} onPress={() => void offline.send(c.text)} />
              ))}
            </View>
          )}
          {paired && canSend && !offline.busy && (offline.screens?.length ?? 0) > 0 && (
            <View style={st.replies} testID="chat-screens">
              {offline.screens!.map((x) => (
                <Button key={x} kind="secondary" small label={SCREEN_LABEL[x]} onPress={() => go(x)} testID={`chat-open-${x}`} />
              ))}
            </View>
          )}
              </View>
            }
            renderItem={({ item: it, index }) => {
              const i = items.length - 1 - index;
              const stamp = stampBefore(items, i);
              return (
                <View style={st.row}>
                  {stamp !== null && <Stamp text={stamp} first={i === 0} />}
                  {it.kind === 'run' ? (
                    <RunItem jobId={it.jobId} go={go} />
                  ) : (
                    <Item it={it} group={bubbleGroup(items, i)} onRetry={(id) => void offline.retry(id)} retryOff={offline.busy} openDrafts={offline.openDrafts} onIssue={issueFrom} onAmend={offline.update ? amendFrom : undefined} cpOf={cpOf} stale={s.pc === 'stale'} onHold={setHeld} onReply={canSend ? startReply : undefined} />
                  )}
                </View>
              );
            }}
          />
        )}
        <ShellTop />
        {endBtn && <NewReply fresh={endBtn === 'new'} onPress={toEnd} lift={barH - space.s4 + DOWN_GAP} />}

        {paired && (
          <View style={[st.bottom, { paddingBottom: kb ? space.s2 : inset.bottom + space.s1 }]} onLayout={(e) => setBarH(e.nativeEvent.layout.height)}>
            <BottomFade />
            {menu && (
              <View style={[st.menu, { backgroundColor: p.tint }]} testID="quick-menu">
                <MenuRow
                  label="세금계산서 발급"
                  hint="거래처를 고르면 바로 써 드려요"
                  onPress={() => {
                    if (!onIssue) return quick('issue');
                    setMenu(false);
                    onIssue();
                  }}
                  testID="chip-issue"
                />
                <MenuRow label="증빙 찍기" hint="영수증이나 종이 세금계산서를 찍어 PC로 보내요" onPress={() => quick('capture')} testID="go-capture" />
                <MenuRow label="현금 매출 적기" hint="현금으로 받은 돈을 적어 둬요" onPress={() => quick('cash')} testID="go-cash" />
              </View>
            )}
            {replying && (
              <View style={[st.replyBar, { backgroundColor: p.tint }]} testID="chat-replying">
                <View style={{ flex: 1 }}>
                  <T v="meta" c="ink2">
                    {replying.mine ? '내 말에 답장' : '답장'}
                  </T>
                  <T v="sub" c="ink3" lines={1}>
                    {replying.text}
                  </T>
                </View>
                <Pressable testID="chat-reply-cancel" accessibilityRole="button" accessibilityLabel="답장 그만두기" hitSlop={8} onPress={() => setReplying(null)} style={st.replyX}>
                  <Plus color={p.ink3} open />
                </Pressable>
              </View>
            )}
            <Capsule testID="chat-composer">
              <Pressable
                testID="chat-plus"
                accessibilityRole="button"
                accessibilityLabel={menu ? '빠른 일 닫기' : '빠른 일 열기'}
                accessibilityState={{ expanded: menu }}
                hitSlop={4}
                onPress={() => {
                  tap();
                  setMenu((m) => !m);
                }}
                style={({ pressed }) => [st.plus, (pressed || menu) && { backgroundColor: p.tint }]}
              >
                <Plus color={p.ink} open={menu} />
              </Pressable>
              <TextInput
                key={inputKey}
                autoFocus={inputKey > 0 && kb}
                ref={input}
                testID="chat-input"
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  if (endRef.current) toEnd();
                }}
                onFocus={() => {
                  setMenu(false);
                  toEnd();
                }}
                placeholder="궁금한 것이나 시킬 일"
                placeholderTextColor={p.ink3}
                accessibilityLabel="궁금한 것이나 시킬 일 적기"
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                multiline
                rows={Platform.OS === 'web' ? 1 : undefined}
                onSubmitEditing={send}
                style={[
                  type.body,
                  textScale.web !== 1 && { fontSize: type.body.fontSize * textScale.web, lineHeight: type.body.lineHeight * textScale.web },
                  st.input,
                  { color: p.ink },
                ]}
              />
              <SendButton onPress={send} disabled={!text.trim() || offline.busy} />
            </Capsule>
          </View>
        )}
        </View>
      </KeyboardAvoidingView>
      {held && (
        <HoldOverlay
          held={held}
          onClose={() => setHeld(null)}
          onReact={
            held.replyable && offline.react
              ? (emoji) => {
                  tap();
                  void offline.react!(held.id, emoji === held.myReaction ? null : emoji);
                  setHeld(null);
                }
              : undefined
          }
          onReply={
            canSend && held.replyable
              ? () => {
                  startReply(held);
                  setHeld(null);
                }
              : undefined
          }
          onCopy={() => {
            void Clipboard.setStringAsync(held.text).then(success);
            setHeld(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

export interface Held {
  id: string;
  text: string;
  mine: boolean;
  replyable: boolean;
  myReaction?: string;
  rect: { x: number; y: number; w: number; h: number };
  corners: Record<string, number>;
}

const PICKS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const BAR_H = 52;
const ROW_H = 48;

function HoldOverlay({ held, onClose, onReact, onReply, onCopy }: { held: Held; onClose: () => void; onReact?: (emoji: string) => void; onReply?: () => void; onCopy: () => void }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const r = held.rect;
  const rows = onReply ? 2 : 1;
  const menuH = rows * ROW_H + space.s2;
  const top = r.y - (onReact ? BAR_H + space.s2 : 0);
  const bottom = r.y + r.h + space.s2 + menuH;
  const over = Math.max(0, bottom - (height - inset.bottom - space.s3));
  const shift = Math.min(over, Math.max(0, top - inset.top - space.s3));
  const side = held.mine ? { right: Math.max(space.s3, width - r.x - r.w) } : { left: r.x };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} testID="hold-sheet">
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.dim }]} onPress={onClose} accessibilityLabel="닫기" accessibilityRole="button" />
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { transform: [{ translateY: -shift }] }]}>
          {onReact && (
            <View style={[st.pickBar, { top: top, backgroundColor: p.overlay }, side]} testID="hold-react">
              {PICKS.map((e) => (
                <Pressable key={e} accessibilityRole="button" accessibilityLabel={`${e} 달기`} onPress={() => onReact(e)} style={[st.pick, held.myReaction === e && { backgroundColor: p.sunken }]}>
                  <Text style={st.pickGlyph}>{e}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View pointerEvents="none" style={[st.bubble, st.lifted, { position: 'absolute', top: r.y, left: r.x, width: r.w, backgroundColor: held.mine ? p.bubbleMe : p.bubbleThem }, held.corners]}>
            <T style={held.mine ? { color: p.onBubbleMe } : undefined}>{held.text}</T>
          </View>
          <View style={[st.holdMenu, { top: r.y + r.h + space.s2, backgroundColor: p.overlay }, side]}>
            {onReply && <HoldRow icon={<ReplyGlyph color={p.ink} />} label="답장" onPress={onReply} testID="hold-reply" />}
            <HoldRow icon={<CopyGlyph color={p.ink} />} label="복사" onPress={onCopy} testID="hold-copy" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CopyGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 3, borderWidth: 2, borderColor: color }} />
      <View style={{ position: 'absolute', left: 5, top: 5, width: 12, height: 12, borderRadius: 3, borderWidth: 2, borderColor: color }} />
    </View>
  );
}

function HoldRow({ icon, label, onPress, testID }: { icon: React.ReactNode; label: string; onPress: () => void; testID: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st.holdRow, pressed && { backgroundColor: p.sunken }]}>
      <View style={st.holdIcon}>{icon}</View>
      <T>{label}</T>
    </Pressable>
  );
}

const FADE = Array.from({ length: 10 }, (_, i) => Number(((1 - i / 10) ** 1.6).toFixed(2)));
function BottomFade() {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[...FADE].reverse().map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: p.canvas, opacity: o * 0.94 }} />
      ))}
      <View style={{ flex: 1, backgroundColor: p.canvas, opacity: 0.94 }} />
    </View>
  );
}

function NewReply({ fresh, onPress, lift }: { fresh: boolean; onPress: () => void; lift: number }) {
  const p = usePalette();
  const still = useReducedMotion();
  const a = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.timing(a, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, still]);
  return (
    <Animated.View pointerEvents="box-none" style={[st.newReplyWrap, { bottom: lift, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      <DownButton
        testID="chat-new-reply"
        label={fresh ? '새 답 보기' : '맨 아래로'}
        wide={fresh}
        onPress={() => {
          tap();
          onPress();
        }}
      >
        <View style={{ marginTop: -3 }}>
          <Chevron color={p.ink} dir="down" sizePx={7} />
        </View>
        {fresh && <T v="label">새 답</T>}
      </DownButton>
    </Animated.View>
  );
}

const SCREEN_LABEL: Record<PhoneScreen, string> = { capture: '증빙 찍기', cash: '현금 매출 적기', bizreg: '사업자등록증 찍기', issue: '세금계산서 발급' };

const CANT_SEND_TEXT = '이 폰에서는 아직 대화를 보낼 수 없어요. 앱을 다시 열거나 설정에서 PC 연결을 확인해 주세요.';

const at = (it: ChatItem) => (it.kind === 'merged' ? it.from : it.at);

function Intro({ onPair }: { onPair: () => void }) {
  return (
    <ShownCard title="먼저 PC와 연결해 주세요" testID="unpaired">
      <T v="sub" c="ink2">
        PC의 {BRAND} → 설정 → 기기{'\u00A0'}연결에서 [폰{'\u00A0'}연결]을 누르면 뜨는 QR을 이 폰으로 찍으면 돼요. 한 번만 하면 돼요.
      </T>
      <T v="sub" c="ink2">
        연결하면 여기서 PC에 일을 시키고, 종이 증빙을 찍고, 현금 매출을 적을 수 있어요.
      </T>
      <Actions>
        <Button testID="go-pair" label="PC와 연결" onPress={onPair} />
      </Actions>
    </ShownCard>
  );
}

function RunItem({ jobId, go }: { jobId: string; go: (to: HomeRoute) => void }) {
  const q = useQueue();
  const job = q.jobs.find((j) => j.id === jobId);
  if (!job?.run) return null;
  const open = (to: 'run' | 'doc') => {
    q.setFocus(job.id);
    go(to);
  };
  return (
    <RunCard
      job={job}
      compact
      onOpen={() => open('run')}
      onAction={(a) => q.runAction(job.id, a)}
      onApprove={() => q.openSheet(job.id)}
    />
  );
}

function Item({ it, group, onRetry, retryOff, openDrafts, onIssue, onAmend, cpOf, stale, onHold, onReply }: { it: Exclude<ChatItem, { kind: 'run' }>; group: { first: boolean; last: boolean }; onRetry: (noteId: string) => void; retryOff?: boolean; openDrafts?: ReadonlySet<string>; onIssue: OnIssue; onAmend?: OnAmend; cpOf: (id: string) => Counterparty | null; stale: boolean; onHold: (h: Held) => void; onReply?: (r: ReplyTo) => void }) {
  const p = usePalette();
  const q = useQueue();
  const bubble = useRef<ComponentRef<typeof Pressable>>(null);
  if (it.kind === 'merged') {
    return (
      <View style={st.mergedWrap} testID="chat-merged">
        <View style={[st.merged, { backgroundColor: p.tint }]}>
          <T v="meta" c="ink3" center>
            폰에서 나눈 대화 {clockRange(it.from, it.to)}
          </T>
        </View>
      </View>
    );
  }
  if (it.kind === 'note' && it.failed) {
    return (
      <View style={[st.failed, { backgroundColor: p.tint }]} testID="chat-failed">
        <T v="sub" c="ink2">
          {it.text}
        </T>
        {it.failed.retry !== undefined && (
          <View style={{ flexDirection: 'row' }}>
            <Pill testID="chat-retry" label="다시 보내기" onPress={() => !retryOff && onRetry(it.id)} />
          </View>
        )}
      </View>
    );
  }
  if (it.kind === 'note') {
    return (
      <View style={st.note} testID="chat-note">
        <View style={{ paddingTop: 8 }}>
          <Check color={p.ink3} />
        </View>
        <T v="sub" c="ink2" style={{ flex: 1 }}>
          {it.text}
        </T>
      </View>
    );
  }
  const me = it.from === 'me';
  const state = stateOf(it);
  const side = me ? 'Right' : 'Left';
  const corners = { [`borderTop${side}Radius`]: group.first ? 22 : 6, [`borderBottom${side}Radius`]: group.last ? 22 : 6 };
  const replyable = it.via === 'phone' || (me && !it.state);
  return (
    <View style={[st.msg, !group.first && st.follow, me ? st.mine : st.theirs]} testID={`chat-${it.from}`}>
      {it.text !== undefined && it.replyTo && (
        <View style={[st.replyCtx, { backgroundColor: p.bubbleThem }, me ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }]} testID="chat-reply-context">
          <T v="meta" c="ink2" lines={1}>
            {it.replyTo.text}
          </T>
        </View>
      )}
      {it.text !== undefined && (
        <SwipeReply enabled={!!onReply && replyable} onReply={() => onReply?.({ id: it.id, text: it.text!, mine: me })}>
          <View style={me ? st.mine : st.theirs}>
            <Pressable
              ref={bubble}
              onLongPress={() => {
                tap();
                bubble.current?.measureInWindow((x, y, w, h) => onHold({ id: it.id, text: it.text!, mine: me, replyable, myReaction: it.myReaction, rect: { x, y, w, h }, corners }));
              }}
              delayLongPress={350}
              accessibilityRole="text"
              accessibilityHint="꾹 누르면 답장이나 복사를 할 수 있어요"
              style={[st.bubble, { backgroundColor: me ? p.bubbleMe : p.bubbleThem }, corners, (it.reaction || it.myReaction) && st.reacted]}
              testID="chat-bubble"
            >
              <T style={me ? { color: p.onBubbleMe } : undefined}>{it.text}</T>
              {it.reaction && <Reaction emoji={REACTION_EMOJI[it.reaction]} label={REACTION_LABEL[it.reaction]} testID={`chat-reaction-${it.reaction}`} />}
              {!it.reaction && it.myReaction && <Reaction emoji={it.myReaction} label={`내 반응 ${it.myReaction}`} testID="chat-my-reaction" />}
            </Pressable>
          </View>
        </SwipeReply>
      )}
      {it.card && (
        <View style={st.cardSlot}>
          {it.card.amend ? (
            <AmendCard card={it.card.amend.card} sent={it.card.sent} stale={stale} onChange={onAmend?.(it).change ?? (() => undefined)} onIssue={onAmend && !it.card.sent ? onAmend(it).issue : undefined} />
          ) : (
            <Card
              card={it.card}
              onIssue={(it.card.draft?.phone ? !it.card.sent : it.card.draft && (!openDrafts || openDrafts.has(it.card.draft.id))) ? (d) => onIssue(d, it.id) : undefined}
              cp={it.card.draft ? cpOf(it.card.draft.counterpartyId) : null}
              stale={stale}
              edited={q.draftEdits.get(it.id)}
              onEdit={(e) => q.editDraft(it.id, e)}
            />
          )}
        </View>
      )}
      {state !== '' && (
        <T v="meta" c="ink3" style={{ textAlign: 'right' }} testID="chat-state">
          {state}
        </T>
      )}
    </View>
  );
}

const REACTION_EMOJI: Record<ReactionId, string> = { thumbs_up: '👍', eyes: '👀', check: '✅', pray: '🙏' };
const REACTION_LABEL: Record<ReactionId, string> = { thumbs_up: '좋아요', eyes: '보고 있어요', check: '확인', pray: '감사해요' };

function Reaction({ emoji, label, testID }: { emoji: string; label: string; testID: string }) {
  const p = usePalette();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (reduce) a.setValue(1);
      else Animated.timing(a, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
    return () => void (live = false);
  }, [a, emoji]);
  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      style={[st.reaction, { backgroundColor: p.bubbleThem, borderColor: p.canvas, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]}
    >
      <Text style={st.reactionGlyph}>{emoji}</Text>
    </Animated.View>
  );
}

function Stamp({ text, first }: { text: string; first: boolean }) {
  const p = usePalette();
  return (
    <T v="meta" center style={[{ color: p.stamp }, first && { marginTop: space.s7 - space.s4 }]} testID="chat-stamp">
      {text}
    </T>
  );
}

const DOT_DELAY = [0, 150, 300];
const DOT_UP = Easing.bezier(0, 0, 0.2, 1);
const DOT_DOWN = Easing.bezier(0.8, 0, 1, 1);
function Typing() {
  const p = usePalette();
  const reduce = useReducedMotion();
  const appear = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const lift = useRef(DOT_DELAY.map(() => new Animated.Value(1))).current;
  const tone = useRef(DOT_DELAY.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const [dark, setDark] = useState(0);
  useEffect(() => {
    if (reduce) {
      appear.setValue(1);
      return;
    }
    const show = Animated.timing(appear, { toValue: 1, delay: 180, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    const bounce = lift.map((v, i) => {
      v.setValue(0);
      return Animated.sequence([
        Animated.delay(DOT_DELAY[i]!),
        Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 500, easing: DOT_DOWN, useNativeDriver: false }),
            Animated.timing(v, { toValue: 0, duration: 500, easing: DOT_UP, useNativeDriver: false }),
          ]),
        ),
      ]);
    });
    show.start();
    bounce.forEach((a) => a.start());
    const tick = setInterval(() => setDark((d) => (d + 1) % 3), 400);
    return () => {
      show.stop();
      bounce.forEach((a) => a.stop());
      clearInterval(tick);
    };
  }, [reduce, appear, lift]);
  useEffect(() => {
    tone.forEach((v, i) => Animated.timing(v, { toValue: i === dark ? 1 : 0, duration: 200, useNativeDriver: false }).start());
  }, [dark, tone]);
  return (
    <Animated.View
      style={[st.msg, st.theirs, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
      testID="chat-typing"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="답을 기다리고 있어요"
    >
      <View style={[st.typing, { backgroundColor: p.bubbleThem }]}>
        {DOT_DELAY.map((_, i) => (
          <Animated.View
            key={i}
            style={[
              st.dot,
              {
                backgroundColor: tone[i]!.interpolate({ inputRange: [0, 1], outputRange: [p.typingDotDim, p.typingDot] }),
                transform: [{ translateY: lift[i]!.interpolate({ inputRange: [0, 1], outputRange: [-2, 0] }) }],
              },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const EXAMPLES_PC = ['동네마트에 세금계산서 발급해 줘', '이번 달 매출이 얼마야?', '받을 돈 알려 줘'];
const EXAMPLES_PHONE = ['지난주에 발급한 것 보여 줘', '받을 돈 알려 줘', '동네마트에 세금계산서 발급해 줘'];
function Starter({ phoneAnswers, onPick }: { phoneAnswers: boolean; onPick: (text: string) => void }) {
  return (
    <View style={st.starter} testID="chat-starter">
      <View style={{ gap: space.s1 }}>
        <T v="strong">{phoneAnswers ? 'PC가 꺼져 있어도 물어볼 수 있어요' : '말로 시키면 PC가 해요'}</T>
        <T v="sub" c="ink2">
          {phoneAnswers ? 'PC가 넘겨 둔 기록으로 폰이 답해요. 발급은 PC를 켜면 시작해요.' : '평소 말하듯 적어 주세요. 예를 들면 이렇게요.'}
        </T>
      </View>
      <View style={st.examples}>
        {(phoneAnswers ? EXAMPLES_PHONE : EXAMPLES_PC).map((x) => (
          <Chip key={x} label={x} onPress={() => onPick(x)} testID="chat-example" />
        ))}
      </View>
    </View>
  );
}

type Draft = NonNullable<ChatCard['draft']>;
const ISSUE_FAILED: Record<Exclude<IssueSubmit, 'sent'>, string> = {
  save_failed: '폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요',
  no_counterparty: '거래처를 찾지 못해 맡기지 않았어요',
};
type OnIssue = (d: Draft, itemId: string) => Promise<IssueSubmit>;
type OnCardIssue = (d: Draft) => Promise<IssueSubmit>;
type OnAmend = (it: Extract<ChatItem, { kind: 'msg' }>) => { change: (c: AmendState) => void; issue: (c: AmendState) => Promise<AmendIssue> };

function Card({ card, onIssue, cp, stale, edited, onEdit }: { card: ChatCard; onIssue?: OnCardIssue; cp: Counterparty | null; stale: boolean; edited?: DraftEdit; onEdit: (e: DraftEdit) => void }) {
  if (card.draft) return <DraftCard card={card} draft={card.draft} onIssue={onIssue} cp={cp} stale={stale} edited={edited} onEdit={onEdit} />;
  return (
    <ShownCard kind={card.kind ?? 'doc'} title={card.title} testID="chat-card">
      {card.photo && <CardPhoto photo={card.photo} label={`${card.title} 사진`} />}
      {card.rows.length > 0 && (
        <Kv>
          {card.rows.map((r, i) => (
            <KvRow key={i} label={r.label} value={r.value} total={r.strong} />
          ))}
        </Kv>
      )}
      {card.note && <T v="sub" c="ink2">{card.note}</T>}
    </ShownCard>
  );
}

function CardPhoto({ photo, label }: { photo: NonNullable<ChatCard['photo']>; label: string }) {
  const s = useSession();
  const id = photo.msgId;
  const load = useMemo(() => (id ? () => s.outbox.readPhoto(id).then(jpegUri, () => null) : undefined), [id, s.outbox]);
  return <PhotoSlot thumb={photo.thumb} load={load} label={label} />;
}

const VAT_OPTIONS = [
  { key: 'excl' as const, label: '별도' },
  { key: 'incl' as const, label: '포함' },
];

function DraftCard({ card, draft, onIssue, cp, stale, edited, onEdit }: { card: ChatCard; draft: Draft; onIssue?: OnCardIssue; cp: Counterparty | null; stale: boolean; edited?: DraftEdit; onEdit: (e: DraftEdit) => void }) {
  const val: DraftEdit = edited ?? { amount: draft.amount, vat: draft.vat === 'included' ? 'incl' : 'excl', item: draft.item ?? '' };
  const openEdit = !!onIssue && !!draft.phone?.edit && !edited;
  const [edit, setEdit] = useState<null | { amount: string; vat: VatMode; item: string }>(openEdit ? { amount: draft.amount > 0 ? masked('won', String(draft.amount)) : '', vat: val.vat, item: val.item } : null);
  const closed = cp?.status?.kind === 'closed' ? cp.status : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Exclude<IssueSubmit, 'sent'> | null>(null);
  const shown = edit ? { amount: Number(edit.amount.replace(/\D/g, '')), vat: edit.vat, item: edit.item } : val;
  const a = splitAmount(shown.amount, shown.vat);
  const startEdit = () => setEdit({ amount: masked('won', String(val.amount)), vat: val.vat, item: val.item });
  const done = () => {
    if (!edit) return;
    onEdit({ amount: Number(edit.amount.replace(/\D/g, '')), vat: edit.vat, item: edit.item.trim() });
    setEdit(null);
  };
  const issue = async () => {
    if (!onIssue || busy) return;
    setBusy(true);
    setFailed(null);
    const sent = await onIssue({ ...draft, amount: val.amount, vat: val.vat === 'incl' ? 'included' : 'separate', item: val.item || null });
    setBusy(false);
    if (sent !== 'sent') setFailed(sent);
  };
  return (
    <ShownCard kind="doc" title={card.title} testID="chat-card">
      {edit ? (
        <>
          <AmountEdit label={edit.vat === 'incl' ? '합계 금액' : '공급가액'}>
            <CardInput
              testID="card-amount"
              label="금액"
              value={edit.amount}
              suffix="원"
              onChange={(v) => setEdit({ ...edit, amount: masked('won', v) })}
              keyboardType="number-pad"
              autoFocus={openEdit}
              placeholder="0"
            />
          </AmountEdit>
          <Kv>
            <KvRow label="부가세">
              <Seg testID="card-vat" options={VAT_OPTIONS} value={edit.vat} onChange={(v) => setEdit({ ...edit, vat: v })} />
            </KvRow>
          </Kv>
          <AmountEdit label="품목">
            <CardInput testID="card-item" label="품목" plain value={edit.item} onChange={(v) => setEdit({ ...edit, item: v })} placeholder="없음" />
          </AmountEdit>
          <Kv>
            <KvRow label="공급가액" value={won(a.supply)} />
            <KvRow label="부가세" value={won(a.tax)} />
            <KvRow label="합계" value={won(a.total)} total />
          </Kv>
        </>
      ) : (
        <Kv>
          <KvRow label="공급가액" value={won(a.supply)} />
          <KvRow label="부가세" value={won(a.tax)} />
          <KvRow label="품목" value={shown.item || '없음'} quiet={!shown.item} />
          <KvRow label="합계" value={won(a.total)} total />
        </Kv>
      )}
      {onIssue && !edit && (closed || stale) && (
        <T v="sub" c="attention" testID={closed ? 'card-closed' : 'card-stale'}>
          {closed ? `${closed.on}에 ${closed.what}한 곳으로 조회돼요` : 'PC를 켜면 맡길 수 있어요'}
        </T>
      )}
      {failed && (
        <T v="sub" c="attention" testID="card-failed">
          {ISSUE_FAILED[failed]}
        </T>
      )}
      {onIssue &&
        (edit ? (
          <Actions>
            <Button testID="card-done" label="완료" onPress={done} disabled={splitAmount(Number(edit.amount.replace(/\D/g, '')), edit.vat).supply <= 0} />
            <Button testID="card-cancel" kind="secondary" label="취소" onPress={() => setEdit(null)} />
          </Actions>
        ) : (
          <Actions>
            <Button testID="card-issue" label={closed ? '그래도 발급' : '발급하기'} onPress={() => void issue()} busy={busy} disabled={busy || stale || a.supply <= 0} />
            <Button testID="card-edit" kind="secondary" label="수정" onPress={startEdit} disabled={busy} />
          </Actions>
        ))}
    </ShownCard>
  );
}

function MenuRow({ label, hint, onPress, testID }: { label: string; hint: string; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: p.sunken }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T v="subStrong">{label}</T>
        <T v="meta" c="ink3">
          {hint}
        </T>
      </View>
      <Chevron color={p.ink4} />
    </Pressable>
  );
}

function Plus({ color, open }: { color: string; open: boolean }) {
  return (
    <View style={{ width: 14, height: 14, transform: [{ rotate: open ? '45deg' : '0deg' }] }}>
      <View style={{ position: 'absolute', left: 6, top: 0, width: 2, height: 14, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: 6, left: 0, width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

function SendButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const p = usePalette();
  const fg = disabled ? p.ink4 : p.onInk;
  return (
    <Pressable
      testID="chat-send"
      accessibilityRole="button"
      accessibilityLabel="보내기"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [st.send, { backgroundColor: disabled ? p.sunken : pressed ? p.ink2 : p.ink }]}
    >
      <View style={{ width: 12, height: 14, alignItems: 'center' }}>
        <View style={{ position: 'absolute', top: 1, width: 8, height: 8, borderTopWidth: 2, borderLeftWidth: 2, borderColor: fg, transform: [{ rotate: '45deg' }] }} />
        <View style={{ position: 'absolute', top: 1, width: 2, height: 13, borderRadius: 1, backgroundColor: fg }} />
      </View>
    </Pressable>
  );
}

function Chip({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [st.chip, { backgroundColor: pressed ? p.sunken : p.tint }]}
    >
      <T v="subStrong">{label}</T>
    </Pressable>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  pcDot: { width: 8, height: 8, borderRadius: radius.full },
  relink: { marginHorizontal: space.s5, marginBottom: space.s3 },
  lines: { paddingHorizontal: space.s5, gap: space.s2, paddingBottom: space.s2 },
  pcLine: { minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s3, marginHorizontal: -space.s2, paddingHorizontal: space.s2, borderRadius: radius.md },
  newReplyWrap: { position: 'absolute', left: 0, right: 0, bottom: space.s3, alignItems: 'center' },
  list: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s3 },
  row: { gap: space.s4, paddingTop: space.s4 },
  listEnd: { gap: space.s4, paddingTop: space.s4 },
  chat: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s4, flexGrow: 1, justifyContent: 'flex-end' },
  msg: { gap: space.s1, alignSelf: 'stretch' },
  follow: { marginTop: -(space.s4 - space.s1) },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  /** 대화 카드 자리: 말풍선은 글 폭만큼 왼쪽, 오른쪽에 붙지만 카드는 종류와 상관없이 언제나 대화 폭을 다 쓴다(대표 11-24). */
  cardSlot: { alignSelf: 'stretch' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 15, borderRadius: 22 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reacted: { marginBottom: 12 },
  reaction: { position: 'absolute', right: 4, bottom: -20, height: 28, minWidth: 38, paddingHorizontal: 8.5, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  reactionGlyph: { fontSize: 16, lineHeight: 18 },
  bubble: { borderRadius: 22, minHeight: 44, maxWidth: '90%', paddingHorizontal: 15, paddingVertical: 11, justifyContent: 'center' },
  note: { flexDirection: 'row', gap: space.s2, alignItems: 'flex-start' },
  failed: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  starter: { gap: space.s4, paddingVertical: space.s4 },
  examples: { alignItems: 'flex-start', gap: space.s2 },
  mergedWrap: { alignItems: 'center', paddingVertical: space.s1 },
  merged: { borderRadius: radius.full, paddingHorizontal: space.s3, paddingVertical: space.s1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: CAPSULE_SIDE, paddingTop: space.s4, gap: space.s2 },
  menu: { borderRadius: radius.lg, paddingVertical: space.s1, overflow: 'hidden' },
  menuRow: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s2 },
  plus: { width: 38, height: 38, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  send: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  chip: { minHeight: size.hit, paddingHorizontal: space.s4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: space.s2, borderRadius: radius.lg, paddingLeft: space.s4, paddingRight: space.s1, paddingVertical: space.s2 },
  replyX: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  replyCtx: { borderRadius: 22, maxWidth: '90%', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, marginBottom: -20 },
  pickBar: { position: 'absolute', height: BAR_H, flexDirection: 'row', alignItems: 'center', borderRadius: BAR_H / 2, paddingHorizontal: space.s1, gap: 2 },
  pick: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pickGlyph: { fontSize: 26, lineHeight: 32 },
  lifted: { maxWidth: undefined },
  holdMenu: { position: 'absolute', minWidth: 200, borderRadius: radius.lg, paddingVertical: space.s1, overflow: 'hidden' },
  holdIcon: { width: 22, alignItems: 'center' },
  holdRow: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4 },
  input: { flex: 1, minHeight: 38, maxHeight: 132, paddingLeft: space.s1, paddingRight: space.s2, paddingTop: 7, paddingBottom: 7 },
});
