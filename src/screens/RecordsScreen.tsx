import { useState } from 'react';
import { View } from 'react-native';
import { amendCardNew, amendCardUpdate, amendSourcesOf, amendStateText, mdText, type CopyRow } from '@sax/chat-core';
import { ulid } from '@sax/remote';
import { fullDay } from '../money';
import { chatCopyOf } from '../net/pcCopy';
import { useOfflineChat, type OfflineChatView } from '../offline/useOfflineChat';
import { kstDay } from '../phoneCmd';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { space } from '../theme';
import { Actions, Sheet, actionFlex } from '../ui/card';
import { Button, Empty, Group, Row, Screen, T, won } from '../ui/kit';
import type { HomeRoute } from './HomeScreen';


/** 기록 한 줄: PC 사본의 발급 줄(수정분 빼고)과, 사본에 아직 없는 이 폰의 발급. 수정 상태(취소됨, 고침, 줄임)는 금액 아래에. */
interface Rec {
  key: string;
  name: string;
  day: string;
  total: number | null;
  state: string | null;
  row: CopyRow | null;
  jobId: string | null;
}

export function RecordsScreen({ go, onHome, phone }: { go: (to: HomeRoute) => void; onHome?: () => void; phone?: OfflineChatView }) {
  const s = useSession();
  const q = useQueue();
  const live = useOfflineChat();
  const chat = phone ?? live;
  const [open, setOpen] = useState<Rec | null>(null);
  const paired = !!s.data.pair;
  const copy = chatCopyOf(s.data.pcCopy);
  const done = q.jobs.filter((j) => j.run?.kind === 'done').sort((a, b) => b.createdAt - a.createdAt);
  const jobOf = (no: string | null | undefined) => (no ? (done.find((j) => j.run?.kind === 'done' && j.run.result.approvalNo === no) ?? null) : null);
  const fromCopy: Rec[] = (copy?.issued ?? [])
    .filter((r) => !r.amendOf)
    .map((r, i) => ({ key: r.approvalNo ?? `c${i}`, name: r.counterparty, day: r.date, total: r.total, state: amendStateText(r.amend), row: r, jobId: jobOf(r.approvalNo)?.id ?? null }));
  const known = new Set(fromCopy.map((x) => x.key));
  const fromPhone: Rec[] = done.flatMap((j) => {
    const r = j.run?.kind === 'done' ? j.run.result : null;
    if (!r || known.has(r.approvalNo)) return [];
    return [{ key: r.approvalNo, name: r.counterpart ?? j.title, day: r.doc.issuedOn, total: r.total, state: null, row: null, jobId: j.id }];
  });
  const recs = [...fromPhone, ...fromCopy].sort((a, b) => b.day.localeCompare(a.day));

  const startAmend = async (r: Rec, cancel: boolean) => {
    if (!copy || !r.row) return;
    const src = amendSourcesOf(copy, [r.row]);
    if (!src.length) return;
    let card = amendCardNew(src, {}, kstDay());
    if (cancel) card = amendCardUpdate(card, { what: 'deal_cancelled' });
    setOpen(null);
    await chat.update?.({ kind: 'msg', id: `amend-${ulid()}`, from: 'pc', via: 'phone', at: Date.now(), card: { title: card.view.title, rows: [], amend: { id: ulid(), card } } });
    onHome?.();
  };

  if (paired && recs.length > 0) {
    const src = open?.row && copy ? amendSourcesOf(copy, [open.row])[0] : undefined;
    const amendable = !!src && !src.cancelled && !src.replaced && !!chat.update;
    return (
      <Screen title="발급 기록" shell testID="records">
        <Group title="발급한 세금계산서" testID="records-list">
          {recs.map((r) => (
            <Row
              key={r.key}
              label={r.name}
              sub={fullDay(r.day)}
              value={
                <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <T v="value">{r.total === null ? '금액 없음' : won(r.total)}</T>
                  {r.state && (
                    <T v="meta" c="ink3" testID={`record-state-${r.key}`}>
                      {r.state}
                    </T>
                  )}
                </View>
              }
              onPress={() => setOpen(r)}
              testID={`record-${r.key}`}
            />
          ))}
        </Group>
        {open && (
          <Sheet
            title={`${open.name} 세금계산서`}
            kind="doc"
            onClose={() => setOpen(null)}
            testID="record-sheet"
            footer={
              (open.jobId || amendable) && (
                <Actions>
                  {open.jobId && (
                    <Button
                      kind="secondary"
                      label="PDF 보기"
                      onPress={() => {
                        q.setFocus(open.jobId!);
                        setOpen(null);
                        go('doc');
                      }}
                      style={actionFlex}
                      testID="record-pdf"
                    />
                  )}
                  {amendable && <Button kind="secondary" label="고치기" onPress={() => void startAmend(open, false)} style={actionFlex} testID="record-amend" />}
                  {amendable && <Button kind="secondary" label="취소" onPress={() => void startAmend(open, true)} style={actionFlex} testID="record-cancel" />}
                </Actions>
              )
            }
          >
            <View style={{ gap: space.s3 }}>
              <Line k="작성일" v={mdText(src?.issueDate ?? open.day)} />
              {src && <Line k="공급가액" v={won(src.supply)} />}
              {src && <Line k="부가세" v={won(src.tax)} />}
              {src?.item && <Line k="품목" v={src.item} />}
              <Line k="합계" v={open.total === null ? '금액 없음' : won(open.total)} strong />
              {open.state && <Line k="상태" v={open.state} />}
            </View>
          </Sheet>
        )}
      </Screen>
    );
  }
  return (
    <Screen title="발급 기록" shell scroll={false} testID="records">
      <Empty
        testID="records-empty"
        title="아직 발급한 게 없어요"
        sub={paired ? '폰이나 PC에서 발급한 세금계산서가 여기에 모여요.' : '먼저 이 폰을 PC와 연결해 주세요.'}
        action={paired ? <Button label="세금계산서 발급" onPress={() => go('issue')} testID="records-issue" /> : <Button label="PC 연결하기" onPress={() => go('pair')} />}
      />
    </Screen>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s3 }}>
      <T v="value" c="ink3">
        {k}
      </T>
      <T v={strong ? 'figure' : 'value'} style={{ flexShrink: 1, textAlign: 'right' }}>
        {v}
      </T>
    </View>
  );
}
