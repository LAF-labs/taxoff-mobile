import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { useBioInfo, type BioInfo } from '../biometry';
import { bioName, unlockLabel, type BioKind } from '../biometryLabel';
import { latestEntrusted } from '../notify/wake';
import type { Job } from '../queue';
import { useQueue } from '../queueStore';
import { deviceUnlockKey, unlockDesk, type GrantResult, type UnlockAsk, type UnlockDesk, type UxDevice } from '../unlock';
import { space, usePalette } from '../theme';
import { Button, ConfirmSheet, PcGlyph, T, josa, success, warn } from '../ui/kit';

/** desk의 지금 요청을 따라간다. 시간이 지나면 저절로 사라진다. */
export function useUnlockAsk(desk: UnlockDesk = unlockDesk): UnlockAsk | null {
  const [, setTick] = useState(0);
  useSyncExternalStore(
    (f) => desk.subscribe(f),
    () => desk.version,
  );
  const ask = desk.current();
  const until = ask?.until;
  useEffect(() => {
    if (until === undefined) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [until]);
  return ask && ask.until > Date.now() ? ask : null;
}

/** 풀기 키는 생체가 있어야 만들어지므로 요청이 왔다면 생체가 있다. 알기 전에는 Face ID로 쓴다. */
const bioOf = (b: BioInfo | null): BioKind => (b && b.kind !== 'none' ? b.kind : 'faceId');

const openJob = (jobs: readonly Job[]): Job | null => {
  const j = latestEntrusted(jobs);
  return j && j.state !== 'done' && j.state !== 'expired' ? j : null;
};

const FAIL: Record<Exclude<GrantResult, { ok: true }>['why'], ((b: string) => string) | null> = {
  cancel: null,
  lockout: (b) => `${josa(b, '이', '가')} 잠겼어요`,
  changed: (b) => `${josa(b, '이', '가')} 바뀌었어요. PC가 다음에 열리면 다시 쓸 수 있어요`,
  failed: () => '잠시 뒤 다시 해 주세요',
};

function useGrant(ux: UxDevice | null, bio: BioKind) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const open = async (ask: UnlockAsk) => {
    if (!ux || busy) return;
    setBusy(true);
    try {
      const r = await ux.grant(ask);
      if (r.ok) {
        success();
        unlockDesk.answer(r.body);
        return;
      }
      const f = FAIL[r.why];
      if (!f) return;
      warn();
      if (r.why === 'changed') unlockDesk.drop(ask.unlockId);
      setFail(f(bioName(bio)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, fail, setFail, open };
}

/**
 * 잠긴 PC가 열어 달라고 할 때의 시트(캔버스 "폰, PC 열기"). [Face ID로 열기]는 생체 확인 뒤 PC에 풀기 답을 보내고,
 * [아니요]는 거절을 보낸다(PC는 5분 동안 다시 묻지 않는다). 바깥을 누르면 답하지 않고 닫는다.
 * 폰이 맡긴 일 때문에 온 요청(scope remote)은 그 일 카드 안에서 묻고, 카드가 없을 때만 시트로 묻는다.
 */
export function UnlockHost({ bioPreview, askPreview }: { bioPreview?: BioInfo; askPreview?: UnlockAsk } = {}) {
  const p = usePalette();
  const q = useQueue();
  const live = useUnlockAsk();
  const ask = askPreview ?? live;
  const bio = bioOf(useBioInfo(bioPreview));
  const ux = useMemo(() => deviceUnlockKey(SaxNative), []);
  const g = useGrant(ux, bio);

  if (g.fail) {
    return <ConfirmSheet testID="unlock-fail" title="이번에는 열 수 없어요" body={g.fail} yes="닫기" onYes={() => g.setFail(null)} />;
  }
  if (!ask || unlockDesk.isHidden(ask.unlockId)) return null;
  if (ask.scope === 'remote' && openJob(q.jobs)) return null;
  const remote = ask.scope === 'remote';
  return (
    <ConfirmSheet
      testID="unlock-sheet"
      icon={<PcGlyph color={p.ink} />}
      title={remote ? 'PC가 잠겨 있어요' : `${josa(ask.pcName, '을', '를')} 열까요?`}
      body={remote ? '맡긴 일을 하는 동안만 열어요' : '방금 PC에서 요청했어요'}
      yes={remote ? `${josa(bioName(bio), '으로', '로')} 맡기기` : unlockLabel(bio)}
      no="아니요"
      busy={g.busy}
      onYes={() => void g.open(ask)}
      onNo={() => unlockDesk.answer({ unlockId: ask.unlockId, decision: 'deny' })}
      onClose={() => unlockDesk.hide(ask.unlockId)}
    />
  );
}

/** 맡긴 일 카드 안의 "PC가 잠겨 있어요"(캔버스 "폰, 잠긴 PC에 맡기기"). 가장 최근에 맡긴 일 하나에만 보인다. */
export function UnlockInline({ job, bioPreview, askPreview }: { job: Job; bioPreview?: BioInfo; askPreview?: UnlockAsk }) {
  const q = useQueue();
  const live = useUnlockAsk();
  const ask = askPreview ?? live;
  const bio = bioOf(useBioInfo(bioPreview));
  const ux = useMemo(() => deviceUnlockKey(SaxNative), []);
  const g = useGrant(ux, bio);
  if (!ask || ask.scope !== 'remote') return null;
  if (!askPreview && openJob(q.jobs)?.id !== job.id) return null;
  return (
    <View style={st.wrap} testID={`unlock-inline-${job.id}`}>
      <View style={{ gap: 2 }}>
        <T v="subStrong">PC가 잠겨 있어요</T>
        <T v="sub" c="ink2">
          {g.fail ?? '이 발급을 하는 동안만 열어요'}
        </T>
      </View>
      <Button label={`${josa(bioName(bio), '으로', '로')} 맡기기`} busy={g.busy} onPress={() => void g.open(ask)} testID="unlock-inline-yes" />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: space.s3, paddingTop: space.s1 },
});
