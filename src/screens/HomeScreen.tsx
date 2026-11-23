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
import { queueCounts } from '../queue';
import { useQueue } from '../queueStore';
import { RunCard } from './RunCard';
import { useIssueSubmit } from '../issueSubmit';
import { kstDay } from '../phoneCmd';
import { onShowCard, shownCard } from '../cardFocus';
import { counterpartiesOf } from '../net/pcCopy';
import { inexactNote, splitAmount, type Counterparty, type VatMode } from '../issue';
import { masked } from '../ui/field';
import { FlapText } from '../ui/FlapText';
import { PhotoSlot } from '../ui/PhotoSlot';
import { jpegUri } from '../capture/thumb';
import { useSession } from '../session';
import type { PcStatus } from '../net/pc';
import { MAX_FONT_SCALE, TextSizeContext, radius, size, space, textScale, type, usePalette, useReducedMotion } from '../theme';
import { Button, Check, Chevron, Pill, Seg, T, ago, success, tap, won, type Tone } from '../ui/kit';

export type HomeRoute = 'pair' | 'capture' | 'cash' | 'connection' | 'settings' | 'devices' | 'issue' | 'queue' | 'run' | 'doc' | 'bizreg' | 'recv' | 'pay' | 'mark';

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

/** 머리 오른쪽의 PC 상태 알약. 누르면 PC 연결 화면. */
function PcPill({ pc, lastSeen, onPress }: { pc: PcStatus; lastSeen: number | null; onPress: () => void }) {
  const p = usePalette();
  const l = pcLine(pc, lastSeen);
  const warn = l.tone === 'attention';
  return (
    <Pressable
      testID="pc-status"
      accessibilityRole="button"
      accessibilityLabel={`${l.label}${l.sub ? `, ${l.sub}` : ''}. 연결 상태 보기`}
      onPress={onPress}
      style={({ pressed }) => [st.pcPill, { backgroundColor: warn ? p.attentionSoft : p.tint }, pressed && { opacity: 0.6 }]}
    >
      <View style={[st.pcDot, l.tone === 'accent' ? { backgroundColor: p.accent } : warn ? { backgroundColor: p.attention } : { borderWidth: 1.5, borderColor: p.ink3 }]} />
      <T v="subStrong" c={warn ? 'attention' : 'ink'}>
        {l.label}
      </T>
      {l.sub && (
        <T v="sub" c="ink3">
          {l.sub}
        </T>
      )}
    </Pressable>
  );
}

/** 이 폰의 연결이 풀렸을 때 대화 끝에 한 번 보이는 카드. */
function RelinkCard({ onRelink }: { onRelink: () => void }) {
  const p = usePalette();
  return (
    <View style={[st.relink, { backgroundColor: p.tint, borderColor: p.attention }]} testID="relink-card">
      <T v="strong">PC와 연결이 풀렸어요</T>
      <T v="sub" c="ink2">
        부탁은 이 폰에 두었어요. 다시 연결하면 바로 보낼게요.
      </T>
      <Button testID="relink" small label="다시 연결" onPress={onRelink} />
    </View>
  );
}

export interface Todo {
  approvals: number;
  backlog: number;
}

const FOLLOW_PX = 80;
const KEEP_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: FOLLOW_PX } as const;
const SHOW_END_PX = 160;

