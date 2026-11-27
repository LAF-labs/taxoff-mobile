import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  APPROVE_CTX, AMOUNT_KEYS, DAILY_LIMIT, FIELD_LABELS, SHEET_GROUPS, approveMessage, mmss, readGate, sheetState, showValue,
  type PhoneGate, type SheetStop,
} from '../approval';
import type { ApprovalKey } from '../approvalKey';
import type { NeedPcReason } from '../queue';
import type { ApprovalSettings } from '../queueStore';
import { radius, space, usePalette } from '../theme';
import { Actions } from '../ui/card';
import { Button, Check, Group, Notice, Pill, T, success, warn } from '../ui/kit';
import { Sheet } from '../ui/sheet';

const STOP_LINE: Record<SheetStop, string> = {
  mismatch: 'PC가 보낸 내용이 맞지 않아 승인할 수 없어요',
  unknown: '이 앱이 아직 모르는 내용이 있어요',
  noKey: '이 폰은 승인 기기로 쓸 수 없어요',
  iosDenied: '이 iPhone은 승인에 쓰지 않도록 정해져 있어요',
  first: '처음 거래하는 곳은 폰으로 승인할 수 없어요',
  limit: `오늘 폰 승인 ${DAILY_LIMIT}건을 다 썼어요`,
};
const STOP_SUB: Record<SheetStop, string> = {
  mismatch: '발급되지 않았어요',
  unknown: '발급되지 않았어요. 앱을 업데이트하면 승인할 수 있어요',
  noKey: '작성과 요청은 폰에서 할 수 있어요. 승인은 PC가 맡아요',
  iosDenied: '작성과 요청은 이 iPhone에서 할 수 있어요. 승인은 PC가 맡아요',
  first: 'PC를 켜면 밀린 일에서 바로 승인할 수 있어요',
  limit: '내일 0시에 다시 5건이 생겨요',
};
const STOP_REASON: Partial<Record<SheetStop, NeedPcReason>> = { first: 'firstCounterparty', limit: 'dailyLimit', noKey: 'notApprover', iosDenied: 'notApprover', unknown: 'notApprover' };

interface ApprovalAnswer {
  reqId: string;
  decision: 'approve' | 'deny';
  actionHash: string;
  sigAlg: 'p256';
  sig: string;
}

