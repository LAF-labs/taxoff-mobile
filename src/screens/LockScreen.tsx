// P-01 잠금: 앱을 열 때와 백그라운드 30초 뒤. 해제 = 키 항목 읽기(keyring.unlock), 생체 또는 폰 암호(D08 §3.1, 대표 결정 "비밀번호 허용").
// 화면은 조용한 면 하나에 가운데 단추 하나("Face ID로 열기"처럼 기기 종류에 맞춘 문구). 앱 이름·자물쇠는 두지 않는다.
// 첫 실행만 다르다(온보딩 다음 단계 4/5): 표시 + "이 폰에만 있는 열쇠를 만들어요" + 풀이, 아래 tint 면에 열쇠 사실 두 줄, 바닥에 단계 점 + [열쇠 만들기]. 다음은 PC와 연결(5/5).
// 생체가 실패하면 OS가 기본 대체("암호 입력")를 띄우고, 취소해 돌아오면 같은 화면에 한 줄 + [다시 시도] + 회색 [폰 암호로 열기].
// 생체를 등록하지 않은 폰은 처음부터 [폰 암호로 열기]가 기본 단추. 폰 암호가 없는 폰은 여전히 열 수 없다. 잠금 끄기는 없다.
// 잠금 해제와 승인 서명은 별개다: 승인 시트의 [승인하고 발급]은 매번 생체만 + 하드웨어 키 서명(폰 암호 대체 없음).
import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, useColorScheme } from 'react-native';
import { useBioInfo, type BioInfo } from '../biometry';
import { bioName, unlockLabel } from '../biometryLabel';
import { KeyringError, createDevice, resetDevice, unlock, type DeviceKeys, type KeyringErrorCode } from '../keyring';
import markDark from '../../assets/splash-icon-dark.png';
import markLight from '../../assets/splash-icon.png';
import { radius, space, usePalette } from '../theme';
import { Button, Check, Screen, T } from '../ui/kit';
import { STEP_KEY, StepDots } from '../ui/StepDots';

const PASSCODE = '폰 암호로 열기';

// 스플래시(app.json expo-splash-screen)와 같은 그림·크기. 첫 화면으로 넘어올 때 표시가 그대로 이어진다.
const MARK = { light: markLight, dark: markDark };
const MARK_SIZE = 96;

const MESSAGES: Record<KeyringErrorCode, { line: string; sub?: string }> = {
  cancelled: { line: '확인하지 못했어요', sub: '다시 시도하거나 폰 암호로 열어 주세요.' },
  passcode_required: { line: '이 폰에 화면 잠금(암호)을 켜야 열 수 있어요', sub: '이 앱의 열쇠는 폰 암호가 켜져 있을 때만 보관돼요. 설정에서 켠 뒤 다시 열어 주세요.' },
  biometry_required: { line: '확인하지 못했어요', sub: '다시 시도하거나 폰 암호로 열어 주세요.' },
  corrupt: { line: '이 폰의 열쇠를 찾을 수 없어요', sub: '초기화한 뒤 PC와 다시 연결해 주세요.' },
  unavailable: { line: '열쇠 저장소를 열 수 없어요', sub: '잠시 뒤 다시 시도해 주세요.' },
};

export interface LockPreview {
  bio: BioInfo;
  err?: KeyringErrorCode | null;
}

