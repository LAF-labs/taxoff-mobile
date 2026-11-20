// 홈 = PC와 나누는 하나의 대화(기획 v2 PR 1). 위에서부터:
//   PC 연결 한 줄(켜짐 파랑 점 · 꺼짐 마지막 접속 · 오래 꺼짐 황토 · 연결 안 됨). 연결 전에는 가운데 안내 면의 [PC와 연결] 하나
//   지금 할 일 한 줄(승인 대기 · 밀린 일 건수 → 지금 할 일)
//   대화(PC 답은 글자, 카드 답은 tint 면, 내 말은 오른쪽 tint 말풍선, 폰에서 나눈 구간 머리)
//   바닥: 입력 줄 하나. 왼쪽 [+]가 빠른 일(세금계산서 발급·증빙 찍기·현금 매출)을 펼치고, 오른쪽 작은 원이 보내기다. 키보드가 올라오면 함께 올라간다.
// 적은 말은 PC가 켜져 있든 꺼져 있든 이 폰이 게이트웨이로 직접 보낸다(ADR-047 결정 6, 대화는 기기마다 따로). 발급은 카드에서 PC에 맡긴다.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, Animated, Easing, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bubbleGroup, chatFromData, clockRange, stampBefore, stateOf, type ChatCard, type ChatItem } from '../chat';
import { useOfflineChat, type OfflineChatView } from '../offline/useOfflineChat';
import type { PhoneScreen, ReactionId } from '@sax/chat-core';
import { BRAND } from '../config';
import { queueCounts } from '../queue';
import { useQueue } from '../queueStore';
import { RunCard } from './RunCard';
import { useIssueSubmit } from '../issueSubmit';
import { kstDay } from '../phoneCmd';
import { onShowCard, shownCard } from '../cardFocus';
import { counterpartiesOf } from '../net/pcCopy';
import { splitAmount, type Counterparty, type VatMode } from '../issue';
import { masked } from '../ui/field';
import { FlapText } from '../ui/FlapText';
import { PhotoSlot } from '../ui/PhotoSlot';
import { jpegUri } from '../capture/thumb';
import { useSession } from '../session';
import type { PcStatus } from '../net/pc';
import { MAX_FONT_SCALE, TextSizeContext, radius, size, space, textScale, type, usePalette, useReducedMotion } from '../theme';
import { Button, Check, Chevron, Pill, Seg, T, ago, tap, won, type Tone } from '../ui/kit';

export type HomeRoute = 'pair' | 'capture' | 'cash' | 'connection' | 'settings' | 'devices' | 'issue' | 'queue' | 'run' | 'doc' | 'bizreg' | 'recv' | 'pay' | 'mark';

/** 연결 상태 한 줄. 파랑은 "켜져 있어 바로 받는다"에만 쓴다. */
export function pcLine(pc: PcStatus, lastSeen: number | null): { tone: Tone; label: string; busy?: boolean } {
  switch (pc) {
    case 'online':
      return { tone: 'accent', label: 'PC 켜짐' };
    case 'connecting':
      return { tone: 'quiet', label: 'PC 찾는 중', busy: true };
    case 'queued':
      return { tone: 'quiet', label: 'PC 꺼짐 · 켜지면 받아요' };
    case 'stale':
      return { tone: 'attention', label: 'PC 연결 확인 필요' };
    case 'unpaired':
      return { tone: 'quiet', label: 'PC와 연결 전' };
    default:
      return { tone: 'quiet', label: `PC 꺼짐 · ${ago(lastSeen)}` };
  }
}

export interface Todo {
  /** PC가 사장님 승인을 기다리는 일(폰 승인은 준비 중이라 앱에서는 0) */
  approvals: number;
  /** 아직 PC로 못 간 것(사진·현금 매출) */
  backlog: number;
}