export function ApprovalSheet({
  gate, settings, approvalKey, pairId, inDoubt, onAnswer, onPark, onRerequest, onClose, preview,
}: {
  gate: PhoneGate;
  settings: ApprovalSettings;
  approvalKey: ApprovalKey;
  pairId: string;
  inDoubt?: boolean;
  onAnswer: (a: ApprovalAnswer) => void;
  onPark: (reason: NeedPcReason) => void;
  onRerequest: () => void;
  onClose: () => void;
  preview?: { now: number; openedAt: number; acked?: string[] };
}) {
  const p = usePalette();
  const [openedAt] = useState(() => preview?.openedAt ?? Date.now());
  const [now, setNow] = useState(() => preview?.now ?? Date.now());
  const [acked, setAcked] = useState<Set<string>>(() => new Set(preview?.acked ?? []));
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ y: 0, h: 0, ch: 0 });
  const warned = useRef(false);

  useEffect(() => {
    if (preview) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [preview]);

  const state = sheetState(gate, { now, openedAt, attest: settings.attest, iosAllowed: settings.iosAllowed, usedToday: settings.usedToday, acked, inDoubt });
  const r = readGate(gate);
  useEffect(() => {
    if (state.kind === 'stopped' && !warned.current) {
      warned.current = true;
      warn();
    }
  }, [state.kind]);

  const answer = async (decision: 'approve' | 'deny') => {
    setBusy(true);
    try {
      // 거절은 일을 멈추기만 해서 Face ID를 묻지 않는다(PC는 서명 없는 거절을 받는다).
      const signed = decision === 'deny' ? { sigAlg: 'p256' as const, sig: '' } : await approvalKey.sign(APPROVE_CTX, approveMessage(pairId, gate.reqId, gate.challenge, gate.actionHash, decision));
      if (!signed) return;
      if (decision === 'approve') success();
      onAnswer({ reqId: gate.reqId, decision, actionHash: gate.actionHash, ...signed });
    } finally {
      setBusy(false);
    }
  };

  let footer;
  let notice = null;
  if (state.kind === 'inDoubt') {
    notice = <Notice testID="sheet-in-doubt">발급됐는지 PC가 확인하고 있어요. 다시 발급하지 않아요</Notice>;
    footer = (
      <Actions>
        <Button kind="secondary" label="닫기" onPress={onClose} testID="sheet-close" />
      </Actions>
    );
  } else if (state.kind === 'stopped') {
    notice = (
      <Notice testID={`sheet-stop-${state.stop}`} sub={STOP_SUB[state.stop]}>
        {STOP_LINE[state.stop]}
      </Notice>
    );
    const reason = STOP_REASON[state.stop];
    footer = (
      <Actions>
        {reason && <Button label="밀린 일에 두기" onPress={() => onPark(reason)} testID="sheet-park" />}
        <Button kind={reason ? 'secondary' : 'primary'} label="닫기" onPress={onClose} testID="sheet-close" />
      </Actions>
    );
  } else if (state.kind === 'expired') {
    notice = (
      <Notice testID="sheet-expired" sub="발급되지 않았어요. 다시 요청하면 PC가 값을 새로 읽어 와요">
        시간이 지나 승인이 취소됐어요
      </Notice>
    );
    footer = (
      <Actions>
        <Button label="PC에 다시 요청" onPress={onRerequest} testID="sheet-rerequest" />
        <Button kind="secondary" label="닫기" onPress={onClose} />
      </Actions>
    );
  } else {
    footer = (
      <>
        {state.armed && state.needsAck && (
          <T v="sub" c="ink2" testID="sheet-ack-hint">
            위 경고를 확인하면 승인할 수 있어요
          </T>
        )}
        <Actions>
          <Button
            kind="approve"
            label="승인하고 발급"
            onPress={() => void answer('approve')}
            disabled={!state.armed || state.needsAck}
            busy={busy}
            hint="얼굴이나 지문으로 확인한 뒤 홈택스에서 바로 발급해요"
            testID="sheet-approve"
          />
          <Button kind="secondary" label="거절" onPress={() => void answer('deny')} disabled={busy} testID="sheet-deny" />
        </Actions>
      </>
    );
  }

  const open = state.kind === 'open';
  return (
    <Sheet
      title={r.amend ? '수정세금계산서 승인' : '세금계산서 승인'}
      kind={r.amend ? (r.amend.what === 'deal_cancelled' ? 'cancel' : 'amend') : 'doc'}
      height="fit"
      inline
      preview={!!preview}
      onClose={onClose}
      a11yClose="승인 시트 닫기"
      testID="approval-sheet"
      footer={footer}
    >
      <View style={{ flexShrink: 1 }}>
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={st.body}
          scrollEventThrottle={32}
          onLayout={(e) => setBox((b) => ({ ...b, h: e.nativeEvent.layout.height }))}
          onContentSizeChange={(_w, ch) => setBox((b) => ({ ...b, ch }))}
          onScroll={(e) => setBox((b) => ({ ...b, y: e.nativeEvent.contentOffset.y }))}
        >
          {notice}
          <T v="sub" c={open && state.urgent ? 'attention' : 'ink2'} testID={open ? 'sheet-left' : undefined}>
            {open ? `승인하면 바로 발급돼요. 남은 시간 ${mmss(state.leftMs)}` : 'PC가 홈택스에서 되읽은 값이에요.'}
          </T>
          {open &&
            r.dups.map((d) => {
              const ok = acked.has(d.key);
              return (
                <View key={d.key} style={[st.dup, { backgroundColor: p.attentionSoft }]} testID={`sheet-dup-${d.key}`}>
                  <View style={{ flex: 1, gap: 2, paddingVertical: space.s1 }}>
                    <T v="sub" c="attention">
                      {d.line}
                    </T>
                    {d.detail && (
                      <T v="sub" c="ink2">
                        {d.detail}
                      </T>
                    )}
                  </View>
                  {ok ? (
                    <View style={st.acked} accessible accessibilityLabel="확인함">
                      <Check color={p.attention} />
                      <T v="label" c="attention">확인함</T>
                    </View>
                  ) : (
                    <Pill label="확인했어요" onPress={() => setAcked((s) => new Set([...s, d.key]))} testID={`sheet-ack-${d.key}`} />
                  )}
                </View>
              );
            })}
          {r.amend && (
            <Group title="고치는 계산서">
              <ValueLine label="사유" value={r.amend.label} kind="text" testID="sheet-amend-what" />
              <ValueLine label="원래 계산서" value={r.amend.original} kind="text" testID="sheet-amend-original" />
            </Group>
          )}
          {SHEET_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => k in r.values && !(k === 'remark' && r.values[k] === ''));
            if (!keys.length) return null;
            return (
              <Group key={g.title} title={g.title}>
                {keys.map((k) => (
                  <ValueLine
                    key={k}
                    label={FIELD_LABELS[k]!}
                    value={showValue(k, r.values[k]!)}
                    amount={AMOUNT_KEYS.has(k)}
                    strong={k === 'totalAmount'}
                    kind={k === 'counterpartEmail' ? 'email' : NOWRAP_KEYS.has(k) ? 'nowrap' : 'text'}
                    testID={`sheet-${k}`}
                  />
                ))}
              </Group>
            );
          })}
        </ScrollView>
        {box.y + box.h < box.ch - 4 && <BottomFade />}
      </View>
    </Sheet>
  );
}

