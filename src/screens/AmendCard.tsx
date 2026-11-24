import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { amendCardUpdate, type AmendCard as AmendState, type AmendField, type AmendWhat } from '@sax/chat-core';
import { MAX_FONT_SCALE, radius, size, space, type, usePalette } from '../theme';
import { Actions, Card, PickRows, Sheet, actionFlex } from '../ui/card';
import { Button, Chevron, Notice, T } from '../ui/kit';

/**
 * 수정세금계산서 카드(ADR-058 결정 5, 승인된 캔버스 "수정세금계산서 화면" 폰 1~4, 7).
 * 계산서가 여럿이면 먼저 고르고, 사유 여섯 줄(두 묶음)을 고르면 그 사유에서 홈택스가 사람에게 묻는 값만 줄로 보인다.
 * 값은 눌러서 그 자리에서 고치고, 금액 세 칸은 서로 따라 바뀐다. 계산은 모두 chat-core(PC와 같은 식)다.
 */
export type AmendIssue = 'sent' | 'save_failed' | 'new_counterparty';
const ISSUE_FAILED: Record<Exclude<AmendIssue, 'sent'>, string> = {
  save_failed: '폰에 저장하지 못해 맡기지 않았어요. 다시 눌러 주세요',
  new_counterparty: '이 거래처는 아직 폰에서 고칠 수 없어요',
};