export function LockScreen({ firstRun, onUnlocked, onReset, preview }: { firstRun: boolean; onUnlocked: (k: DeviceKeys, created: boolean) => void; onReset: () => void; preview?: LockPreview }) {
  const bio = useBioInfo(preview?.bio);
  const [err, setErr] = useState<KeyringErrorCode | null>(preview?.err ?? null);
  // 개발 빌드만 원인 문구를 함께 보인다(값·키는 들어 있지 않다)
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 생체를 등록하지 않은 기기는 폰 암호로 연다(단추가 처음부터 "폰 암호로 열기")
  const noBio = !!bio && (!bio.enrolled || bio.kind === 'none');
  // biometry_required는 이제 막는 이유가 아니다(폰 암호로 열 수 있다): 화면에서는 실패로만 다룬다
  const shown: KeyringErrorCode | null = err === 'biometry_required' ? 'cancelled' : err;

  const open = async (passcode = false) => {
    if (preview) return;
    setBusy(true);
    setErr(null);
    try {
      if (firstRun) onUnlocked(await createDevice(), true);
      else onUnlocked(await unlock({ passcode }), false);
    } catch (e) {
      setErr(e instanceof KeyringError ? e.code : 'unavailable');
      if (__DEV__) setDetail(String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!firstRun && !preview) void open();
    // 처음 한 번만 자동으로 묻는다
  }, []);

  const retry = shown === 'cancelled' || shown === 'unavailable';
  const label = retry ? '다시 시도' : noBio ? PASSCODE : unlockLabel(bio?.kind ?? 'none');
  // 회색 글자 단추: 생체로 다시 시도하는 단추 아래에만(기본 단추가 이미 폰 암호면 두지 않는다)
  const showPasscode = !firstRun && shown === 'cancelled' && !noBio;
  const m = shown ? MESSAGES[shown] : null;

  const errBlock = m && (
    <View style={{ gap: space.s1, alignItems: 'center' }} testID={`lock-err-${shown}`}>
      <T v="subStrong" center>
        {m.line}
      </T>
      {m.sub && (
        <T v="sub" c="ink2" center>
          {m.sub}
        </T>
      )}
      {detail && (
        <T v="meta" c="ink3" center>
          {detail}
        </T>
      )}
    </View>
  );

  if (firstRun) return <FirstRun bio={bio} noBio={noBio} err={errBlock} busy={busy} onStart={() => open(noBio)} />;

  return (
    <Screen scroll={false} testID="lock-screen">
      <View style={st.wrap}>
        {errBlock}
        <View style={st.actions}>
          {shown !== 'passcode_required' && <Button testID="unlock" label={label} onPress={() => open(noBio)} busy={busy} style={st.btn} />}
          {showPasscode && <Button testID="unlock-passcode" kind="quiet" label={PASSCODE} onPress={() => open(true)} disabled={busy} />}
          {shown === 'passcode_required' && <Button testID="unlock" kind="secondary" label="다시 확인" onPress={() => open()} busy={busy} style={st.btn} />}
          {shown === 'corrupt' && (
            <Button
              kind="quiet"
              label="이 폰 초기화"
              onPress={async () => {
                try {
                  await resetDevice();
                } catch {
                  setErr('unavailable');
                  return;
                }
                setErr(null);
                setDetail(null);
                // 열쇠가 지워졌으니 첫 실행으로 돌아가 새 열쇠를 만든다(App이 firstRun을 켠다)
                onReset();
              }}
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

/**
 * 처음 연 화면: 이 앱이 무엇을 해 주는지 먼저, 열쇠 안내는 그 아래 보조로.
 * 위: 스플래시 표시 + 이름 + 한 줄 가치 + 한 줄 풀이. 아래: tint 면 열쇠 안내 → [시작하기].
 */
function FirstRun({ bio, noBio, err, busy, onStart }: { bio: BioInfo | null; noBio: boolean; err: ReactNode; busy: boolean; onStart: () => void }) {
  const p = usePalette();
  const dark = useColorScheme() === 'dark';
  // 열 때 무엇으로 확인하는지(생체 없는 폰은 폰 암호만)
  const how = !bio || noBio ? '폰 암호' : `${bioName(bio.kind)}나 폰 암호`;
  return (
    <Screen
      scroll={false}
      testID="lock-screen"
      footer={
        <>
          <StepDots index={STEP_KEY} testID="lock-steps" />
          <View style={{ height: space.s2 }} />
          <Button testID="unlock" label="열쇠 만들기" onPress={onStart} busy={busy} />
        </>
      }
    >
      <View style={st.first} testID="lock-first">
        <View style={st.hero}>
          <Image source={dark ? MARK.dark : MARK.light} style={st.mark} accessibilityIgnoresInvertColors accessible={false} />
          <View style={{ gap: space.s2, alignItems: 'center' }}>
            <T v="title" role="header" center testID="lock-value">
              이 폰에만 있는 열쇠를 만들어요
            </T>
            <T v="sub" c="ink2" center>
              내 PC와 이 폰이 서로를 알아보고, 둘 사이 내용을 잠그는 데 써요.
            </T>
          </View>
        </View>
        {err}
        <View style={[st.key, { backgroundColor: p.tint }]} testID="lock-key-note">
          <View style={st.keyRow}>
            <Check color={p.ink2} />
            <T v="sub" c="ink2" style={{ flex: 1 }}>
              폰 밖으로 나가지 않고 백업되지 않아요
            </T>
          </View>
          <View style={st.keyRow}>
            <Check color={p.ink2} />
            <T v="sub" c="ink2" style={{ flex: 1 }}>
              앞으로 앱을 열 때 {how}로 확인해요
            </T>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s5, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: space.s2 },
  btn: { alignSelf: 'stretch' },
  first: { flex: 1, paddingHorizontal: space.s5, paddingBottom: space.s4, gap: space.s5 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s5, paddingHorizontal: space.s3 },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
  key: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