const FADE = Array.from({ length: 10 }, (_, i) => Number(((1 - i / 10) ** 1.6).toFixed(2))).reverse();
function BottomFade() {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={st.fade} testID="sheet-more">
      {FADE.map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: p.overlay, opacity: o }} />
      ))}
    </View>
  );
}

const NOWRAP_KEYS = new Set(['counterpartBizNo', 'supplierBizNo', 'supplyAmount', 'taxAmount', 'totalAmount', 'issueDate', 'itemCount']);

function ValueLine({ label, value, amount, strong, kind, testID }: { label: string; value: string; amount?: boolean; strong?: boolean; kind: 'text' | 'nowrap' | 'email'; testID?: string }) {
  const v = strong ? 'figure' : amount ? 'value' : 'body';
  const stacked = kind === 'email' && value.length > 22;
  return (
    <View style={[st.line, stacked && st.stacked]} testID={testID}>
      <T v="sub" c="ink2" style={st.label}>
        {label}
      </T>
      {kind === 'email' ? (
        <Email value={value} />
      ) : (
        <T v={v} lines={kind === 'nowrap' ? 1 : undefined} style={[st.value, kind === 'nowrap' && st.nowrap]}>
          {value}
        </T>
      )}
    </View>
  );
}

function Email({ value }: { value: string }) {
  const at = value.lastIndexOf('@');
  const local = at > 0 ? value.slice(0, at) : value;
  const domain = at > 0 ? value.slice(at) : '';
  const pieces = (s: string) => s.split(/(?<=\.)/).filter(Boolean);
  const group = (s: string, key: string) => (
    <View key={key} style={st.emailGroup}>
      {pieces(s).map((x, i) => (
        <T key={i} lines={1} style={st.nowrap}>
          {x}
        </T>
      ))}
    </View>
  );
  return (
    <View style={st.email} accessible accessibilityLabel={value}>
      {group(local, 'l')}
      {domain ? group(domain, 'd') : null}
    </View>
  );
}

const st = StyleSheet.create({
  body: { paddingBottom: space.s2, gap: space.s4 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s3, minHeight: 48 },
  label: { width: 96, flexShrink: 0, paddingTop: 2 },
  value: { flex: 1, minWidth: 0, textAlign: 'right', fontVariant: ['tabular-nums'] },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  nowrap: { flexShrink: 0, ...({ whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal' } as object) },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: space.s1 },
  email: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
  emailGroup: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' },
  dup: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, borderRadius: radius.md, paddingVertical: space.s2, paddingLeft: space.s4, paddingRight: space.s2, minHeight: 52 },
  acked: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: space.s3, minHeight: 36 },
});
