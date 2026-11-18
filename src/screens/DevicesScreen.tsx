// 연결된 기기(ADR-048 결정 1·6): 계정에 연결한 PC·폰(각 3대까지)을 보고, 잃어버린 기기를 정지하고, 이 폰을 계정에서 뺀다.
// 규칙(줄·한도·정지 가능 여부·문구)은 src/devices.ts에 있고 이 화면은 그리기와 확인 창만 한다.
// - 정지할 수 있는 줄에는 [정지] 알약, 마지막 PC에는 흐린 [정지](누르면 이유). 이 폰·이미 정지된 줄에는 동작이 없다.
// - 정지된 줄은 상태 글을 황토로. 한도에 닿은 묶음은 묶음 아래 한 줄.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { DevicesError, devicesClient, devicesErrorText, devicesView, isStopped, stopConfirm, type AccountDevice, type DeviceRow } from '../devices';
import { accountOrigin } from '../net/account';
import { deviceAuthFor, fetchJson } from '../net/devauth';
import { useSession } from '../session';
import { space } from '../theme';
import { Button, Empty, Group, Notice, Pill, Row, Screen, StatusDot } from '../ui/kit';
import { confirmLeaveThisPhone } from './leavePhone';

export const FULL_NOTE = '3대까지 연결할 수 있어요. 새 기기를 연결하려면 하나를 끊어 주세요.';
const LAST_PC = '계정에 남은 마지막 PC는 정지할 수 없어요. 다른 PC를 먼저 연결한 뒤 정지해 주세요.';

export type DevicesLoad = { kind: 'loading' } | { kind: 'ready'; devices: AccountDevice[] } | { kind: 'error'; code: string };

/** 갤러리 견본: 망을 부르지 않고 이 상태를 그린다. */
export interface DevicesPreview {
  load: DevicesLoad;
  selfId: string;
  now?: number;
}

export function DevicesScreen({ onDone, onReset, onPair, preview }: { onDone: () => void; onReset: () => void; onPair: () => void; preview?: DevicesPreview }) {
  const s = useSession();
  const pair = s.data.pair;
  const [load, setLoad] = useState<DevicesLoad>(preview?.load ?? { kind: 'loading' });
  const client = useMemo(
    () => (pair && !preview ? devicesClient(fetchJson, accountOrigin(), deviceAuthFor(pair.pairId, pair.cert, s.keys.vm)) : null),
    [pair, preview, s.keys],
  );

  const reload = useCallback(async () => {
    if (!client) return;
    setLoad({ kind: 'loading' });
    try {
      setLoad({ kind: 'ready', devices: await client.list() });
    } catch (e) {
      setLoad({ kind: 'error', code: e instanceof DevicesError ? e.code : 'devices.failed' });
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const leave = pair ? () => confirmLeaveThisPhone({ pair, keys: s.keys, onReset }) : undefined;

  const press = (row: DeviceRow) => {
    if (row.stopBlocked === 'last_pc') {
      Alert.alert(stopConfirm(row).title, LAST_PC);
      return;
    }
    if (!row.canStop || !client) return;
    const c = stopConfirm(row);
    Alert.alert(c.title, c.body, [
      { text: '취소', style: 'cancel' },
      {
        text: c.action,
        style: 'destructive',
        onPress: async () => {
          try {
            await client.stop(row.deviceId);
          } catch (e) {
            Alert.alert(c.title, devicesErrorText(e instanceof DevicesError ? e.code : 'devices.failed'));
          }
          await reload();
        },
      },
    ]);
  };

  const thisPhone = leave && (
    <Group title="이 폰">
      <Row label="이 폰 연결 해제" chevron={false} onPress={leave} testID="devices-leave" />
    </Group>
  );

  let body;
  if (!pair) {
    body = <Empty testID="devices-unpaired" title="PC와 연결하면 보여요" sub="계정에 연결한 PC와 폰을 여기서 볼 수 있어요." action={<Button label="PC와 연결하기" onPress={onPair} />} />;
  } else if (load.kind === 'loading') {
    body = <StatusDot busy label="불러오는 중" testID="devices-loading" />;
  } else if (load.kind === 'error' && isStopped(load.code)) {
    body = (
      <>
        <Notice testID="devices-stopped" sub="다시 쓰려면 이 폰 연결을 해제하고 PC와 다시 연결해 주세요.">
          {devicesErrorText(load.code)}
        </Notice>
        {thisPhone}
      </>
    );
  } else if (load.kind === 'error') {
    body = (
      <>
        <Empty testID="devices-error" title="기기 목록을 불러오지 못했어요" sub={devicesErrorText(load.code)} action={<Button kind="secondary" label="다시 불러오기" onPress={() => void reload()} />} />
        {thisPhone}
      </>
    );
  } else {
    const v = devicesView(load.devices, { selfId: preview?.selfId ?? s.keys.deviceId, pairedPcId: pair.desktopDeviceId, now: preview?.now ?? Date.now() });
    const line = (r: DeviceRow) => (
      <Row
        key={r.deviceId}
        testID={`device-${r.deviceId.slice(0, 8)}`}
        label={r.label}
        sub={r.sub}
        subInk={r.attention ? 'attention' : undefined}
        chevron={false}
        onPress={r.canStop || r.stopBlocked === 'last_pc' ? () => press(r) : undefined}
        accessory={r.canStop ? <Pill label="정지" onPress={() => press(r)} /> : r.stopBlocked === 'last_pc' ? <Pill quiet label="정지" onPress={() => press(r)} /> : undefined}
      />
    );
    body = (
      <>
        <Group title={`PC ${v.pcCount}`} note={v.pcFull ? FULL_NOTE : undefined} testID="devices-pcs">
          {v.pcs.map(line)}
        </Group>
        <Group title={`폰 ${v.phoneCount}`} note={v.phoneFull ? FULL_NOTE : undefined} testID="devices-phones">
          {v.phones.map(line)}
        </Group>
        {thisPhone}
      </>
    );
  }

  return (
    <Screen title="연결된 기기" onBack={onDone} testID="devices-screen">
      <View style={{ gap: space.s6, flex: pair ? undefined : 1 }}>{body}</View>
    </Screen>
  );
}
