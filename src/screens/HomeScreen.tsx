// 폰 첫 화면(08 §10). 할 일은 둘뿐이다: 종이 증빙 찍기, 현금 매출 적기.
// 맨 위 한 줄은 PC 연결 상태(점 + 글자)와 보낼 것 건수. 누르면 연결 상태(P-06).
// 대시보드 숫자 타일은 두지 않는다(design-system v2.0). 오늘 적은 현금 매출만 줄의 값으로 보인다.
import { Pressable, StyleSheet, View } from 'react-native';
import { BRAND } from '../config';
import { useSession } from '../session';
import type { PcStatus } from '../net/pc';
import { size, space, usePalette } from '../theme';
import type { RecentRecord } from '../storage/state';
import { Button, Check, Chevron, Group, Row, Screen, StatusDot, T, ago, won, type Tone } from '../ui/kit';
import { localDay } from './CashScreen';

export type HomeRoute = 'pair' | 'capture' | 'cash' | 'connection';

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

export function HomeScreen({ go }: { go: (to: HomeRoute) => void }) {
  const s = useSession();
  const p = usePalette();
  const paired = !!s.data.pair;
  const waiting = s.pending.receipts + s.pending.cash;
  const line = pcLine(s.pc, s.data.lastSeenPc);
  const today = s.data.cash.find((c) => c.day === localDay());

  return (
    <Screen testID="home">
      <View style={st.top}>
        <T v="title">{BRAND}</T>
        <Pressable
          testID="pc-status"
          accessibilityRole="button"
          accessibilityLabel={`${line.label}${waiting ? `, 보낼 것 ${waiting}건` : ''}. 연결 상태 보기`}
          onPress={() => go('connection')}
          hitSlop={8}
          style={({ pressed }) => [st.status, { backgroundColor: pressed ? p.sunken : p.tint }]}
        >
          <StatusDot tone={line.tone} label={line.label} busy={line.busy} v="label" />
          {waiting > 0 && (
            <T v="meta" c="ink3" testID="pending-count">
              · {waiting}건 대기
            </T>
          )}
        </Pressable>
      </View>

      {!paired ? (
        <View style={[st.hero, { backgroundColor: p.tint }]} testID="unpaired">
          <View style={{ gap: space.s2 }}>
            <T v="strong">먼저 PC와 연결해 주세요</T>
            <T v="sub" c="ink2">
              PC의 {BRAND} → 설정 → [폰 연결]에 뜬 QR을 이 폰으로 찍으면 돼요. 한 번만 하면 돼요.
            </T>
          </View>
          <Button testID="go-pair" label="PC와 연결하기" onPress={() => go('pair')} />
        </View>
      ) : (
        s.pc === 'stale' && (
          <View style={[st.hero, { backgroundColor: p.attentionSoft }]}>
            <T v="sub" c="attention" testID="stale-note">
              PC가 일주일 넘게 꺼져 있어 보낼 수 없어요. PC를 켜 두거나 다시 연결해 주세요.
            </T>
            <Button testID="re-pair" kind="secondary" small label="다시 연결하기" onPress={() => go('pair')} />
          </View>
        )
      )}

      <View style={{ gap: space.s3 }}>
        <Action
          testID="go-capture"
          title="종이 증빙 찍기"
          sub="영수증 · 종이 세금계산서 · 계산서"
          disabled={!paired}
          onPress={() => go('capture')}
          primary
        />
        <Group>
          <Row2 testID="go-cash" title="현금 매출 적기" value={today ? won(today.amount) : '오늘 아직 안 적음'} valueInk={today ? 'ink' : 'ink3'} disabled={!paired} onPress={() => go('cash')} />
        </Group>
        {!paired && (
          <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
            PC와 연결하면 쓸 수 있어요.
          </T>
        )}
      </View>

      {s.data.recent.length > 0 ? (
        <Group title="최근 보낸 종이 증빙" testID="recent" note="사진은 사진 앱에 남지 않고, PC가 받으면 지워요.">
          {s.data.recent.slice(0, 5).map((r) => (
            <Row
              key={r.msgId}
              label={r.title}
              sub={`${KIND[r.kind]} · ${when(r.at)}`}
              value={r.amount !== null ? won(r.amount) : '—'}
              valueInk={r.amount !== null ? 'ink' : 'ink4'}
              accessory={<StateMark state={r.state} />}
            />
          ))}
        </Group>
      ) : (
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          찍은 사진은 사진 앱에 남지 않아요. PC가 받으면 이 폰에서 지우고, PC는 원본과 읽은 값을 함께 세무사 꾸러미에 넣어요.
        </T>
      )}
    </Screen>
  );
}

const KIND: Record<RecentRecord['kind'], string> = { receipt: '영수증', tax_invoice: '세금계산서', invoice: '계산서' };

function when(at: number, now = Date.now()): string {
  const d = new Date(at);
  const t = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === t.toDateString()) return `오늘 ${hm}`;
  if (new Date(now - 86_400_000).toDateString() === d.toDateString()) return `어제 ${hm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** PC가 받았으면 체크, 아니면 대기 점(글자 대신 모양, 읽기 도구에는 글자로) */
function StateMark({ state }: { state: RecentRecord['state'] }) {
  const p = usePalette();
  const label = state === 'sent' ? 'PC 받음' : state === 'queued' ? 'PC가 켜지면 받음' : '보낼 예정';
  return (
    <View accessible accessibilityLabel={label} style={{ width: 16, alignItems: 'center' }}>
      {state === 'sent' ? <Check color={p.ink3} /> : <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: p.ink3 }} />}
    </View>
  );
}

/** 주된 할 일 한 칸: 제목 17/600 + 보조 15, 오른쪽 꺾쇠. ink 채움(이 화면의 주요 동작 하나). */
function Action({ title, sub, onPress, disabled, testID, primary }: { title: string; sub: string; onPress: () => void; disabled?: boolean; testID?: string; primary?: boolean }) {
  const p = usePalette();
  const bg = disabled ? p.tint : primary ? p.ink : p.tint;
  const fg = disabled ? 'ink4' : primary ? 'onInk' : 'ink';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [st.action, { backgroundColor: pressed && !disabled ? p.ink2 : bg }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T v="strong" c={fg}>
          {title}
        </T>
        <T v="sub" c={disabled ? 'ink4' : primary ? 'onInk' : 'ink2'} style={primary && !disabled ? { opacity: 0.72 } : undefined}>
          {sub}
        </T>
      </View>
      <Chevron color={disabled ? p.ink4 : primary ? p.onInk : p.ink3} />
    </Pressable>
  );
}

function Row2({ title, value, valueInk, onPress, disabled, testID }: { title: string; value: string; valueInk: 'ink' | 'ink3'; onPress: () => void; disabled?: boolean; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: p.sunken }]}
    >
      <T v="strong" c={disabled ? 'ink4' : 'ink'} style={{ flex: 1 }}>
        {title}
      </T>
      <T v="value" c={disabled ? 'ink4' : valueInk}>
        {value}
      </T>
      <Chevron color={p.ink4} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: size.header },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.s1, borderRadius: 9999, paddingHorizontal: space.s3, minHeight: 32 },
  hero: { borderRadius: 16, padding: space.s5, gap: space.s4 },
  action: { borderRadius: 16, minHeight: 88, paddingHorizontal: space.s5, paddingVertical: space.s4, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  row: { minHeight: 64, paddingHorizontal: space.s5, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
