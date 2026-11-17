// P-01 잠금: 앱을 열 때와 백그라운드 30초 뒤. 해제 = 키 항목 읽기(keyring.unlock), 생체 또는 폰 암호(D08 §3.1, 대표 결정 "비밀번호 허용").
// 화면은 조용한 면 하나에 가운데 단추 하나("Face ID로 열기"처럼 기기 종류에 맞춘 문구). 앱 이름·자물쇠는 두지 않는다.
// 생체가 실패하면 OS가 기본 대체("암호 입력")를 띄우고, 취소해 돌아오면 같은 화면에 한 줄 + [다시 시도] + 회색 [폰 암호로 열기].
// 생체를 등록하지 않은 폰은 처음부터 [폰 암호로 열기]가 기본 단추. 폰 암호가 없는 폰은 여전히 열 수 없다. 잠금 끄기는 없다.
// 잠금 해제와 승인 서명은 별개다: 승인 시트의 [승인하고 발급]은 매번 생체만 + 하드웨어 키 서명(폰 암호 대체 없음).
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBioInfo, type BioInfo } from '../biometry';
import { unlockLabel } from '../biometryLabel';
import { KeyringError, createDevice, resetDevice, unlock, type DeviceKeys, type KeyringErrorCode } from '../keyring';
import { space } from '../theme';
import { Button, Screen, T } from '../ui/kit';

const PASSCODE = '폰 암호로 열기';

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
  const label = firstRun ? '시작하기' : retry ? '다시 시도' : noBio ? PASSCODE : unlockLabel(bio?.kind ?? 'none');
  // 회색 글자 단추: 생체로 다시 시도하는 단추 아래에만(기본 단추가 이미 폰 암호면 두지 않는다)
  const showPasscode = !firstRun && shown === 'cancelled' && !noBio;
  const m = shown ? MESSAGES[shown] : null;

  return (
    <Screen scroll={false} testID="lock-screen">
      <View style={st.wrap}>
        {firstRun && (
          <T v="sub" c="ink2" center testID="lock-first">
            이 폰에만 있는 열쇠를 만들어요.{'\n'}열쇠는 폰 밖으로 나가지 않고 백업되지 않아요.
          </T>
        )}
        {m && (
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
        )}
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

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s5, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: space.s2 },
  btn: { alignSelf: 'stretch' },
});
