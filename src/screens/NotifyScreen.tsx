// 설정 > 알림: OS 허용 한 줄 + 받을 알림 둘(발급 진행 · 돈 기한). 고른 것은 봉인 상태 파일(AppData.notify)에 둔다.
// 서버 푸시는 아직 없다(notify/local.ts). 그래서 무엇이 언제 오는지 화면에 그대로 적는다.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Switch } from 'react-native';
import { DEFAULT_PREFS, type NotifyPrefs } from '../notify/events';
import { askPermission, cancelMoney, permission, type Permission } from '../notify/local';
import { useSession } from '../session';
import { usePalette } from '../theme';
import { Button, Group, Row, Screen, tap } from '../ui/kit';

export function NotifyScreen({ onDone, permPreview }: { onDone: () => void; permPreview?: Permission }) {
  const s = useSession();
  const p = usePalette();
  const prefs = s.data.notify ?? DEFAULT_PREFS;
  const [perm, setPerm] = useState<Permission | null>(permPreview ?? null);
  const refresh = useCallback(() => {
    if (permPreview) return;
    void permission().then(setPerm);
  }, [permPreview]);
  useEffect(() => {
    refresh();
    // 설정 앱에서 허용하고 돌아오면 다시 읽는다
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const set = (k: keyof NotifyPrefs, v: boolean) => {
    tap();
    void s.update((d) => ({ ...d, notify: { ...(d.notify ?? DEFAULT_PREFS), [k]: v } }));
    if (k === 'money' && !v) void cancelMoney();
  };
  const sw = (k: keyof NotifyPrefs) => (
    <Switch
      testID={`notify-${k}`}
      value={prefs[k]}
      onValueChange={(v) => set(k, v)}
      trackColor={{ true: p.ink, false: p.sunken }}
      // 켜짐은 ink 채움(파랑은 PC 켜짐에만 쓴다). 다크에서 ink가 밝으므로 손잡이는 바탕색
      thumbColor={p.canvas}
      {...(Platform.OS === 'web' ? { activeThumbColor: p.canvas } : {})}
      ios_backgroundColor={p.sunken}
      accessibilityLabel={k === 'run' ? '발급 진행 알림' : '돈 기한 알림'}
    />
  );

  const off = perm === 'denied';
  return (
    <Screen title="알림" onBack={onDone} testID="notify-settings">
      <Group
        title="이 폰"
        note={
          off
            ? '폰 설정에서 택스오프 알림을 꺼 두셨어요. 앱을 열어 두면 화면 위에 알림이 떠요.'
            : perm === 'undetermined'
              ? '허용하면 앱이 뒤에 있을 때도 알려 드려요. 잠금 화면에는 거래처·금액을 보이지 않아요.'
              : '잠금 화면에는 거래처·금액을 보이지 않아요.'
        }
      >
        <Row
          testID="notify-permission"
          label="폰 알림"
          value={perm === null ? '' : perm === 'granted' ? '허용됨' : off ? '꺼짐' : '아직 안 정함'}
          valueInk={off ? 'attention' : 'ink2'}
          onPress={off ? () => void Linking.openSettings() : undefined}
        />
      </Group>
      {perm === 'undetermined' && (
        <Button kind="secondary" label="알림 허용하기" onPress={() => void askPermission().then(setPerm)} testID="notify-ask" />
      )}

      <Group
        title="받을 알림"
        note="발급 진행은 앱을 쓰는 중이거나 잠기기 전(뒤로 간 지 30초 안)에 알려 드려요. 앱을 오래 닫아 둬도 오는 알림은 준비하고 있어요."
      >
        <Row label="발급 진행" sub="내 차례 · 발급 끝남 · 멈춤 · 확인 필요" accessory={sw('run')} />
        <Row label="받을 돈·낼 돈 기한" sub="기한 지났거나 7일 안에 올 것이 있으면 아침 9시에" accessory={sw('money')} />
      </Group>
    </Screen>
  );
}
