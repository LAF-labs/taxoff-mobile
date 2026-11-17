// P-06 연결 상태: PC 켜짐·꺼짐, 마지막 접속, 페어링, PC로 아직 못 보낸 사진·현금매출 건수.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { sp1Report, type Sp1Report } from '../diag';
import { identityLines } from '../pairing/identity';
import { resetDevice } from '../keyring';
import { useSession } from '../session';
import { space } from '../theme';
import { Button, Group, Row, Screen, StatusDot, T, ago } from '../ui/kit';
import { pcLine } from './HomeScreen';

export function ConnectionScreen({ onDone, onReset, onRepair }: { onDone: () => void; onReset: () => void; onRepair: () => void }) {
  const s = useSession();
  const pair = s.data.pair;
  const [sp1, setSp1] = useState<Sp1Report | null>(null);
  const line = pcLine(s.pc, s.data.lastSeenPc);
  const detail =
    s.pc === 'queued'
      ? '보낼 것을 연결 서버에 암호화해 맡겼어요. PC가 24시간 안에 켜지면 받아요.'
      : s.pc === 'stale'
        ? 'PC가 일주일 넘게 꺼져 있어 맡길 수도 없어요. PC를 켜 두거나 다시 연결해 주세요.'
        : s.pc === 'online'
          ? '보내면 PC가 바로 받아요.'
          : null;
  const certDays = pair ? Math.floor((pair.certNotAfter - Date.now()) / 86_400_000) : 0;
  const ids = pair ? identityLines({ accountEmail: pair.accountEmail ?? null, desktopName: pair.desktopName ?? null }) : null;
  return (
    <Screen
      title="PC 연결"
      onBack={onDone}
      testID="connection-screen"
      footer={pair ? <Button label="지금 보내기" onPress={() => void s.sync()} busy={s.syncing} disabled={s.pending.receipts + s.pending.cash === 0 && s.pc !== 'stale'} /> : undefined}
    >
      <View style={{ gap: space.s2 }}>
        <StatusDot tone={line.tone} label={line.label} busy={line.busy} testID="conn-state" />
        {detail && <T v="sub" c="ink2">{detail}</T>}
      </View>

      <Group title="보낼 것">
        <Row label="사진" value={`${s.pending.receipts}장`} testID="conn-pending" />
        <Row label="현금 매출" value={`${s.pending.cash}건`} />
        <Row label="마지막 접속" value={ago(s.data.lastSeenPc)} />
      </Group>

      {pair && ids && (
        <Group title="연결한 PC" note="계정은 계정 서버가 확인한 값이고, PC 이름은 PC가 알려 준 참고 값이에요.">
          <Row label="계정" value={ids.account} testID="conn-account" />
          <Row label="PC 이름" value={ids.pc} testID="conn-pc-name" />
          <Row label="연결한 날" value={`${new Date(pair.pairedAt).getFullYear()}년 ${new Date(pair.pairedAt).getMonth() + 1}월 ${new Date(pair.pairedAt).getDate()}일`} />
          <Row label="PC 기기" value={`…${pair.desktopDeviceId.slice(-6)}`} />
          <Row label="인증서" value={certDays > 0 ? `${certDays}일 남음` : '만료됨'} valueInk={certDays > 0 ? 'ink2' : 'attention'} sub={certDays > 0 ? 'PC가 켜지면 저절로 갱신해요' : 'PC와 다시 연결해 주세요'} />
        </Group>
      )}

      <Group title="이 폰">
        {pair && s.pc === 'stale' && <Row label="다시 연결하기" onPress={onRepair} testID="re-pair" />}
        <Row label="보호 상태 보기" onPress={async () => setSp1(await sp1Report())} testID="sp1" />
        {pair && (
          <Row
            label="이 폰 연결 해제"
            testID="unpair"
            chevron={false}
            onPress={() =>
              Alert.alert('이 폰 연결 해제', '이 폰의 열쇠와 아직 보내지 않은 사진·현금 매출을 지워요. PC의 기기 목록에서도 이 폰을 해제해 주세요.', [
                { text: '취소', style: 'cancel' },
                {
                  text: '해제',
                  style: 'destructive',
                  onPress: async () => {
                    await resetDevice();
                    onReset();
                  },
                },
              ])
            }
          />
        )}
      </Group>

      {sp1 && (
        <Group title="보호 상태" testID="sp1-result">
          <Row label={sp1.ok ? '열쇠·파일 보호 정상' : '보호가 약한 항목이 있어요'} valueInk={sp1.ok ? 'ink2' : 'attention'} value={sp1.ok ? '정상' : '확인'} />
          <Row label="열쇠" value={sp1.keychain.accessible} sub={sp1.keychain.auth === 'none' ? '인증 없음(시뮬레이터 개발)' : sp1.keychain.auth === 'missing' ? '열쇠 정책을 읽지 못했어요' : '열 때 얼굴·지문, 안 되면 폰 암호'} />
          {sp1.files.slice(0, 8).map((f, i) => (
            <Row key={`${i}:${f.path}`} label={f.path} value={f.excludedFromBackup ? '백업 제외' : '백업 포함'} valueInk={f.excludedFromBackup ? 'ink3' : 'attention'} sub={f.protection} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
