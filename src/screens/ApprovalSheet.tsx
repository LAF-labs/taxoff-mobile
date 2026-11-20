// 폰 승인 시트(P-03, ADR-046 결정 1·4·6, D03 §3 폰 승인, D08 §6.1). 바닥에서 올라오는 시트 하나에 비가역 행위 하나.
// - 값은 PC가 되읽은 값(gate.request fields) 전체, 라벨은 앱 내장 사전. 폰이 cardHash·actionHash를 다시 계산해 맞을 때만 승인을 켠다.
// - 시트가 뜬 뒤 0.8초는 누름을 받지 않는다(무장 지연). 남은 시간 120초, 마지막 20초만 강조. 만료되면 같은 시트에서 [PC에 다시 요청].
// - [승인하고 발급]은 폰 앱에서 유일한 파랑 채움 단추다. 누르면 생체 확인 → P-256 하드웨어 키 서명(approvalKey).
// - 멈춤(처음 거래처·한도·키 없음·iPhone 거부·모르는 항목·해시 불일치)은 새 알림창 없이 이 시트 안에서, 다음 할 일 단추를 늘 보인다.
// - 결과 모름(in_doubt)이면 어떤 단추도 다시 발급하지 않는다.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  APPROVE_CTX, AMOUNT_KEYS, DAILY_LIMIT, FIELD_LABELS, SHEET_GROUPS, approveMessage, mmss, readGate, sheetState, showValue,
  type PhoneGate, type SheetStop,
} from '../approval';
import type { ApprovalKey } from '../approvalKey';
import type { NeedPcReason } from '../queue';
import type { ApprovalSettings } from '../queueStore';
import { radius, space, usePalette } from '../theme';
import { Button, Check, Notice, Pill, T, success, warn } from '../ui/kit';