/**
 * 대화 목록은 뒤집힌 FlatList다(Mattermost 모바일 app/components/post_list/post_list.tsx, Happy packages/happy-app/sources/components/ChatList.tsx).
 * 맨 아래(가장 새 말)가 스크롤 0이라, 키보드가 올라와 화면이 줄어도 새 말 자리가 그대로다(Happy 실측: 보통 목록 582pt 밀림, 뒤집힌 목록 0).
 * 새 말이 오면 iOS·Android 기본 maintainVisibleContentPosition이 읽던 자리를 지키고, 끝에서 FOLLOW_PX 안일 때만 따라 내린다.
 * FOLLOW_PX는 PC와 같은 80(Mattermost 60, Happy 200 사이. 대표 지시 값).
 */
const FOLLOW_PX = 80;
const KEEP_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: FOLLOW_PX } as const;
/** 끝에서 이만큼 올라가 있으면 맨 아래로 단추(화살표)를 띄운다(Mattermost CONTENT_OFFSET_THRESHOLD 160). 새 말이 왔으면 글자 [새 답]. */
const SHOW_END_PX = 160;

export function HomeScreen({ go, chat, todo, draft = '', phone, menu: menuOpen = false, focusAfter, onIssue }: { go: (to: HomeRoute) => void; /** [+] → 세금계산서 발급: 대화 위 발급 시트를 연다(없으면 발급 화면으로) */ onIssue?: () => void; chat?: ChatItem[]; todo?: Todo; draft?: string; /** 갤러리: 폰 대화 상태를 정해 그린다(네트워크 없음) */ phone?: OfflineChatView; /** 갤러리: [+] 메뉴를 펼친 채로 */ menu?: boolean; /** 시험용 빌드(갤러리): 이 ms 뒤 입력 칸에 들어가 키보드를 띄우고 3초 뒤 내린다(시뮬레이터 녹화) */ focusAfter?: number }) {
  const s = useSession();
  const p = usePalette();
  // 글자 크기 설정이 바뀌면 입력 칸(textScale.web)도 다시 그린다
  useContext(TextSizeContext);
  const paired = !!s.data.pair;
  const q = useQueue();
  const qc = queueCounts(q.jobs, Date.now());
  const t = todo ?? { approvals: qc.approvals, backlog: qc.backlog + s.pending.receipts + s.pending.cash };
  const [mine, setMine] = useState<ChatItem[]>([]);
  const [text, setText] = useState(draft);
  const [menu, setMenu] = useState(menuOpen);
  /** [+] 메뉴의 빠른 일: 고르면 메뉴를 닫고 그 화면으로 */
  const quick = (to: HomeRoute) => {
    setMenu(false);
    go(to);
  };
  const submitIssue = useIssueSubmit();
  /** 카드의 거래처: PC 사본, 그다음 이 폰에서 만든 거래처 */
  const cpOf = (id: string): Counterparty | null => (id ? [...(s.data.pcCopy ? counterpartiesOf(s.data.pcCopy) : []), ...q.counterparties].find((c) => c.id === id) ?? null : null);
  /**
   * 대화 카드 [발급하기]: 카드 값(고쳤으면 고친 값)으로 맡긴다(issueSubmit). 승인은 PC 승인 바나 폰 승인에서 한다.
   * 휴·폐업 경고와 PC가 오래 꺼진 때는 카드 안에서 말한다.
   * 모델 카드의 거래처를 장부에서 찾지 못하면 [+] 발급 시트를 열어 고르게 한다(카드 값은 새 카드에 채운다).
   */
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
  // ---- 읽던 자리 지키기(11-19): 뒤집힌 목록이라 y는 "가장 새 말에서 떨어진 거리"다 ----
  const y = useRef(0);
  /** 맨 아래로 단추: null 없음, 'end' 화살표만, 'new' [새 답] */
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
  // 웹(갤러리)에는 maintainVisibleContentPosition이 없어 같은 일을 손으로 한다(그 기능과 같은 방식):
  // 새 말을 그리기 전에 화면 가운데 줄의 화면 위치를 적어 두고, 그린 직후(칠하기 전) 그 줄이 같은 자리에 오도록 scrollTop을 고친다.
  // 브라우저의 스크롤 고정(overflow-anchor)은 끈다. 뒤집힌 목록에서는 때때로 한 번 더 옮겨 두 번 밀린다(11-19 녹화로 확인).
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
      // 뒤집힌 목록은 scrollTop 방향이 화면과 반대일 수 있어, 한 번 고쳐 보고 남은 차이로 다시 고친다
      const before = node.scrollTop;
      node.scrollTop = before - drift;
      if (Math.abs(a.el.getBoundingClientRect().top - a.top) > Math.abs(drift)) node.scrollTop = before + drift;
    }
    y.current = node.scrollTop;
  };
  const off = s.pc === 'offline' || s.pc === 'queued';
  /** PC가 꺼져 있으면 폰이 대화를 이어 받는다(기획 v2). */
  const pcOff = off || s.pc === 'stale';

  // 폰 대화는 PC가 켜져 있어도 이 폰이 게이트웨이를 거쳐 직접 부른다(ADR-047 결정 6). 예전에는 켜져 있으면 화면에만 두어 "PC 켜지면 보내요"로 멈췄다.
  const live = useOfflineChat();
  const offline = phone ?? live;
  const canSend = offline.available;
  /** PC가 꺼져 있어 폰 혼자 답하는 중(안내 문구용) */
  const phoneAnswers = pcOff && canSend;
  // 승인을 기다리는 폰 발급은 앱을 다시 열어도 대화에 카드로 남긴다(진행 카드 줄은 메모리에만 있다)
  const carded = new Set(q.notes.flatMap((n) => (n.kind === 'run' ? [n.jobId] : [])));
  const waiting: ChatItem[] = q.jobs
    .filter((j) => j.id.startsWith('cmd-') && j.run && j.state === 'approval' && !carded.has(j.id))
    .map((j) => ({ kind: 'run', id: `run-${j.id}`, at: j.createdAt, jobId: j.id }));
  const items = [...(chat ?? chatFromData(s.data)), ...q.notes, ...waiting, ...mine, ...(chat && !phone ? [] : offline.items)].sort((a, b) => at(a) - at(b));
  // 뒤집힌 목록: 0번이 가장 새 말이다
  const data = [...items].reverse();
  // 가장 새 말이 바뀌었다 = 새 말. 내 말이면 어디를 읽고 있었든 맨 아래로(Mattermost: 보내면 끝으로), 앱의 말이면 끝에서 멀 때 [새 답].
  const last = items.at(-1);
  const lastId = last?.id ?? '';
  const seen = useRef<string | null>(null);
  // 승인 대기 카드로(알림 누름, 새 승인 요청): 그 카드를 화면 가운데로 스크롤한다
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(
    () =>
      onShowCard((id) => {
        const index = dataRef.current.findIndex((it) => it.kind === 'run' && it.jobId === id);
        if (index < 0) return; // 아직 카드가 없다: 요청이 오면 다시 부른다
        shownCard(id);
        setEnd(null);
        requestAnimationFrame(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }));
      }),
    [],
  );
  // 웹: 새 말을 그리기 전(이 렌더 중)에 읽던 줄을 잡아 둔다
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
  /** 예시 문장을 누르면 입력 칸에 넣고 바로 고칠 수 있게 한다(보내지는 않는다) */
  const pick = (v: string) => {
    setText(v);
    input.current?.focus();
  };
  const send = () => {
    const v = text.trim();
    if (!v || offline.busy) return;
    setText('');
    if (canSend) {
      void offline.send(v);
      return;
    }
    // 이 폰이 대화를 부를 수 없다(게이트웨이를 정할 수 없는 개발 판 등): 말을 붙잡아 두지 않고 못 보냈다고 바로 알린다
    const now = Date.now();
    setMine((m) => [
      ...m,
      { kind: 'msg', id: `me-${now}`, from: 'me', at: now, text: v, state: 'failed' },
      { kind: 'note', id: `me-note-${now}`, at: now + 1, text: CANT_SEND_TEXT, failed: {} },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID="home">
      {/* 키보드: 입력 줄과 목록을 키보드만큼 함께 올린다(react-native-keyboard-controller, 키보드 움직임과 같은 프레임).
          뒤집힌 목록은 화면이 줄어도 새 말 자리가 그대로라 따로 고칠 것이 없다(Happy docs/chat-list-scrolling.md "Why the list is inverted"). */}
      <KeyboardAvoidingView style={st.fill} behavior="translate-with-padding">
        {/* 머리 한 줄: 지금 할 일(누르면 지금 할 일 화면) + ⋮(설정). 연결 전에는 앱 이름. */}
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
        {/* PC가 켜져 있으면 아무것도 두지 않는다. 꺼져 있으면 바 아래 가운데 회색 한 줄(누르면 연결 상태). */}
        {paired && s.pc !== 'online' && (
          <Pressable testID="pc-status" accessibilityRole="button" accessibilityLabel={`${pcHint(s.pc)}. 연결 상태 보기`} onPress={() => go('connection')} style={st.pcHint}>
            <T v="meta" c={s.pc === 'stale' ? 'attention' : 'ink3'} center>
              {pcHint(s.pc)}
            </T>
          </Pressable>
        )}

        <View style={st.fill}>
        {!paired || items.length === 0 ? (
          <ScrollView style={st.fill} contentContainerStyle={[st.chat, !paired && { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" testID="chat">
            {!paired ? <Intro onPair={() => go('pair')} /> : <Starter phoneAnswers={phoneAnswers} onPick={pick} />}
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
            // Mattermost post_list.tsx 값: 처음 10개, 한 번에 5개, 창 10
            initialNumToRender={10}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={100}
            windowSize={10}
            testID="chat"
            // 뒤집힌 목록의 머리는 화면 맨 아래다: 기다림 점, 답 칩, 화면 단추
            ListHeaderComponent={
              <View style={st.listEnd}>
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
              // data는 뒤집혀 있다: 원래 순서의 자리
              const i = items.length - 1 - index;
              const stamp = stampBefore(items, i);
              return (
                <View style={st.row}>
                  {stamp !== null && <Stamp text={stamp} first={i === 0} />}
                  {it.kind === 'run' ? (
                    <RunItem jobId={it.jobId} go={go} />
                  ) : (
                    <Item it={it} group={bubbleGroup(items, i)} onRetry={(id) => void offline.retry(id)} retryOff={offline.busy} openDrafts={offline.openDrafts} onIssue={issueFrom} cpOf={cpOf} stale={s.pc === 'stale'} />
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
    </SafeAreaView>
  );
}

/**
 * 대화 위 끝의 흐림(20pt): 위로 올라간 줄이 칼로 자른 듯 잘리지 않고 바탕색으로 녹아든다.
 * 그라데이션 묶음 없이 바탕색 띠 열 장(2pt씩)을 겹친다. 선은 긋지 않는다(머리카락 선은 바닥 줄에만).
 */
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

/**
 * 맨 아래로 단추(Mattermost scroll_to_end_view.tsx: 끝에서 160 넘게 올라가면 화살표, 새 말이 왔으면 글자 알약. Happy ChatList는 화살표만).
 * 새 말이 왔으면 [새 답], 아니면 화살표만. 누르면 맨 아래로. 대화를 밀지 않는다. 겉모양은 Muse 면 색(tint)과 알약.
 */
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

/** 모델이 연 화면(open_screen) 단추 이름 */
const SCREEN_LABEL: Record<PhoneScreen, string> = { capture: '증빙 찍기', cash: '현금 매출 적기', bizreg: '사업자등록증 찍기', issue: '세금계산서 발급' };

/** 이 폰이 대화를 부를 수 없을 때 한 줄 */
const CANT_SEND_TEXT = '이 폰에서는 아직 대화를 보낼 수 없어요. 앱을 다시 열거나 설정에서 PC 연결을 확인해 주세요.';

/** 머리 바 아래 회색 한 줄(PC가 켜져 있지 않을 때만) */
function pcHint(pc: PcStatus): string {
  switch (pc) {
    case 'connecting':
      return 'PC를 찾고 있어요';
    case 'stale':
      return 'PC가 오래 꺼져 있어요. 켜 두거나 연결을 확인해 주세요';
    default:
      return 'PC가 꺼져 있어요. 켜지면 바로 할게요';
  }
}

/** 글꼴 없이 그린 세로 점 셋(⋮) */
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

/** 지금 할 일: 머리 바 왼쪽의 글자 한 줄(면 없이). 할 일이 있으면 누르면 지금 할 일 화면, 없으면 "없음"만 옅게. */
function TodoLine({ todo, onPress }: { todo: Todo; onPress: () => void }) {
  const p = usePalette();
  // 묶음 안은 줄을 바꾸지 않는다(큰 글자에서 "밀린 / 일 1건"처럼 끊기지 않게, 붙은 칸 U+00A0).
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

/** 연결 전 홈: 할 일은 하나뿐이라 주 단추 하나([PC와 연결] → QR 찍기). */
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

/** 대화 안 진행·결과 카드. 누르면 진행 화면, 결과면 [서류 보기]로 서류 보기. */
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

function Item({ it, group, onRetry, retryOff, openDrafts, onIssue, cpOf, stale }: { it: Exclude<ChatItem, { kind: 'run' }>; group: { first: boolean; last: boolean }; onRetry: (noteId: string) => void; retryOff?: boolean; openDrafts?: ReadonlySet<string>; onIssue: OnIssue; cpOf: (id: string) => Counterparty | null; stale: boolean }) {
  const p = usePalette();
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
    // 못 한 일: 체크 없이 이유 한 줄, 다시 할 수 있으면 [다시 보내기]
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
  // 묶음 안에서 이어 붙은 귀퉁이만 6(Muse): 상대 말은 왼쪽, 내 말은 오른쪽
  const side = me ? 'Right' : 'Left';
  const corners = { [`borderTop${side}Radius`]: group.first ? 22 : 6, [`borderBottom${side}Radius`]: group.last ? 22 : 6 };
  return (
    <View style={[st.msg, !group.first && st.follow, me ? st.mine : st.theirs]} testID={`chat-${it.from}`}>
      {it.text !== undefined && (
        <View style={[st.bubble, { backgroundColor: me ? p.bubbleMe : p.bubbleThem }, corners, it.reaction && st.reacted]} testID="chat-bubble">
          <T style={me ? { color: p.onBubbleMe } : undefined}>{it.text}</T>
          {it.reaction && <Reaction id={it.reaction} />}
        </View>
      )}
      {it.card && (
        <Card
          card={it.card}
          // 이 폰이 띄운 카드는 맡기기 전까지, 모델 카드는 폰 대화가 열어 둔 동안 단추가 붙는다
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

/** 판정이 고른 반응(ADR-057, @sax/chat-core REACTIONS). 이름 밖의 값은 그리지 않는다. */
const REACTION_EMOJI: Record<ReactionId, string> = { thumbs_up: '👍', eyes: '👀', check: '✅', pray: '🙏' };
const REACTION_LABEL: Record<ReactionId, string> = { thumbs_up: '좋아요', eyes: '보고 있어요', check: '확인', pray: '감사해요' };

/**
 * 말풍선 반응 알약(Muse 12.1 s2n): 말풍선 아래 끝 귀퉁이(끝 4, 아래 -20), 높이 28, 최소 폭 38, 옆 8.5, 글자 16.
 * 바탕은 상대 말풍선 색, 테두리 2는 대화 바탕색이라 겹친 곳이 끊겨 보인다. 0.12초에 커지며 나온다(동작 줄이기면 바로).
 */
function Reaction({ id }: { id: ReactionId }) {
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
  }, [a, id]);
  if (!Object.hasOwn(REACTION_EMOJI, id)) return null;
  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={REACTION_LABEL[id]}
      testID={`chat-reaction-${id}`}
      style={[st.reaction, { backgroundColor: p.bubbleThem, borderColor: p.canvas, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]}
    >
      <Text style={st.reactionGlyph}>{REACTION_EMOJI[id]}</Text>
    </Animated.View>
  );
}

/** 시각 줄(Muse): 가운데 작은 한 줄. 대화 첫 줄은 위를 더 띄운다(40). */
function Stamp({ text, first }: { text: string; first: boolean }) {
  const p = usePalette();
  return (
    <T v="meta" center style={[{ color: p.stamp }, first && { marginTop: space.s7 - space.s4 }]} testID="chat-stamp">
      {text}
    </T>
  );
}

/**
 * 답을 기다리는 동안(Muse 12.1과 같은 움직임, 글자 없이): 상대 말풍선 안 점 셋.
 * 점마다 1초 주기로 2pt 오르내리고(0, 150, 300ms 늦게), 진한 점이 400ms마다 다음 점으로 옮겨 간다(색 바뀜 200ms).
 * 보낸 뒤 180ms 기다렸다가 8pt 아래에서 300ms 동안 떠오르며 나타난다. 동작 줄이기 설정이면 움직이지 않는다.
 */
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
    // 색을 함께 움직이므로 모두 JS 구동(점 셋뿐이라 부담 없음)
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

/** 대화가 비었을 때: 무엇을 할 수 있는지 한 줄 + 눌러서 넣는 예시 문장 셋 */
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

/** 증빙 사진 줄: 자리와 흐린 미리보기를 먼저, 원본이 이 폰 보관함에 있으면 열어서 겹친다(PC가 받으면 원본은 지워져 미리보기만 남는다). */
function CardPhoto({ photo, label }: { photo: NonNullable<ChatCard['photo']>; label: string }) {
  const s = useSession();
  const id = photo.msgId;
  const load = useMemo(() => (id ? () => s.outbox.readPhoto(id).then(jpegUri, () => null) : undefined), [id, s.outbox]);
  return <PhotoSlot thumb={photo.thumb} load={load} label={label} />;
}

/** 세금계산서 카드의 값 글자(오른쪽 맞춤) */
function CardValue({ text, strong, quiet }: { text: string; strong?: boolean; quiet?: boolean }) {
  return (
    <T v={strong ? 'figure' : 'value'} c={quiet ? 'ink4' : 'ink'} style={{ flexShrink: 1, textAlign: 'right' }}>
      {text}
    </T>
  );
}

function CardRow({ label, value, strong, children, fixed, flap }: { label: string; value?: string; strong?: boolean; children?: React.ReactNode; /** 칸이 들어가도 같은 높이(44) */ fixed?: boolean; /** 라벨이 바뀔 때 글자가 차르륵 바뀐다 */ flap?: boolean }) {
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

/**
 * 세금계산서 카드: 금액, 부가세(기본 별도), 합계, 품목. 아래 [발급하기] [수정].
 * [수정]을 누르면 그 자리에서 금액과 품목은 입력 칸, 부가세는 [별도|포함]으로 바뀌고 단추는 [취소] [완료]가 된다.
 * 맡긴 카드(onIssue 없음)는 값만 보인다.
 * [+] 발급 시트에서 띄운 카드도 같다. 금액이 없으면(처음 거래하는 곳) 수정 상태로 열고 금액 칸에 들어간다.
 */
function DraftCard({ card, draft, onIssue, cp, stale }: { card: ChatCard; draft: Draft; onIssue?: OnCardIssue; cp: Counterparty | null; stale: boolean }) {
  const p = usePalette();
  const [val, setVal] = useState({ amount: draft.amount, vat: (draft.vat === 'included' ? 'incl' : 'excl') as VatMode, item: draft.item ?? '' });
  const openEdit = !!onIssue && !!draft.phone?.edit;
  const [edit, setEdit] = useState<null | { amount: string; vat: VatMode; item: string }>(openEdit ? { amount: draft.amount > 0 ? masked('won', String(draft.amount)) : '', vat: val.vat, item: val.item } : null);
  // 휴·폐업으로 조회된 곳: 카드에 한 줄로 알리고 단추를 [그래도 발급]으로
  const closed = cp?.status?.kind === 'closed' ? cp.status : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = edit ? { amount: Number(edit.amount.replace(/\D/g, '')), vat: edit.vat, item: edit.item } : val;
  const a = splitAmount(shown.amount, shown.vat);
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
  // 어두운 화면에서는 토글 바탕을 카드보다 어둡게(고른 칸이 밝게 떠 보이게)
  const dark = p.overlay === p.tint;
  const inputStyle = [st.cardInput, { backgroundColor: p.canvas, color: p.ink, borderColor: p.line }];
  return (
    <View style={[st.card, st.cardDraft, { backgroundColor: p.tint }]} testID="chat-card">
      <T v="subStrong" style={{ paddingBottom: space.s1 }}>{card.title}</T>
      {/* 보기와 수정이 같은 네 줄, 같은 높이(44): [수정]을 눌러도 카드 높이가 바뀌지 않는다 */}
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

/** [+] 메뉴의 한 줄: 할 일 이름과 한 줄 설명 */
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

/** 글꼴 없이 그린 더하기(열리면 45도 돌아 닫기 ×가 된다) */
function Plus({ color, open }: { color: string; open: boolean }) {
  return (
    <View style={{ width: 14, height: 14, transform: [{ rotate: open ? '45deg' : '0deg' }] }}>
      <View style={{ position: 'absolute', left: 6, top: 0, width: 2, height: 14, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: 6, left: 0, width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

/** 보내기: 입력 칸 안 오른쪽의 작은 원(위쪽 화살표). 적은 말이 없으면 옅게. */
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
  pcHint: { paddingHorizontal: space.s5, paddingTop: space.s1, paddingBottom: space.s1, minHeight: 28, justifyContent: 'center' },
  topBtn: { minWidth: size.hit, minHeight: size.hit, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  lines: { paddingHorizontal: space.s5, gap: space.s2, paddingBottom: space.s2 },
  pcLine: { minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s3, marginHorizontal: -space.s2, paddingHorizontal: space.s2, borderRadius: radius.md },
  todo: { flex: 1, minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingLeft: space.s1 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  newReplyWrap: { position: 'absolute', left: 0, right: 0, bottom: space.s3, alignItems: 'center' },
  endOnly: { paddingLeft: 0, paddingRight: 0, width: 36, justifyContent: 'center' },
  /** 뒤집힌 목록: 줄 사이는 칸마다 위 여백(묶음 사이 16), 바닥 여백은 머리(화면 아래) 쪽 */
  list: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s3 },
  row: { gap: space.s4, paddingTop: space.s4 },
  listEnd: { gap: space.s4, paddingTop: space.s4 },
  newReply: { flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 36, paddingLeft: space.s3, paddingRight: space.s4, borderRadius: radius.full, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  chat: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s4, flexGrow: 1, justifyContent: 'flex-end' },
  msg: { gap: space.s1, alignSelf: 'stretch' },
  /** 같은 쪽이 잇달아 한 말: 묶음 사이(16)보다 훨씬 붙인다(4) */
  follow: { marginTop: -(space.s4 - space.s1) },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  /** Muse: 높이 44, 옆 15, 둥글기 22, 점 지름 8 간격 4 */
  typing: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 15, borderRadius: 22 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  /** 반응이 달린 말풍선: 알약이 아래로 20 나오므로 그만큼 아래를 띄운다 */
  reacted: { marginBottom: 12 },
  reaction: { position: 'absolute', right: 4, bottom: -20, height: 28, minWidth: 38, paddingHorizontal: 8.5, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  reactionGlyph: { fontSize: 16, lineHeight: 18 },
  /** Muse: 둥글기 22, 최소 높이 44, 옆 15 위아래 11 */
  /** 말풍선은 양쪽 다 글 폭만큼, 반대편에 조금 여백을 남긴다(Muse 폰 앱). 카드만 대화 폭을 다 쓴다. */
  bubble: { borderRadius: 22, minHeight: 44, maxWidth: '90%', paddingHorizontal: 15, paddingVertical: 11, justifyContent: 'center' },
  /** 카드는 말풍선보다 넓게, 대화 폭을 다 쓴다 */
  card: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  /** 세금계산서 카드는 줄 높이(44)가 간격을 맡는다 */
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
  input: { flex: 1, minHeight: size.hit, maxHeight: 132, paddingLeft: space.s4, paddingRight: space.s2, paddingTop: 10, paddingBottom: 10 },
});
