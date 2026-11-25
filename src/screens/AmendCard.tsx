import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { amendCardUpdate, type AmendCard as AmendState, type AmendField, type AmendWhat } from '@sax/chat-core';
import { space } from '../theme';
import { Actions, AmountEdit, Card, CardChoice, CardInput, Kv, KvRow } from '../ui/card';
import { Button, Notice, T } from '../ui/kit';
import { PickRows, Sheet } from '../ui/sheet';

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
  const v = card.view;
  const [editing, setEditing] = useState<AmendField | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Exclude<AmendIssue, 'sent'> | null>(null);
  const live = !!onIssue && !sent;
  // 사유를 아직 안 골랐으면 고르는 시트가 바로 뜬다(기준판 Phone-Reason).
  const [whyOpen, setWhyOpen] = useState(live && v.stage === 'what');
  useEffect(() => {
    if (live && v.stage === 'what') setWhyOpen(true);
  }, [live, v.stage]);
  const update = (patch: Parameters<typeof amendCardUpdate>[1]) => {
    try {
      onChange(amendCardUpdate(card, patch));
    } catch {
      // 맞지 않는 값은 받지 않는다(카드는 그대로)
    }
  };
  const kind = v.icon === 'cancel' ? 'cancel' : 'amend';

  if (v.stage === 'which') {
    return (
      <Card kind={kind} title={v.title} testID="amend-card">
        <T v="sub">어느 계산서인가요?</T>
        <View style={{ gap: space.s2 }} testID="amend-which">
          {v.which.map((x, i) => (
            <CardChoice key={i} onPress={live ? () => update({ pick: i }) : undefined} a11y={`${md(x.date)} ${x.item} ${won(x.total)}`} testID={`amend-pick-${i}`}>
              <View style={{ flexDirection: 'row', gap: space.s2, flexShrink: 1 }}>
                <T v="subValue">{md(x.date)}</T>
                <T v="sub" c="ink3" lines={1} style={{ flexShrink: 1 }}>
                  {x.item}
                </T>
              </View>
              <T v="subValue">{won(x.total)}</T>
            </CardChoice>
          ))}
        </View>
      </Card>
    );
  }

  const why = whyOpen && live && (
    <Sheet title="왜 고치나요?" height="fit" onClose={() => setWhyOpen(false)} testID="amend-why">
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
  );
  const original = v.original && <KvRow label="원래 계산서" value={`${md(v.original.date)}, ${won(v.original.total)}`} />;
  if (v.stage === 'what') {
    return (
      <Card kind={kind} title={v.title} testID="amend-card">
        <Kv testID="amend-what">
          {original}
          <KvRow label="사유" value="골라 주세요" quiet onPress={live ? () => setWhyOpen(true) : undefined} testID="amend-repick" />
        </Kv>
        {why}
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
  const editRow = v.rows.find((r) => r.field === editing);
  return (
    <Card kind={kind} title={v.title} testID="amend-card">
      <Kv>
        {original}
        <KvRow label="사유" value={v.label ?? ''} onPress={live ? () => setWhyOpen(true) : undefined} testID="amend-repick" />
        {v.rows
          .filter((r) => r.field !== editing)
          .map((r) => (
            <KvRow key={r.field} label={r.label} value={r.value} edit onPress={r.edit && live ? () => setEditing(r.field) : undefined} testID={`amend-edit-${r.field}`} />
          ))}
      </Kv>
      {editRow && (
        <AmountEdit label={editRow.label}>
          <Edit field={editRow.field} value={raw[editRow.field]!} onDone={(x) => (setEditing(null), x !== null && x.trim() !== '' && update({ field: editRow.field, value: x }))} />
        </AmountEdit>
      )}
      {v.amounts && (
        <View style={{ gap: space.s3 }} testID="amend-amounts">
          {v.amounts.map((a) => (
            <AmountEdit key={a.field} label={a.label} before={`기존 ${won(a.before)}`}>
              <Money
                field={a.field}
                label={a.label}
                value={a.after}
                live={live}
                autoFocus={editing === a.field}
                onFocus={() => setEditing(a.field)}
                onDone={(n) => (setEditing(null), n !== null && update({ field: a.field, value: n }))}
              />
            </AmountEdit>
          ))}
        </View>
      )}
      {v.notice && <Notice testID="amend-notice">{v.notice}</Notice>}
      {failed && (
        <T v="sub" c="attention" testID="amend-failed">
          {ISSUE_FAILED[failed]}
        </T>
      )}
      {live && (
        <Actions>
          <Button testID="amend-issue" label="발급하기" onPress={() => void issue()} busy={busy} disabled={busy || !!stale || !v.ready || editing !== null} />
          <Button testID="amend-modify" kind="secondary" label="수정" onPress={() => (first ? setEditing(first) : setWhyOpen(true))} disabled={busy} />
        </Actions>
      )}
      {why}
    </Card>
  );
}

/** 금액 칸: 늘 입력 칸 모양으로 보이고(기준판 sx-amt-in), 누르면 바로 고친다. 끝내면 숫자, 비우면 null. */
function Money({ field, label, value, live, autoFocus, onFocus, onDone }: { field: AmendField; label: string; value: number; live: boolean; autoFocus: boolean; onFocus: () => void; onDone: (n: number | null) => void }) {
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const [text, setText] = useState(fmt(value));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(fmt(value));
  }, [value, dirty]);
  return (
    <CardInput
      testID={`amend-field-${field}`}
      label={label}
      value={text}
      suffix="원"
      editable={live}
      autoFocus={autoFocus}
      keyboardType="number-pad"
      onChange={(t) => {
        if (!dirty) onFocus();
        setDirty(true);
        const d = t.replace(/\D/g, '').slice(0, 13);
        setText(d ? fmt(Number(d)) : '');
      }}
      onDone={() => {
        if (!dirty) return;
        setDirty(false);
        const d = text.replace(/\D/g, '');
        onDone(d ? Number(d) : null);
      }}
    />
  );
}

/** 값 하나를 그 자리에서 고친다. 완료(키보드 완료, 다른 곳 누름)면 값, 그대로 두면 null. 비운 채 끝내면 부르는 쪽이 기존 값을 둔다. */
function Edit({ field, value, onDone }: { field: AmendField; value: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(field === 'counterpartBizNo' ? value.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3') : value);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <CardInput
      testID={`amend-input-${field}`}
      label={field}
      autoFocus
      plain
      value={text}
      onChange={setText}
      onDone={finish}
      keyboardType={field === 'counterpartBizNo' ? 'number-pad' : field === 'issueDate' ? 'numbers-and-punctuation' : 'default'}
      placeholder={field === 'issueDate' ? '2026-11-24' : undefined}
    />
  );
}