export function HomeScreen({ go, chat, todo, draft = '', phone, menu: menuOpen = false, focusAfter, onIssue }: { go: (to: HomeRoute) => void; onIssue?: () => void; chat?: ChatItem[]; todo?: Todo; draft?: string; phone?: OfflineChatView; menu?: boolean; focusAfter?: number }) {
  const s = useSession();
  const p = usePalette();
  useContext(TextSizeContext);
  const paired = !!s.data.pair;
  const q = useQueue();
  const qc = queueCounts(q.jobs, Date.now());
  const t = todo ?? { approvals: qc.approvals, backlog: qc.backlog + s.pending.receipts + s.pending.cash };
  const [mine, setMine] = useState<ChatItem[]>([]);
  const [text, setText] = useState(draft);
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
  const cpOf = (id: string): Counterparty | null => (id ? [...(s.data.pcCopy ? counterpartiesOf(s.data.pcCopy) : []), ...q.counterparties].find((c) => c.id === id) ?? null : null);
  const issueFrom = async (d: Draft, itemId: string): Promise<boolean> => {
    const cp = cpOf(d.counterpartyId);
    if (!d.phone && !cp) {
      q.setPrefill({ amount: d.amount, vat: d.vat, item: d.item, draftId: d.id });
      go('issue');
      return true;
    }
    const a = splitAmount(d.amount, d.vat === 'included' ? 'incl' : 'excl');
    if (a.supply <= 0) return true;
    const ok = await submitIssue({ cp, name: d.phone?.name ?? '', bizNo: d.phone?.bizNo ?? '', item: d.item ?? '', day: kstDay(), a, draftId: d.phone ? d.phone.draftId : d.id });
    if (ok && d.phone) q.markSent(itemId);
    return ok;
  };
  const list = useRef<FlatList<ChatItem>>(null);
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
  const waiting: ChatItem[] = q.jobs
    .filter((j) => j.id.startsWith('cmd-') && j.run && j.state === 'approval' && !carded.has(j.id))
    .map((j) => ({ kind: 'run', id: `run-${j.id}`, at: j.createdAt, jobId: j.id }));
  const items = [...(chat ?? chatFromData(s.data)), ...q.notes, ...waiting, ...mine, ...(chat && !phone ? [] : offline.items)].sort((a, b) => at(a) - at(b));
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
    <SafeAreaView edges={['top', 'left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID="home">
      {}
      <KeyboardAvoidingView style={st.fill} behavior="translate-with-padding">
        {}
        <View style={st.top}>
          {paired ? (
            <TodoLine todo={t} onPress={() => go('queue')} />
          ) : (
            <View style={{ flex: 1, paddingLeft: space.s1 }}>
              <T v="title" role="header">
                {BRAND}
              </T>
            </View>
          )}
          {paired && <PcPill pc={s.pc} lastSeen={s.data.lastSeenPc} onPress={() => go('connection')} />}
          <Pressable
            testID="go-settings"
            accessibilityRole="button"
            accessibilityLabel="설정"
            hitSlop={4}
            onPress={() => go('settings')}
            style={({ pressed }) => [st.topBtn, pressed && { backgroundColor: p.tint }]}
          >
            <Kebab color={p.ink2} />
          </Pressable>
        </View>
        {}

        <View style={st.fill}>
        {!paired || items.length === 0 ? (
          <ScrollView style={st.fill} contentContainerStyle={[st.chat, !paired && { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" testID="chat">
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
            contentContainerStyle={st.list}
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
                    <Item it={it} group={bubbleGroup(items, i)} onRetry={(id) => void offline.retry(id)} retryOff={offline.busy} openDrafts={offline.openDrafts} onIssue={issueFrom} cpOf={cpOf} stale={s.pc === 'stale'} onHold={setHeld} onReply={canSend ? startReply : undefined} />
                  )}
                </View>
              );
            }}
          />
        )}
        <TopFade />
        {endBtn && <NewReply fresh={endBtn === 'new'} onPress={toEnd} />}
        </View>

        {paired && (
          <View style={[st.bottom, { borderTopColor: p.line, backgroundColor: p.canvas }]}>
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
            <View style={st.inputRow}>
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
                style={({ pressed }) => [st.round, { backgroundColor: pressed || menu ? p.sunken : p.tint }]}
              >
                <Plus color={p.ink2} open={menu} />
              </Pressable>
              <View style={[st.field, { backgroundColor: p.tint }]}>
                <TextInput
                  ref={input}
                  testID="chat-input"
                  value={text}
                  onChangeText={setText}
                  onFocus={() => setMenu(false)}
                  placeholder="궁금한 것이나 시킬 일"
                  placeholderTextColor={p.ink3}
                  accessibilityLabel="궁금한 것이나 시킬 일 적기"
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  multiline
                  numberOfLines={1}
                  onSubmitEditing={send}
                  style={[
                    type.body,
                    textScale.web !== 1 && { fontSize: type.body.fontSize * textScale.web, lineHeight: type.body.lineHeight * textScale.web },
                    st.input,
                    { color: p.ink },
                  ]}
                />
                <SendButton onPress={send} disabled={!text.trim() || offline.busy} />
              </View>
            </View>
          </View>
        )}
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
function TopFade() {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={st.fade}>
      {FADE.map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: p.canvas, opacity: o }} />
      ))}
    </View>
  );
}

