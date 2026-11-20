import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Switch } from 'react-native';
import { DEFAULT_PREFS, wakeOn, type NotifyPrefs } from '../notify/events';
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
      value={k === 'wake' ? wakeOn(prefs) : !!prefs[k]}
      onValueChange={(v) => set(k, v)}
      trackColor={{ true: p.ink, false: p.sunken }}
      thumbColor={p.canvas}
      {...(Platform.OS === 'web' ? { activeThumbColor: p.canvas } : {})}
      ios_backgroundColor={p.sunken}
      accessibilityLabel={k === 'run' ? '발급 진행 알림' : k === 'wake' ? '승인할 일과 맡긴 일 소식 알림' : '돈 기한 알림'}
    />
  );

  const off = perm === 'denied';
  return (
    <Screen title="알림" onBack={onDone} testID="notify-settings">
      <Group
        title="이 폰"
        note={off ? '폰 설정에서 꺼 두셨어요. 누르면 설정을 열어요.' : perm === 'undetermined' ? '허용하면 앱을 닫아 둬도 알려 드려요.' : undefined}
      >
        <Row
          testID="notify-permission"
          label="폰 알림"
          value={perm === null ? '' : perm === 'granted' ? '켜짐' : '꺼짐'}
          valueInk={off ? 'attention' : 'ink2'}
          onPress={off ? () => void Linking.openSettings() : undefined}
        />
      </Group>
      {perm === 'undetermined' && (
        <Button kind="secondary" label="알림 허용하기" onPress={() => void askPermission().then(setPerm)} testID="notify-ask" />
      )}

      <Group
        title="받을 알림"
        note="앱을 닫아 둬도 오는 알림 글은 “승인을 기다리는 발급이 있어요”와 “맡긴 일에 새 소식이 있어요” 둘뿐이에요. 잠금 화면에는 거래처와 금액을 보이지 않아요."
      >
        <Row label="승인할 일과 맡긴 일 소식" sub="앱을 닫아 둬도 알려요" accessory={sw('wake')} />
        <Row label="발급 진행" sub="앱을 쓰는 중에 내 차례가 오거나 발급이 끝나면" accessory={sw('run')} />
        <Row label="돈 기한" sub="받을 돈, 낼 돈 기한이 다가오면 아침 9시에" accessory={sw('money')} />
      </Group>
    </Screen>
  );
}
