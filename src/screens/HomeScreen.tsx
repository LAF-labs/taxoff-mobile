// 홈 = PC와 나누는 하나의 대화(기획 v2 PR 1). 위에서부터:
//   PC 연결 한 줄(켜짐 파랑 점 · 꺼짐 마지막 접속 · 오래 꺼짐 황토 · 연결 안 됨). 연결 전에는 가운데 안내 면의 [PC와 연결] 하나
//   지금 할 일 한 줄(승인 대기 · 밀린 일 건수 → 지금 할 일)
//   대화(PC 답은 글자, 카드 답은 tint 면, 내 말은 오른쪽 tint 말풍선, 폰에서 나눈 구간 머리)
//   바닥: 빠른 일 [세금계산서 발급] [찍기] [현금] + 입력 줄(보내기). 키보드가 올라오면 함께 올라간다.
// 이 PR은 화면만 바꾼다. 적은 말은 이 화면에만 남고 아직 PC로 가지 않는다(대화 프로토콜은 다음 PR).
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatFromData, clockRange, metaOf, type ChatCard, type ChatItem } from '../chat';
import { useOfflineChat, type OfflineChatView } from '../offline/useOfflineChat';
import { BRAND } from '../config';
import { queueCounts } from '../queue';
import { useQueue } from '../queueStore';
import { RunCard } from './RunCard';
import { useSession } from '../session';
import type { PcStatus } from '../net/pc';
import { MAX_FONT_SCALE, radius, size, space, textScale, type, usePalette } from '../theme';
import { Button, Check, Chevron, Notice, Pill, StatusDot, T, ago, tap, type Tone } from '../ui/kit';

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

/** 홈 머리의 PC 한 줄(대화 홈용). 꺼져 있으면 마지막 접속을 함께 쓴다. */
export function homeLine(pc: PcStatus, lastSeen: number | null): { tone: Tone; label: string; busy?: boolean } {
  switch (pc) {
    case 'online':
      return { tone: 'accent', label: 'PC 켜짐' };
    case 'connecting':
      return { tone: 'quiet', label: 'PC 찾는 중', busy: true };
    case 'stale':
      return { tone: 'attention', label: `PC가 오래 꺼져 있어요 · 마지막 접속 ${ago(lastSeen)}` };
    case 'unpaired':
      return { tone: 'quiet', label: 'PC 연결 안 됨' };
    default:
      return { tone: 'quiet', label: lastSeen ? `PC 꺼짐 · 마지막 접속 ${ago(lastSeen)}` : 'PC 꺼짐' };
  }
}

export interface Todo {
  /** PC가 사장님 승인을 기다리는 일(폰 승인은 준비 중이라 앱에서는 0) */
  approvals: number;
  /** 아직 PC로 못 간 것(사진·현금 매출) */
  backlog: number;
}