const won = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}원`;
const md = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : d);

export function AmendCard({ card, onChange, onIssue, sent, stale }: { card: AmendState; onChange: (c: AmendState) => void; onIssue?: (c: AmendState) => Promise<AmendIssue>; sent?: boolean; stale?: boolean }) {
  const p = usePalette();
  const v = card.view;
  const [editing, setEditing] = useState<AmendField | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Exclude<AmendIssue, 'sent'> | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const update = (patch: Parameters<typeof amendCardUpdate>[1]) => {
    try {
      onChange(amendCardUpdate(card, patch));
    } catch {
      // 맞지 않는 값은 받지 않는다(카드는 그대로)
    }
  };
  const live = !!onIssue && !sent;
  const kind = v.icon === 'cancel' ? 'cancel' : 'amend';

  if (v.stage === 'which') {
    return (
      <Card kind={kind} title={v.title} testID="amend-card">
        <T v="subStrong" style={{ fontWeight: '600' }}>
          어느 계산서인가요?
        </T>
        <View style={{ gap: space.s2 }} testID="amend-which">
          {v.which.map((x, i) => (
            <Pick key={i} onPress={live ? () => update({ pick: i }) : undefined} testID={`amend-pick-${i}`}>
              <View style={{ flexDirection: 'row', gap: space.s2, flexShrink: 1 }}>
                <T v="value">{md(x.date)}</T>
                <T v="value" c="ink3" lines={1} style={{ flexShrink: 1 }}>
                  {x.item}
                </T>
              </View>
              <View style={sx.right}>
                <T v="value">{won(x.total)}</T>
                <Chevron color={p.ink4} sizePx={7} />
              </View>
            </Pick>
          ))}
        </View>
      </Card>
    );
  }

  const original = v.original && <Kv label="원래 계산서" value={`${md(v.original.date)}, ${won(v.original.total)}`} />;
  if (v.stage === 'what') {
    return (
      <Card kind={kind} title={v.title} testID="amend-card">
        {original}
        <T v="subStrong" style={{ fontWeight: '600', marginTop: space.s1 }}>
          사유를 골라 주세요
        </T>
        <View style={{ gap: space.s5 }} testID="amend-what">
          {v.groups.map((g, gi) => (
            <View key={gi} style={{ gap: space.s2 }}>
              {g.map((x) => (
                <Pick key={x.what} onPress={live ? () => update({ what: x.what }) : undefined} testID={`amend-what-${x.what}`}>
                  <T v="value">{x.label}</T>
                  <Chevron color={p.ink4} sizePx={7} />
                </Pick>
              ))}
            </View>
          ))}
        </View>
      </Card>
    );
  }

  const raw: Record<string, string> = { issueDate: card.values?.issueDate ?? '', counterpartBizNo: card.values?.counterpartBizNo ?? '', item: card.values?.item ?? '' };
  const first = v.amounts?.[0]?.field ?? v.rows.find((r) => r.edit)?.field ?? null;
  const issue = async () => {
    if (!onIssue || busy) return;
    setBusy(true);
    setFailed(null);
    const r = await onIssue(card);
    setBusy(false);
    if (r !== 'sent') setFailed(r);
  };
  return (
    <Card kind={kind} title={v.title} testID="amend-card">
      <View style={{ gap: space.s4 }}>
        {original}
        <Kv label="사유">
          <Pressable onPress={live ? () => setWhyOpen(true) : undefined} disabled={!live} accessibilityRole="button" accessibilityLabel={`사유 ${v.label}, 바꾸기`} style={sx.tap} testID="amend-repick">
            <T v="value">{v.label}</T>
            {live && <Chevron color={p.ink4} sizePx={7} />}
          </Pressable>
        </Kv>
        {v.rows.map((r) => (
          <Kv key={r.field} label={r.label}>
            {editing === r.field ? (
              <Edit field={r.field} value={raw[r.field]!} onDone={(x) => (setEditing(null), x !== null && update({ field: r.field, value: x }))} />
            ) : r.edit && live ? (
              <Pressable onPress={() => setEditing(r.field)} accessibilityRole="button" accessibilityLabel={`${r.label} ${r.value}, 고치기`} style={({ pressed }) => [sx.val, { backgroundColor: pressed ? p.sunken : p.canvas }]} testID={`amend-edit-${r.field}`}>
                <T v="value">{r.value}</T>
              </Pressable>
            ) : (
              <T v="value">{r.value}</T>
            )}
          </Kv>
        ))}
        {v.amounts && (
          <View style={{ gap: space.s4 }} testID="amend-amounts">
            {v.amounts.map((a) => (
              <View key={a.field} style={{ gap: space.s2 }}>
                <Kv label={a.label}>
                  <T v="value" c="ink3">{`기존 ${won(a.before)}`}</T>
                </Kv>
                {editing === a.field ? (
                  <Edit field={a.field} value={String(a.after)} big onDone={(x) => (setEditing(null), x !== null && update({ field: a.field, value: Number(x.replace(/\D/g, '')) }))} />
                ) : (
                  <Pressable onPress={live ? () => setEditing(a.field) : undefined} accessibilityRole="button" accessibilityLabel={`${a.label} ${won(a.after)}, 고치기`} style={({ pressed }) => [sx.field, { backgroundColor: pressed && live ? p.sunken : p.canvas }]} testID={`amend-field-${a.field}`}>
                    <T v="figure">{won(a.after)}</T>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
      {v.notice && (
        <Notice testID="amend-notice">{v.notice}</Notice>
      )}
      {failed && (
        <T v="meta" c="attention" testID="amend-failed">
          {ISSUE_FAILED[failed]}
        </T>
      )}
      {live && (
        <Actions>
          <Button testID="amend-issue" label="발급하기" onPress={() => void issue()} busy={busy} disabled={busy || !!stale || !v.ready || editing !== null} style={actionFlex} />
          <Button testID="amend-modify" kind="secondary" label="수정" onPress={() => (first ? setEditing(first) : setWhyOpen(true))} disabled={busy} style={[actionFlex, { backgroundColor: p.canvas }]} />
        </Actions>
      )}
      {whyOpen && (
        <Sheet title="왜 고치나요?" onClose={() => setWhyOpen(false)} testID="amend-why">
          <PickRows<AmendWhat>
            groups={v.groups.map((g, i) => ({ label: v.groupLabels[i], items: g.map((x) => ({ value: x.what, label: x.label, hint: x.hint })) }))}
            value={card.what}
            onPick={(what) => {
              setWhyOpen(false);
              if (what !== card.what) update({ what });
            }}
            testID="amend-why-row"
          />
        </Sheet>
      )}
    </Card>
  );
}

function Pick({ children, onPress, testID }: { children: React.ReactNode; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" style={({ pressed }) => [sx.pick, { backgroundColor: pressed ? p.sunken : p.canvas }]} testID={testID}>
      {children}
    </Pressable>
  );
}

function Kv({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <View style={sx.kv}>
      <T v="value" c="ink3" style={{ flexShrink: 0 }}>
        {label}
      </T>
      {children ?? (
        <T v="value" style={{ flexShrink: 1, textAlign: 'right' }}>
          {value}
        </T>
      )}
    </View>
  );
}

/** 값 하나를 그 자리에서 고친다. 완료(키보드 완료, 다른 곳 누름)면 값, 그대로 두면 null. */
function Edit({ field, value, big, onDone }: { field: AmendField; value: string; big?: boolean; onDone: (v: string | null) => void }) {
  const p = usePalette();
  const [text, setText] = useState(field === 'counterpartBizNo' ? value.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3') : big ? Number(value).toLocaleString('ko-KR') : value);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  const numeric = big || field === 'counterpartBizNo';
  return (
    <TextInput
      testID={`amend-input-${field}`}
      autoFocus
      value={text}
      onChangeText={(t) => setText(big ? (t.replace(/\D/g, '') ? Number(t.replace(/\D/g, '').slice(0, 13)).toLocaleString('ko-KR') : '') : t)}
      onSubmitEditing={() => finish(text)}
      onBlur={() => finish(text)}
      keyboardType={numeric ? 'number-pad' : field === 'issueDate' ? 'numbers-and-punctuation' : 'default'}
      returnKeyType="done"
      placeholder={field === 'issueDate' ? '2026-11-24' : undefined}
      placeholderTextColor={p.ink4}
      accessibilityLabel={field}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      selectionColor={p.accent}
      style={[big ? type.figure : type.value, big ? sx.field : sx.val, { backgroundColor: p.canvas, color: p.ink, textAlign: 'right', minWidth: big ? undefined : 140 }]}
    />
  );
}

const sx = StyleSheet.create({
  pick: { minHeight: size.row, borderRadius: radius.md, paddingHorizontal: space.s4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.s2, flexShrink: 0 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s3, minHeight: 28 },
  tap: { flexDirection: 'row', alignItems: 'center', gap: space.s1, minHeight: 28 },
  val: { borderRadius: radius.sm, paddingHorizontal: space.s3, paddingVertical: 3, minHeight: 30, justifyContent: 'center' },
  field: { width: '100%', minHeight: 44, borderRadius: radius.md, paddingHorizontal: space.s4, justifyContent: 'center', alignItems: 'flex-end' },
});
