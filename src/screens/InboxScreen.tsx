import { useEffect, useState } from 'react';
import { clock } from '../chat';
import { queueCounts } from '../queue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { byDay, type InboxItem, type InboxKind } from '../notify/inbox';
import { usePalette } from '../theme';
import { Empty, Group, NoteRow, Row, Screen } from '../ui/kit';
import { Glyph, type GlyphKind } from '../ui/glyph';

const GLYPH: Record<InboxKind, { kind: GlyphKind; ink?: 'accent' | 'attention' }> = {
  approve: { kind: 'doc', ink: 'accent' },
  done: { kind: 'done' },
  stopped: { kind: 'stop' },
  refused: { kind: 'stop' },
  myTurn: { kind: 'attention', ink: 'attention' },
  verify: { kind: 'attention', ink: 'attention' },
  money: { kind: 'money' },
};

/** 알림함. 들어오면 모두 읽은 것으로 두되, 이번에 볼 때는 새 알림 표시를 남긴다. */
export function InboxScreen({ onRun, onCard, onMoney, onQueue, now = Date.now() }: {
  onRun: () => void;
  onCard: (jobId: string) => void;
  onMoney: () => void;
  onQueue: () => void;
  now?: number;
}) {
  const s = useSession();
  const q = useQueue();
  const p = usePalette();
  const [seenAt] = useState(() => s.data.inboxSeenAt ?? 0);
  useEffect(() => {
    void s.update((d) => ({ ...d, inboxSeenAt: Date.now() }));
  }, []);
  const list = s.data.inbox ?? [];
  const qc = queueCounts(q.jobs, now);
  const backlog = qc.approvals + qc.backlog + s.pending.receipts + s.pending.cash;
  const open = (x: InboxItem): (() => void) | undefined => {
    if (x.kind === 'money') return onMoney;
    const job = x.jobId ? q.jobs.find((j) => j.id === x.jobId) : undefined;
    if (!job) return undefined;
    const run = () => {
      q.setFocus(job.id);
      onRun();
    };
    if (x.kind === 'approve' && job.state === 'approval') return () => onCard(job.id);
    return job.run ? run : undefined;
  };

  return (
    <Screen title="알림함" shell testID="inbox" scroll={list.length > 0 || backlog > 0}>
      {backlog > 0 && (
        <Group>
          <Row testID="inbox-queue" icon={<Glyph kind="list" color={p.ink2} />} label="밀린 일" value={`${backlog}건`} onPress={onQueue} />
        </Group>
      )}
      {list.length === 0 ? (
        <Empty testID="inbox-empty" title="알림이 없어요" />
      ) : (
        byDay(list, now).map((g) => (
          <Group key={g.label} title={g.label}>
            {g.items.map((x) => {
              const gl = GLYPH[x.kind];
              return (
                <NoteRow
                  key={x.id}
                  testID={`inbox-${x.id}`}
                  icon={<Glyph kind={gl.kind} color={gl.ink ? p[gl.ink] : p.ink2} />}
                  title={x.title}
                  line={x.line}
                  time={clock(x.at)}
                  fresh={x.at > seenAt}
                  onPress={open(x)}
                />
              );
            })}
          </Group>
        ))
      )}
    </Screen>
  );
}