const STOP_LINE: Record<SheetStop, string> = {
  mismatch: 'PC가 보낸 내용이 맞지 않아 승인할 수 없어요',
  unknown: '이 앱이 아직 모르는 내용이 있어요',
  noKey: '이 폰은 승인 기기로 쓸 수 없어요',
  iosDenied: '이 iPhone은 승인에 쓰지 않도록 정해져 있어요',
  first: '처음 거래하는 곳은 폰으로 승인할 수 없어요',
  limit: `오늘 폰 승인 ${DAILY_LIMIT}건을 다 썼어요`,
};
/** 멈춤 둘째 줄: 다음에 할 일 */
const STOP_SUB: Record<SheetStop, string> = {
  mismatch: '발급되지 않았어요',
  unknown: '발급되지 않았어요. 앱을 업데이트하면 승인할 수 있어요',
  noKey: '작성과 요청은 폰에서 할 수 있어요. 승인은 PC가 맡아요',
  iosDenied: '작성과 요청은 이 iPhone에서 할 수 있어요. 승인은 PC가 맡아요',
  first: 'PC를 켜면 밀린 일에서 바로 승인할 수 있어요',
  limit: '내일 0시에 다시 5건이 생겨요',
};
/** 멈춤 → 밀린 일의 "PC 앞 필요" 이유 */
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
  /** 서명한 응답(gate.response 본문). 보내기는 다음 PR(라이브 세션)이다. */
  onAnswer: (a: ApprovalAnswer) => void;
  onPark: (reason: NeedPcReason) => void;
  onRerequest: () => void;
  onClose: () => void;
  /** 갤러리: 시계를 멈춘다(now·openedAt 고정), 확인한 경고 */
  preview?: { now: number; openedAt: number; acked?: string[] };
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [openedAt] = useState(() => preview?.openedAt ?? Date.now());
  const [now, setNow] = useState(() => preview?.now ?? Date.now());
  const [acked, setAcked] = useState<Set<string>>(() => new Set(preview?.acked ?? []));
  const [busy, setBusy] = useState(false);
  /** 값 목록 스크롤 위치·높이: 아래가 남아 있을 때만 바닥 흐림을 보인다 */
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
      const signed = await approvalKey.sign(APPROVE_CTX, approveMessage(pairId, gate.reqId, gate.challenge, gate.actionHash, decision));
      if (!signed) return; // 생체 확인 취소: 시트는 그대로
      if (decision === 'approve') success();
      onAnswer({ reqId: gate.reqId, decision, actionHash: gate.actionHash, ...signed });
    } finally {
      setBusy(false);
    }
  };

  let footer;
  let notice = null;
  if (state.kind === 'inDoubt') {
    notice = <Notice testID="sheet-in-doubt">발급됐는지 PC가 확인하고 있어요 · 다시 발급하지 않아요</Notice>;
    footer = <Button kind="secondary" label="닫기" onPress={onClose} testID="sheet-close" />;
  } else if (state.kind === 'stopped') {
    notice = (
      <Notice testID={`sheet-stop-${state.stop}`} sub={STOP_SUB[state.stop]}>
        {STOP_LINE[state.stop]}
      </Notice>
    );
    const reason = STOP_REASON[state.stop];
    // 기본 행동 하나 + 보조 하나가 늘 보인다
    footer = reason ? (
      <>
        <Button label="밀린 일에 두기" onPress={() => onPark(reason)} testID="sheet-park" />
        <Button kind="quiet" label="닫기" onPress={onClose} testID="sheet-close" />
      </>
    ) : (
      <Button label="닫기" onPress={onClose} testID="sheet-close" />
    );
  } else if (state.kind === 'expired') {
    notice = (
      <Notice testID="sheet-expired" sub="발급되지 않았어요. 다시 요청하면 PC가 값을 새로 읽어 와요">
        시간이 지나 승인이 취소됐어요
      </Notice>
    );
    footer = (
      <>
        <Button label="PC에 다시 요청" onPress={onRerequest} testID="sheet-rerequest" />
        <Button kind="quiet" label="닫기" onPress={onClose} />
      </>
    );
  } else {
    footer = (
      <>
        {settings.attest === 'ios_app_attest' && (
          <T v="meta" c="ink3" center>
            이 iPhone은 앱 무결성만 확인돼요
          </T>
        )}
        {state.armed && state.needsAck && (
          <T v="meta" c="ink2" center testID="sheet-ack-hint">
            위 경고를 확인하면 승인할 수 있어요
          </T>
        )}
        <Button
          kind="approve"
          label="승인하고 발급"
          onPress={() => void answer('approve')}
          disabled={!state.armed || state.needsAck}
          busy={busy}
          hint="얼굴이나 지문으로 확인한 뒤 홈택스에서 바로 발급해요"
          testID="sheet-approve"
        />
        <Button kind="quiet" label="거절" onPress={() => void answer('deny')} disabled={busy} testID="sheet-deny" />
      </>
    );
  }

  const open = state.kind === 'open';
  return (
    <View style={StyleSheet.absoluteFill} testID="approval-sheet">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="승인 시트 닫기" accessibilityRole="button" />
      <View style={[st.sheet, { backgroundColor: p.canvas, maxHeight: height * 0.94, paddingBottom: Math.max(inset.bottom, space.s4) }]} accessibilityViewIsModal>
        <View style={[st.grabber, { backgroundColor: p.sunken }]} />
        <View style={st.head}>
          <T v="title" role="header" style={{ flex: 1 }}>
            세금계산서 발급 승인
          </T>
          {open && (
            <T v={state.urgent ? 'subStrong' : 'meta'} c={state.urgent ? 'attention' : 'ink3'} testID="sheet-left" style={{ fontVariant: ['tabular-nums'] }}>
              남은 시간 {mmss(state.leftMs)}
            </T>
          )}
        </View>
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
          <T v="sub" c="ink2">
            {open ? 'PC가 홈택스에서 되읽은 값이에요. 승인하면 바로 발급되고 되돌릴 수 없어요.' : 'PC가 홈택스에서 되읽은 값이에요.'}
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
                      <T v="meta" c="ink2">
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
          {SHEET_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => k in r.values && !(k === 'remark' && r.values[k] === ''));
            if (!keys.length) return null;
            return (
              <View key={g.title} style={{ gap: space.s2 }}>
                <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
                  {g.title}
                </T>
                <View style={[st.group, { backgroundColor: p.tint }]}>
                  {keys.map((k, i) => (
                    <View key={k}>
                      {i > 0 && <View style={[st.sep, { backgroundColor: p.line }]} />}
                      <ValueLine
                        label={FIELD_LABELS[k]!}
                        value={showValue(k, r.values[k]!)}
                        amount={AMOUNT_KEYS.has(k)}
                        strong={k === 'totalAmount'}
                        kind={k === 'counterpartEmail' ? 'email' : NOWRAP_KEYS.has(k) ? 'nowrap' : 'text'}
                        testID={`sheet-${k}`}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
        {box.y + box.h < box.ch - 4 && <BottomFade />}
        </View>
        <View style={[st.footer, { borderTopColor: p.line }]}>{footer}</View>
      </View>
    </View>
  );
}

/** 단추 영역 바로 위 흐림(20pt): 값이 더 있다는 표시. 끝까지 내리면 사라진다. 선은 긋지 않는다. */
const FADE = Array.from({ length: 10 }, (_, i) => Number(((1 - i / 10) ** 1.6).toFixed(2))).reverse();
function BottomFade() {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={st.fade} testID="sheet-more">
      {FADE.map((o, i) => (
        <View key={i} style={{ height: 2, backgroundColor: p.canvas, opacity: o }} />
      ))}
    </View>
  );
}

/** 줄을 바꾸지 않는 값: 사업자번호·금액·날짜 */
const NOWRAP_KEYS = new Set(['counterpartBizNo', 'supplierBizNo', 'supplyAmount', 'taxAmount', 'totalAmount', 'issueDate', 'itemCount']);

/** 라벨 왼쪽, 값 오른쪽. 글자 값은 낱말 단위로 줄을 바꾸고(긴 상호·품목), 금액은 고정폭 숫자. */
function ValueLine({ label, value, amount, strong, kind, testID }: { label: string; value: string; amount?: boolean; strong?: boolean; kind: 'text' | 'nowrap' | 'email'; testID?: string }) {
  const v = strong ? 'figure' : amount ? 'value' : 'body';
  // 긴 이메일은 라벨 아래 전체 너비로 내린다(옆 칸에서는 아이디 부분까지 점 뒤에서 끊긴다).
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

/**
 * 이메일: 넘칠 때는 @ 앞에서만 줄을 바꾸고("…invoices" / "@flower-garden-service.example"), 그래도 넘치면 점(.) 뒤에서만 끊는다.
 * 조각마다 한 덩어리(줄바꿈 없음)로 두고, 바깥은 [아이디 묶음][@도메인 묶음] 두 덩어리만 감싸 넘긴다.
 */
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
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s5, minHeight: 44 },
  body: { paddingHorizontal: space.s5, paddingTop: space.s2, paddingBottom: space.s4, gap: space.s4 },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.s4 },
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
  footer: { paddingHorizontal: space.s5, paddingTop: space.s3, gap: space.s2, borderTopWidth: StyleSheet.hairlineWidth },
});
