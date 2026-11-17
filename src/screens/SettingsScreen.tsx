// 설정(홈 오른쪽 위): 연결된 PC(P-06 연결 상태로) · 연결된 기기(PC·폰 3대씩) · 승인 기기 상태(준비 중) · 알림 · 잠금 · 앱 정보.
import { APP_VERSION, LOCK_AFTER_MS } from '../config';
import { useSession } from '../session';
import { useBioInfo, type BioInfo } from '../biometry';
import { bioName } from '../biometryLabel';
import { Group, Row, Screen } from '../ui/kit';
import { pcLine } from './HomeScreen';

export function SettingsScreen({ onDone, onConnection, onPair, onDevices, bioPreview }: { onDone: () => void; onConnection: () => void; onPair: () => void; onDevices: () => void; bioPreview?: BioInfo }) {
  const s = useSession();
  const bio = useBioInfo(bioPreview);
  const pair = s.data.pair;
  const line = pcLine(s.pc, s.data.lastSeenPc);
  return (
    <Screen title="설정" onBack={onDone} testID="settings">
      <Group title="연결된 PC">
        {pair ? (
          <Row testID="settings-pc" label={pair.desktopName ?? '내 PC'} sub={line.label} valueInk={line.tone === 'attention' ? 'attention' : 'ink2'} onPress={onConnection} />
        ) : (
          <Row testID="settings-pair" label="PC와 연결하기" sub="아직 연결한 PC가 없어요" onPress={onPair} />
        )}
      </Group>
      <Group>
        <Row testID="settings-devices" label="연결된 기기" sub="PC와 폰을 3대씩 연결할 수 있어요" onPress={onDevices} />
      </Group>
      <Group title="이 폰" note={`앱을 열 때와 ${Math.round(LOCK_AFTER_MS / 1000)}초 넘게 다른 앱에 있다 돌아올 때 잠가요. 다른 앱으로 넘어가면 앱 전환 화면에는 내용을 가려요.`}>
        <Row label="승인 기기 상태" value="준비 중" valueInk="ink3" sub="이 폰으로 PC 일을 승인하는 기능" />
        <Row label="알림" value="준비 중" valueInk="ink3" />
        <Row label="앱 잠금" value="켜짐" sub={bio && bio.enrolled && bio.kind !== 'none' ? `${bioName(bio.kind)}, 안 되면 폰 암호` : '폰 암호'} testID="settings-lock" />
      </Group>
      <Group title="앱 정보">
        <Row label="버전" value={APP_VERSION} />
      </Group>
    </Screen>
  );
}
