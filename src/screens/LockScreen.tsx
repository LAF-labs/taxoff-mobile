// P-01 잠금: 앱을 열 때 생체 인증, 백그라운드 30초 뒤 다시 잠금. 해제 = 생체로 보호된 키 항목 읽기(keyring.unlock).
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyringError, createDevice, resetDevice, unlock, type DeviceKeys, type KeyringErrorCode } from '../keyring';
import { BRAND } from '../config';
import { space, usePalette } from '../theme';
import { Button, Notice, Screen, T } from '../ui/kit';

const MESSAGES: Record<KeyringErrorCode, string> = {
  cancelled: '확인을 취소했어요. 다시 열려면 아래를 눌러 주세요.',
  passcode_required: '이 폰에 화면 잠금(암호)을 켜야 쓸 수 있어요. 설정에서 켠 뒤 다시 열어 주세요.',
  biometry_required: '얼굴이나 지문을 이 폰에 등록해야 쓸 수 있어요.',
  corrupt: '이 폰의 열쇠를 찾을 수 없어요. 초기화한 뒤 PC와 다시 연결해 주세요.',
  unavailable: '열쇠 저장소를 열 수 없어요. 잠시 뒤 다시 해 주세요.',
};

export function LockScreen({ firstRun, onUnlocked, onReset }: { firstRun: boolean; onUnlocked: (k: DeviceKeys, created: boolean) => void; onReset: () => void }) {
  const [err, setErr] = useState<KeyringErrorCode | null>(null);
  // 개발 빌드만 원인 문구를 함께 보인다(값·키는 들어 있지 않다)
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = usePalette();

  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (firstRun) onUnlocked(await createDevice(), true);
      else onUnlocked(await unlock(), false);
    } catch (e) {
      setErr(e instanceof KeyringError ? e.code : 'unavailable');
      if (__DEV__) setDetail(String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!firstRun) void open();
    // 처음 한 번만 자동으로 묻는다
  }, []);

  return (
    <Screen
      scroll={false}
      testID="lock-screen"
      footer={
        <>
          {err && <Notice>{MESSAGES[err]}</Notice>}
          {err && detail && (
            <T v="meta" c="ink3">
              {detail}
            </T>
          )}
          <Button testID="unlock" label={firstRun ? '시작하기' : '얼굴·지문으로 열기'} onPress={open} busy={busy} />
          {err === 'corrupt' && (
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
        </>
      }
    >
      <View style={st.wrap}>
        <View style={[st.mark, { backgroundColor: p.ink }]}>
          <View style={[st.markInner, { borderColor: p.onInk }]} />
        </View>
        <View style={{ gap: space.s2, alignItems: 'center' }}>
          <T v="title">{BRAND}</T>
          {firstRun ? (
            <T v="sub" c="ink2" center>
              이 폰에만 있는 열쇠를 만들어요.{'\n'}열쇠는 폰 밖으로 나가지 않고 백업되지 않아요.
            </T>
          ) : (
            <T v="sub" c="ink2" center>
              잠겨 있어요
            </T>
          )}
        </View>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s5, paddingBottom: space.s7 },
  mark: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  markInner: { width: 26, height: 32, borderWidth: 2.5, borderRadius: 4 },
});