function NewReply({ fresh, onPress }: { fresh: boolean; onPress: () => void }) {
  const p = usePalette();
  const still = useReducedMotion();
  const a = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.timing(a, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, still]);
  return (
    <Animated.View pointerEvents="box-none" style={[st.newReplyWrap, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      <Pressable
        testID="chat-new-reply"
        accessibilityRole="button"
        accessibilityLabel={fresh ? '새 답 보기' : '맨 아래로'}
        onPress={() => {
          tap();
          onPress();
        }}
        style={({ pressed }) => [st.newReply, !fresh && st.endOnly, { backgroundColor: pressed ? p.sunken : p.tint, shadowColor: p.ink }]}
      >
        <View style={{ marginTop: -4 }}>
          <Chevron color={p.ink2} dir="down" sizePx={7} />
        </View>
        {fresh && <T v="label">새 답</T>}
      </Pressable>
    </Animated.View>
  );
}

const SCREEN_LABEL: Record<PhoneScreen, string> = { capture: '증빙 찍기', cash: '현금 매출 적기', bizreg: '사업자등록증 찍기', issue: '세금계산서 발급' };

const CANT_SEND_TEXT = '이 폰에서는 아직 대화를 보낼 수 없어요. 앱을 다시 열거나 설정에서 PC 연결을 확인해 주세요.';

function Kebab({ color }: { color: string }) {
  return (
    <View style={{ gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  );
}

const at = (it: ChatItem) => (it.kind === 'merged' ? it.from : it.at);

function TodoLine({ todo, onPress }: { todo: Todo; onPress: () => void }) {
  const p = usePalette();
  const parts = [todo.approvals > 0 && `승인\u00A0대기\u00A0${todo.approvals}건`, todo.backlog > 0 && `밀린\u00A0일\u00A0${todo.backlog}건`].filter(Boolean).join(', ');
  const body = (
    <>
      <T v="subStrong" style={{ flexShrink: 0 }}>
        지금 할 일
      </T>
      <T v="sub" c={parts ? 'ink' : 'ink3'} style={{ flexShrink: 1 }} lines={1} testID="todo-counts">
        {parts || '없음'}
      </T>
      {parts ? <Chevron color={p.ink4} /> : null}
    </>
  );
  if (!parts) return <View style={st.todo} testID="todo">{body}</View>;
  return (
    <Pressable
      testID="todo"
      accessibilityRole="button"
      accessibilityLabel={`지금 할 일: ${parts.replace(/\u00A0/g, ' ')}`}
      onPress={onPress}
      style={({ pressed }) => [st.todo, pressed && { opacity: 0.6 }]}
    >
      {body}
    </Pressable>
  );
}

function Intro({ onPair }: { onPair: () => void }) {
  const p = usePalette();
  return (
    <View style={[st.card, { backgroundColor: p.tint }]} testID="unpaired">
      <T v="strong">먼저 PC와 연결해 주세요</T>
      <T v="sub" c="ink2">
        PC의 {BRAND} → 설정 → 기기{'\u00A0'}연결에서 [폰{'\u00A0'}연결]을 누르면 뜨는 QR을 이 폰으로 찍으면 돼요. 한 번만 하면 돼요.
      </T>
      <T v="sub" c="ink2">
        연결하면 여기서 PC에 일을 시키고, 종이 증빙을 찍고, 현금 매출을 적을 수 있어요.
      </T>
      <Button testID="go-pair" label="PC와 연결" onPress={onPair} style={{ marginTop: space.s2 }} />
    </View>
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
      onDoc={() => open('doc')}
      onShare={() => open('doc')}
      onApprove={() => q.openSheet(job.id)}
    />
  );
}

function Item({ it, group, onRetry, retryOff, openDrafts, onIssue, cpOf, stale, onHold, onReply }: { it: Exclude<ChatItem, { kind: 'run' }>; group: { first: boolean; last: boolean }; onRetry: (noteId: string) => void; retryOff?: boolean; openDrafts?: ReadonlySet<string>; onIssue: OnIssue; cpOf: (id: string) => Counterparty | null; stale: boolean; onHold: (h: Held) => void; onReply?: (r: ReplyTo) => void }) {
  const p = usePalette();
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
        <Card
          card={it.card}
          onIssue={(it.card.draft?.phone ? !it.card.sent : it.card.draft && (!openDrafts || openDrafts.has(it.card.draft.id))) ? (d) => onIssue(d, it.id) : undefined}
          cp={it.card.draft ? cpOf(it.card.draft.counterpartyId) : null}
          stale={stale}
        />
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
type OnIssue = (d: Draft, itemId: string) => Promise<boolean>;
type OnCardIssue = (d: Draft) => Promise<boolean>;

function Card({ card, onIssue, cp, stale }: { card: ChatCard; onIssue?: OnCardIssue; cp: Counterparty | null; stale: boolean }) {
  const p = usePalette();
  if (card.draft) return <DraftCard card={card} draft={card.draft} onIssue={onIssue} cp={cp} stale={stale} />;
  return (
    <View style={[st.card, { backgroundColor: p.tint }]} testID="chat-card">
      <T v="subStrong">{card.title}</T>
      {card.photo && <CardPhoto photo={card.photo} label={`${card.title} 사진`} />}
      {card.rows.map((r, i) => (
        <CardRow key={i} label={r.label} value={r.value} strong={r.strong} />
      ))}
      {card.note && (
        <T v="meta" c="ink3">
          {card.note}
        </T>
      )}
    </View>
  );
}

function CardPhoto({ photo, label }: { photo: NonNullable<ChatCard['photo']>; label: string }) {
  const s = useSession();
  const id = photo.msgId;
  const load = useMemo(() => (id ? () => s.outbox.readPhoto(id).then(jpegUri, () => null) : undefined), [id, s.outbox]);
  return <PhotoSlot thumb={photo.thumb} load={load} label={label} />;
}

function CardValue({ text, strong, quiet }: { text: string; strong?: boolean; quiet?: boolean }) {
  return (
    <T v={strong ? 'figure' : 'value'} c={quiet ? 'ink4' : 'ink'} style={{ flexShrink: 1, textAlign: 'right' }}>
      {text}
    </T>
  );
}

function CardRow({ label, value, strong, children, fixed, flap }: { label: string; value?: string; strong?: boolean; children?: React.ReactNode; fixed?: boolean; flap?: boolean }) {
  return (
    <View style={[st.cardRow, fixed && st.cardRowFixed]}>
      {flap ? (
        <FlapText text={label} />
      ) : (
        <T v="sub" c="ink2" style={{ flexShrink: 1 }}>
          {label}
        </T>
      )}
      {children ?? (
        <T v={strong ? 'figure' : 'value'} style={{ flexShrink: 0, textAlign: 'right' }}>
          {value}
        </T>
      )}
    </View>
  );
}

const VAT_OPTIONS = [
  { key: 'excl' as const, label: '별도' },
  { key: 'incl' as const, label: '포함' },
];

function DraftCard({ card, draft, onIssue, cp, stale }: { card: ChatCard; draft: Draft; onIssue?: OnCardIssue; cp: Counterparty | null; stale: boolean }) {
  const p = usePalette();
  const [val, setVal] = useState({ amount: draft.amount, vat: (draft.vat === 'included' ? 'incl' : 'excl') as VatMode, item: draft.item ?? '' });
  const openEdit = !!onIssue && !!draft.phone?.edit;
  const [edit, setEdit] = useState<null | { amount: string; vat: VatMode; item: string }>(openEdit ? { amount: draft.amount > 0 ? masked('won', String(draft.amount)) : '', vat: val.vat, item: val.item } : null);
  const closed = cp?.status?.kind === 'closed' ? cp.status : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = edit ? { amount: Number(edit.amount.replace(/\D/g, '')), vat: edit.vat, item: edit.item } : val;
  const a = splitAmount(shown.amount, shown.vat);
  const inexact = inexactNote(shown.amount, a);
  const startEdit = () => setEdit({ amount: masked('won', String(val.amount)), vat: val.vat, item: val.item });
  const done = () => {
    if (!edit) return;
    setVal({ amount: Number(edit.amount.replace(/\D/g, '')), vat: edit.vat, item: edit.item.trim() });
    setEdit(null);
  };
  const issue = async () => {
    if (!onIssue || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onIssue({ ...draft, amount: val.amount, vat: val.vat === 'incl' ? 'included' : 'separate', item: val.item || null });
    setBusy(false);
    if (!ok) setFailed(true);
  };
  const dark = p.overlay === p.tint;
  const inputStyle = [st.cardInput, { backgroundColor: p.canvas, color: p.ink, borderColor: p.line }];
  return (
    <View style={[st.card, st.cardDraft, { backgroundColor: p.tint }]} testID="chat-card">
      <T v="subStrong" style={{ paddingBottom: space.s1 }}>{card.title}</T>
      {}
      <CardRow label={edit?.vat === 'incl' ? '합계 금액' : '공급가액'} fixed flap>
        {edit ? (
          <TextInput
            testID="card-amount"
            value={edit.amount}
            onChangeText={(v) => setEdit({ ...edit, amount: masked('won', v) })}
            keyboardType="number-pad"
            accessibilityLabel="금액"
            autoFocus={openEdit}
            placeholder="0"
            placeholderTextColor={p.ink4}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[type.value, ...inputStyle, { textAlign: 'right' }]}
          />
        ) : (
          <CardValue text={won(a.supply)} />
        )}
      </CardRow>
      <CardRow label={edit ? '부가세' : `부가세 ${shown.vat === 'incl' ? '포함' : '별도'}`} fixed flap>
        {edit ? (
          <Seg testID="card-vat" options={VAT_OPTIONS} value={edit.vat} onChange={(v) => setEdit({ ...edit, vat: v })} style={[st.cardSeg, { backgroundColor: dark ? p.canvas : p.sunken }]} />
        ) : (
          <CardValue text={won(a.tax)} />
        )}
      </CardRow>
      <CardRow label="품목" fixed>
        {edit ? (
          <TextInput
            testID="card-item"
            value={edit.item}
            onChangeText={(v) => setEdit({ ...edit, item: v })}
            placeholder="없음"
            placeholderTextColor={p.ink4}
            accessibilityLabel="품목"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[type.value, ...inputStyle, { textAlign: 'right' }]}
          />
        ) : (
          <CardValue text={shown.item || '없음'} quiet={!shown.item} />
        )}
      </CardRow>
      <CardRow label="합계" fixed>
        <CardValue text={won(a.total)} strong />
      </CardRow>
      {inexact && (
        <T v="meta" c="attention" testID="card-inexact">
          {inexact}
        </T>
      )}
      {card.note && !onIssue && (
        <T v="meta" c="ink3">
          {card.note}
        </T>
      )}
      {onIssue && !edit && (closed || stale) && (
        <T v="meta" c="attention" testID={closed ? 'card-closed' : 'card-stale'}>
          {closed ? `${closed.on}에 ${closed.what}한 곳으로 조회돼요` : 'PC를 켜면 맡길 수 있어요'}
        </T>
      )}
      {failed && (
        <T v="meta" c="attention" testID="card-failed">
          폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요
        </T>
      )}
      {onIssue && (
        <View style={st.cardButtons}>
          {edit ? (
            <>
              <Button testID="card-cancel" kind="secondary" label="취소" onPress={() => setEdit(null)} style={[st.cardBtn, { backgroundColor: p.canvas }]} />
              <Button testID="card-done" label="완료" onPress={done} disabled={splitAmount(Number(edit.amount.replace(/\D/g, '')), edit.vat).supply <= 0} style={st.cardBtn} />
            </>
          ) : (
            <>
              <Button
                testID="card-issue"
                label={closed ? '그래도 발급' : '발급하기'}
                onPress={() => void issue()}
                busy={busy}
                disabled={busy || stale || a.supply <= 0}
                style={st.cardBtn}
              />
              <Button testID="card-edit" kind="secondary" label="수정" onPress={startEdit} disabled={busy} style={[st.cardBtn, { backgroundColor: p.canvas }]} />
            </>
          )}
        </View>
      )}
    </View>
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
  top: { minHeight: size.header, flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingLeft: space.s4, paddingRight: space.s2, paddingTop: space.s1 },
  pcPill: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: space.s3, borderRadius: radius.full },
  pcDot: { width: 8, height: 8, borderRadius: radius.full },
  relink: { gap: space.s3, padding: space.s4, borderRadius: radius.lg, borderWidth: 1, marginHorizontal: space.s5, marginBottom: space.s3 },
  topBtn: { minWidth: size.hit, minHeight: size.hit, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  lines: { paddingHorizontal: space.s5, gap: space.s2, paddingBottom: space.s2 },
  pcLine: { minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s3, marginHorizontal: -space.s2, paddingHorizontal: space.s2, borderRadius: radius.md },
  todo: { flex: 1, minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingLeft: space.s1 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  newReplyWrap: { position: 'absolute', left: 0, right: 0, bottom: space.s3, alignItems: 'center' },
  endOnly: { paddingLeft: 0, paddingRight: 0, width: 36, justifyContent: 'center' },
  list: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s3 },
  row: { gap: space.s4, paddingTop: space.s4 },
  listEnd: { gap: space.s4, paddingTop: space.s4 },
  newReply: { flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 36, paddingLeft: space.s3, paddingRight: space.s4, borderRadius: radius.full, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  chat: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s4, flexGrow: 1, justifyContent: 'flex-end' },
  msg: { gap: space.s1, alignSelf: 'stretch' },
  follow: { marginTop: -(space.s4 - space.s1) },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 15, borderRadius: 22 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reacted: { marginBottom: 12 },
  reaction: { position: 'absolute', right: 4, bottom: -20, height: 28, minWidth: 38, paddingHorizontal: 8.5, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  reactionGlyph: { fontSize: 16, lineHeight: 18 },
  bubble: { borderRadius: 22, minHeight: 44, maxWidth: '90%', paddingHorizontal: 15, paddingVertical: 11, justifyContent: 'center' },
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  cardDraft: { gap: 0 },
  cardInput: { width: 180, flexShrink: 1, height: 40, paddingHorizontal: space.s3, paddingVertical: 0, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  cardSeg: { width: 180, flexShrink: 1 },
  cardButtons: { flexDirection: 'row', gap: space.s2, marginTop: space.s2 },
  cardBtn: { flex: 1 },
  cardRowFixed: { minHeight: 44, alignItems: 'center' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s3 },
  note: { flexDirection: 'row', gap: space.s2, alignItems: 'flex-start' },
  failed: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  starter: { gap: space.s4, paddingVertical: space.s4 },
  examples: { alignItems: 'flex-start', gap: space.s2 },
  mergedWrap: { alignItems: 'center', paddingVertical: space.s1 },
  merged: { borderRadius: radius.full, paddingHorizontal: space.s3, paddingVertical: space.s1 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.s4, paddingTop: space.s2, paddingBottom: space.s2, gap: space.s2 },
  menu: { borderRadius: radius.lg, paddingVertical: space.s1, overflow: 'hidden' },
  menuRow: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s2 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, paddingRight: 4, paddingBottom: 4, minHeight: size.hit },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: size.hit, paddingHorizontal: space.s4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s2 },
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
  input: { flex: 1, minHeight: size.hit, maxHeight: 132, paddingLeft: space.s4, paddingRight: space.s2, paddingTop: 10, paddingBottom: 10 },
});
