import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { enqueueCash, makeCashEntry } from '@sax/remote';
import { useSession } from '../session';
import { MAX_FONT_SCALE, radius, space, type, usePalette } from '../theme';
import { masked } from '../ui/field';
import { Button, Chevron, Group, Row, Screen, T, success, won } from '../ui/kit';

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shift(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + n));
}
const label = (day: string, today: string) => (day === today ? '오늘' : day === shift(today, -1) ? '어제' : `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`);

export function CashScreen({ onDone }: { onDone: () => void }) {
  const s = useSession();
  const p = usePalette();
  const today = localDay();
  const [day, setDay] = useState(today);
  const existing = s.data.cash.find((c) => c.day === day);
  const [text, setText] = useState(existing ? masked('won', String(existing.amount)) : '');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (d: string) => {
    setDay(d);
    const e = s.data.cash.find((c) => c.day === d);
    setText(e ? masked('won', String(e.amount)) : '');
    setErr(null);
  };

  async function save() {
    const n = Number(text.replace(/[,\s원]/g, ''));
    if (!text.trim() || !Number.isSafeInteger(n) || n < 0 || n > 100_000_000_000) return setErr('금액을 숫자로 적어 주세요. 현금 매출이 없으면 0을 적어요.');
    setBusy(true);
    try {
      const e = makeCashEntry(day, n);
      await enqueueCash(s.outbox, e);
      await s.update((d) => ({
        ...d,
        cash: [{ day, amount: n, msgId: e.msgId, state: 'pending' as const }, ...d.cash.filter((c) => c.day !== day)].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 400),
      }));
      await s.refreshPending();
      success();
      void s.sync();
      onDone();
    } catch {
      setErr('저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  const canNext = day < today;
  const canPrev = day > shift(today, -31);
  const changed = existing ? String(existing.amount) !== text.replace(/\D/g, '') : true;
  return (
    <Screen
      title="현금 매출"
      onBack={onDone}
      testID="cash-screen"
      footer={<Button testID="cash-save" label={existing ? '고쳐서 PC로 보내기' : '저장하고 PC로 보내기'} onPress={save} busy={busy} disabled={!text || !changed} />}
    >
      <View style={{ gap: space.s4 }}>
        <View style={st.dayRow}>
          <Step dir="left" label="하루 전" onPress={() => pick(shift(day, -1))} disabled={!canPrev} />
          <View style={{ alignItems: 'center' }}>
            <T v="strong" testID="cash-day">
              {label(day, today)}
            </T>
            <T v="meta" c="ink3">
              {weekday(day)}
            </T>
          </View>
          <Step dir="right" label="하루 뒤" onPress={() => pick(shift(day, 1))} disabled={!canNext} />
        </View>
        <View style={{ gap: space.s2 }}>
          <T v="label" c="ink3">
            영수증 없이 받은 현금 매출도 적어요
          </T>
          <Pressable onPress={() => input.current?.focus()} style={[st.amount, { backgroundColor: p.tint, borderColor: err ? p.attention : 'transparent' }]}>
            <TextInput
              ref={input}
              testID="cash-amount"
              accessibilityLabel="현금 매출 금액"
              value={text}
              onChangeText={(t) => {
                setErr(null);
                setText(masked('won', t));
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={p.ink4}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[type.figure, st.input, { color: p.ink }]}
              autoFocus
            />
            <T v="figure" c="ink2">
              원
            </T>
          </Pressable>
          {err ? (
            <T v="meta" c="attention">
              {err}
            </T>
          ) : (
            <T v="meta" c="ink3">
              {existing ? `이미 ${won(existing.amount)}을 적었어요. 새 숫자로 바꿔요.` : '현금 매출이 없던 날은 0을 적어요.'}
            </T>
          )}
        </View>
      </View>
      {s.data.cash.length > 0 && (
        <Group title="최근 기록">
          {s.data.cash.slice(0, 14).map((c) => (
            <Row
              key={c.day}
              label={label(c.day, today)}
              sub={c.state === 'sent' ? 'PC 받음' : c.state === 'queued' ? 'PC가 켜지면 받아요' : '보낼 예정'}
              value={won(c.amount)}
              valueInk={c.day === day ? 'ink' : 'ink2'}
              onPress={() => pick(c.day)}
              chevron={false}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}

function Step({ dir, label: l, onPress, disabled }: { dir: 'left' | 'right'; label: string; onPress: () => void; disabled: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={l}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [st.step, { backgroundColor: pressed ? p.sunken : p.tint }]}
    >
      <Chevron dir={dir} color={disabled ? p.ink4 : p.ink} />
    </Pressable>
  );
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function weekday(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${m}월 ${d}일 ${WEEK[new Date(y, m - 1, d).getDay()]}요일`;
}

const st = StyleSheet.create({
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  amount: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.s4, flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  input: { flex: 1, textAlign: 'right', paddingVertical: space.s3 },
});
