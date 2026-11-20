import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, useColorScheme } from 'react-native';
import { useBioInfo, type BioInfo } from '../biometry';
import { bioName, unlockLabel } from '../biometryLabel';
import { KeyringError, createDevice, resetDevice, unlock, type DeviceKeys, type KeyringErrorCode } from '../keyring';
import markDark from '../../assets/splash-icon-dark.png';
import markLight from '../../assets/splash-icon.png';
import { radius, space, usePalette } from '../theme';
import { Button, Check, Screen, T } from '../ui/kit';
import { STEP_KEY } from '../ui/StepDots';
import { OnboardingStep } from './OnboardingScreen';

const PASSCODE = '폰 암호로 열기';

const MARK = { light: markLight, dark: markDark };
const MARK_SIZE = 96;

const MESSAGES: Record<KeyringErrorCode, { line: string; sub?: string }> = {
  cancelled: { line: '확인하지 못했어요', sub: '다시 시도하거나 폰 암호로 열어 주세요.' },
  passcode_required: { line: '이 폰에 화면 잠금(암호)을 켜야 열 수 있어요', sub: '이 앱의 열쇠는 폰 암호가 켜져 있을 때만 보관돼요. 설정에서 켠 뒤 다시 열어 주세요.' },
  biometry_required: { line: '확인하지 못했어요', sub: '다시 시도하거나 폰 암호로 열어 주세요.' },
  corrupt: { line: '이 폰의 열쇠를 찾을 수 없어요', sub: '초기화한 뒤 PC와 다시 연결해 주세요.' },
  unavailable: { line: '열쇠 저장소를 열 수 없어요', sub: '잠시 뒤 다시 시도해 주세요.' },
};

interface LockPreview {
  bio: BioInfo;
  err?: KeyringErrorCode | null;
}

export function LockScreen({ firstRun, onUnlocked, onReset, preview, onBack }: { firstRun: boolean; onUnlocked: (k: DeviceKeys, created: boolean) => void; onReset: () => void; preview?: LockPreview; onBack?: () => void }) {
  const bio = useBioInfo(preview?.bio);
  const [err, setErr] = useState<KeyringErrorCode | null>(preview?.err ?? null);
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  }, []);

  const retry = shown === 'cancelled' || shown === 'unavailable';
  const label = retry ? '다시 시도' : noBio ? PASSCODE : unlockLabel(bio?.kind ?? 'none');
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

  if (firstRun) return <FirstRun bio={bio} noBio={noBio} err={errBlock} busy={busy} onStart={() => open(noBio)} onBack={onBack} />;

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
                onReset();
              }}
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

function FirstRun({ bio, noBio, err, busy, onStart, onBack }: { bio: BioInfo | null; noBio: boolean; err: ReactNode; busy: boolean; onStart: () => void; onBack?: () => void }) {
  const p = usePalette();
  const dark = useColorScheme() === 'dark';
  const how = !bio || noBio ? '폰 암호' : `${bioName(bio.kind)}나 폰 암호`;
  return (
    <OnboardingStep
      testID="lock-screen"
      step={STEP_KEY}
      onBack={onBack}
      title="이 폰에만 있는 열쇠를 만들어요"
      body="내 PC와 이 폰이 서로를 알아보고, 둘 사이 내용을 잠그는 데 써요."
      action={<Button testID="unlock" label="열쇠 만들기" onPress={onStart} busy={busy} />}
      art={
        <View style={st.keyArt} testID="lock-first">
          <Image source={dark ? MARK.dark : MARK.light} style={st.mark} accessibilityIgnoresInvertColors accessible={false} />
          <View style={[st.key, { backgroundColor: p.canvas, borderColor: p.line }]} testID="lock-key-note">
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
          {err}
        </View>
      }
    />
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s5, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: space.s2 },
  btn: { alignSelf: 'stretch' },
  keyArt: { alignItems: 'center', gap: space.s5 },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
  key: { alignSelf: 'stretch', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.s4, gap: space.s2 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
});