export function HomeScreen({ go, chat, todo, draft = '', phone }: { go: (to: HomeRoute) => void; chat?: ChatItem[]; todo?: Todo; draft?: string; /** 갤러리: 폰 대화 상태를 정해 그린다(네트워크 없음) */ phone?: OfflineChatView }) {
  const s = useSession();
  const p = usePalette();
  const paired = !!s.data.pair;
  const line = homeLine(s.pc, s.data.lastSeenPc);
  const q = useQueue();
  const qc = queueCounts(q.jobs, Date.now());
  const t = todo ?? { approvals: qc.approvals, backlog: qc.backlog + s.pending.receipts + s.pending.cash };
  const [mine, setMine] = useState<ChatItem[]>([]);
  const [text, setText] = useState(draft);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const off = s.pc === 'offline' || s.pc === 'queued';
  /** PC가 꺼져 있으면 폰이 대화를 이어 받는다(기획 v2). */
  const pcOff = off || s.pc === 'stale';

  // PC가 꺼져 있으면 폰이 게이트웨이를 거쳐 직접 답한다(ADR-047). 켜져 있을 때의 PC 대화는 아직 화면만 있다.
  const live = useOfflineChat();
  const offline = phone ?? live;
  const phoneAnswers = pcOff && offline.available;
  const items = [...(chat ?? chatFromData(s.data)), ...q.notes, ...mine, ...(chat && !phone ? [] : offline.items)].sort((a, b) => at(a) - at(b));
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  /** 예시 문장을 누르면 입력 칸에 넣고 바로 고칠 수 있게 한다(보내지는 않는다) */
  const pick = (v: string) => {
    setText(v);
    input.current?.focus();
  };
  const send = () => {
    const v = text.trim();
    if (!v || offline.busy) return;
    setText('');
    if (phoneAnswers) {
      void offline.send(v);
      return;
    }
    setMine((m) => [...m, { kind: 'msg', id: `me-${Date.now()}`, from: 'me', at: Date.now(), text: v, state: 'waiting' }]);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID="home">
      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.top}>
          <T v="title" role="header">
            {BRAND}
          </T>
          <Pressable
            testID="go-settings"
            accessibilityRole="button"
            accessibilityLabel="설정"
            onPress={() => go('settings')}
            style={({ pressed }) => [st.topBtn, pressed && { backgroundColor: p.tint }]}
          >
            <T v="subStrong" c="ink2">
              설정
            </T>
          </Pressable>
        </View>

        <View style={st.lines}>
          {paired ? (
            <Pressable
              testID="pc-status"
              accessibilityRole="button"
              accessibilityLabel={`${line.label}. 연결 상태 보기`}
              onPress={() => go('connection')}
              style={({ pressed }) => [st.pcLine, pressed && { backgroundColor: p.tint }]}
            >
              <View style={{ flex: 1 }}>
                <StatusDot tone={line.tone} label={line.label} busy={line.busy} v="sub" />
              </View>
              <Chevron color={p.ink4} />
            </Pressable>
          ) : (
            <View style={st.pcLine}>
              <View style={{ flex: 1 }}>
                <StatusDot tone="quiet" label={line.label} v="sub" testID="pc-status" />
              </View>
            </View>
          )}
          {paired && <TodoLine todo={t} onPress={() => go('queue')} />}
        </View>

        <View style={st.fill}>
        <ScrollView
          ref={list}
          style={st.fill}
          contentContainerStyle={[st.chat, !paired && { justifyContent: 'center' }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          testID="chat"
        >
          {!paired ? (
            <Intro onPair={() => go('pair')} />
          ) : items.length === 0 ? (
            <Starter phoneAnswers={phoneAnswers} onPick={pick} />
          ) : (
            items.map((it) =>
              it.kind === 'run' ? (
                <RunItem key={it.id} jobId={it.jobId} go={go} />
              ) : (
                <Item key={it.id} it={it} onRetry={(id) => void offline.retry(id)} retryOff={offline.busy} />
              ),
            )
          )}
          {paired && phoneAnswers && offline.busy && <Typing />}
          {paired && phoneAnswers && !offline.busy && offline.chips.length > 0 && (
            <View style={st.replies} testID="chat-chips">
              {offline.chips.map((c) => (
                <Chip key={c.label} label={c.label} onPress={() => void offline.send(c.text)} />
              ))}
            </View>
          )}
          {/* 폰이 답할 때는 빈 대화 안내가 같은 말을 하므로 대화가 있을 때만 한 줄 */}
          {paired && off && !phoneAnswers && <Notice tone="quiet" testID="pc-off-note">PC가 꺼져 있어요. 시키신 일은 PC를 켜면 시작해요</Notice>}
          {paired && off && phoneAnswers && items.length > 0 && <Notice tone="quiet" testID="pc-off-note">PC가 꺼져 있어 폰이 대신 답해요. 발급은 PC를 켜면 시작해요</Notice>}
          {paired && s.pc === 'stale' && <Notice testID="pc-stale-note">PC가 일주일 넘게 꺼져 있어요. PC를 켜 두거나 다시 연결해 주세요</Notice>}
        </ScrollView>
        <TopFade />
        </View>

        {paired && (
          <View style={[st.bottom, { borderTopColor: p.line, backgroundColor: p.canvas }]}>
            <View style={st.chips}>
              <Chip label="세금계산서 발급" onPress={() => go('issue')} testID="chip-issue" />
              <Chip label="찍기" onPress={() => go('capture')} testID="go-capture" />
              <Chip label="현금" onPress={() => go('cash')} testID="go-cash" />
            </View>
            <View style={st.inputRow}>
              <TextInput
                ref={input}
                testID="chat-input"
                value={text}
                onChangeText={setText}
                placeholder={phoneAnswers ? '궁금한 것이나 시킬 일' : 'PC에 시킬 일'}
                placeholderTextColor={p.ink3}
                accessibilityLabel={phoneAnswers ? '궁금한 것이나 시킬 일 적기' : 'PC에 시킬 일 적기'}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                multiline
                numberOfLines={1}
                onSubmitEditing={send}
                style={[
                  type.body,
                  textScale.web !== 1 && { fontSize: type.body.fontSize * textScale.web, lineHeight: type.body.lineHeight * textScale.web },
                  st.input,
                  { backgroundColor: p.tint, color: p.ink },
                ]}
              />
              <Button testID="chat-send" small label="보내기" onPress={send} disabled={!text.trim() || (phoneAnswers && offline.busy)} />
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

const at = (it: ChatItem) => (it.kind === 'merged' ? it.from : it.at);

/** 지금 할 일 한 줄. 없으면 누르지 않는 줄로 "없음"만 보인다. */
function TodoLine({ todo, onPress }: { todo: Todo; onPress: () => void }) {
  const p = usePalette();
  // 묶음 안은 줄을 바꾸지 않는다(큰 글자에서 "밀린 / 일 1건"처럼 끊기지 않게, 붙은 칸 U+00A0).
  const parts = [todo.approvals > 0 && `승인\u00A0대기\u00A0${todo.approvals}건`, todo.backlog > 0 && `밀린\u00A0일\u00A0${todo.backlog}건`].filter(Boolean).join(' · ');
  const body = (
    <>
      <T v="subStrong" style={{ flexShrink: 0 }}>
        지금 할 일
      </T>
      <T v="sub" c={parts ? 'ink' : 'ink3'} style={{ flex: 1, textAlign: 'right' }} testID="todo-counts">
        {parts || '없음'}
      </T>
      {parts ? <Chevron color={p.ink4} /> : null}
    </>
  );
  if (!parts) return <View style={[st.todo, { backgroundColor: p.tint }]} testID="todo">{body}</View>;
  return (
    <Pressable
      testID="todo"
      accessibilityRole="button"
      accessibilityLabel={`지금 할 일: ${parts.replace(/\u00A0/g, ' ')}`}
      onPress={onPress}
      style={({ pressed }) => [st.todo, { backgroundColor: pressed ? p.sunken : p.tint }]}
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
        PC의 {BRAND} → 설정 → [폰{'\u00A0'}연결]에 뜬 QR을 이 폰으로 찍으면 돼요. 한 번만 하면 돼요.
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
    />
  );
}

function Item({ it, onRetry, retryOff }: { it: Exclude<ChatItem, { kind: 'run' }>; onRetry: (noteId: string) => void; retryOff?: boolean }) {
  const p = usePalette();
  if (it.kind === 'merged') {
    return (
      <View style={st.mergedWrap} testID="chat-merged">
        <View style={[st.merged, { backgroundColor: p.tint }]}>
          <T v="meta" c="ink3" center>
            폰에서 나눈 대화 · {clockRange(it.from, it.to)}
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
  const meta = metaOf(it);
  return (
    <View style={[st.msg, me ? st.mine : st.theirs]} testID={`chat-${it.from}`}>
      {it.text !== undefined &&
        (me ? (
          <View style={[st.bubble, { backgroundColor: p.tint }]}>
            <T>{it.text}</T>
          </View>
        ) : (
          <T>{it.text}</T>
        ))}
      {it.card && <Card card={it.card} />}
      <T v="meta" c="ink4" style={me ? { textAlign: 'right' } : undefined}>
        {meta}
      </T>
    </View>
  );
}

/** 답을 쓰는 동안: 상대 쪽에 숨 쉬는 점 한 줄 */
function Typing() {
  return (
    <View style={st.msg} testID="chat-typing">
      <StatusDot tone="quiet" busy label="답을 쓰고 있어요" v="sub" />
    </View>
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

function Card({ card }: { card: ChatCard }) {
  const p = usePalette();
  return (
    <View style={[st.card, { backgroundColor: p.tint, alignSelf: 'stretch' }]} testID="chat-card">
      <T v="subStrong">{card.title}</T>
      {card.rows.map((r, i) => (
        <View key={i} style={st.cardRow}>
          <T v="sub" c="ink2" style={{ flexShrink: 1 }}>
            {r.label}
          </T>
          <T v={r.strong ? 'figure' : 'value'} style={{ flexShrink: 0, textAlign: 'right' }}>
            {r.value}
          </T>
        </View>
      ))}
      {card.note && (
        <T v="meta" c="ink3">
          {card.note}
        </T>
      )}
    </View>
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
  top: { minHeight: size.header, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.s5, paddingRight: space.s2 },
  topBtn: { minWidth: size.hit, minHeight: size.hit, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  lines: { paddingHorizontal: space.s5, gap: space.s2, paddingBottom: space.s2 },
  pcLine: { minHeight: size.hit, flexDirection: 'row', alignItems: 'center', gap: space.s3, marginHorizontal: -space.s2, paddingHorizontal: space.s2, borderRadius: radius.md },
  todo: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s2, borderRadius: radius.lg },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  chat: { paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s4, flexGrow: 1, justifyContent: 'flex-end' },
  msg: { gap: space.s1 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%' },
  theirs: { alignSelf: 'stretch', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s2 + 2 },
  card: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s3 },
  note: { flexDirection: 'row', gap: space.s2, alignItems: 'flex-start' },
  failed: { borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  starter: { gap: space.s4, paddingVertical: space.s4 },
  examples: { alignItems: 'flex-start', gap: space.s2 },
  mergedWrap: { alignItems: 'center', paddingVertical: space.s1 },
  merged: { borderRadius: radius.full, paddingHorizontal: space.s3, paddingVertical: space.s1 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s3, gap: space.s3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  chip: { minHeight: size.hit, paddingHorizontal: space.s4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s2 },
  input: { flex: 1, minHeight: size.hit, maxHeight: 132, borderRadius: 22, paddingHorizontal: space.s4, paddingTop: 10, paddingBottom: 10 },
});
