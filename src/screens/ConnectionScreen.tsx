import { useState } from 'react';
import { Pressable } from 'react-native';
import { sp1Report, type Sp1Report } from '../diag';
import { identityLines } from '../pairing/identity';
import { useSession } from '../session';
import { space } from '../theme';
import { Button, Group, Row, Screen, StatusDot, T } from '../ui/kit';
import { pcWhyText } from '../net/pcWhy';
import { pcLine } from './HomeScreen';
import { confirmLeaveThisPhone } from './leavePhone';

export function ConnectionScreen({ onDone, onReset, onRepair }: { onDone: () => void; onReset: () => void; onRepair: () => void }) {
  const s = useSession();
  const pair = s.data.pair;
  const [sp1, setSp1] = useState<Sp1Report | null>(null);
  const line = pcLine(s.pc, s.data.lastSeenPc);
  const lastWhy = s.data.pcLog?.[s.data.pcLog.length - 1] ?? null;
  const whyLine = pair && (s.pc === 'offline' || s.pc === 'queued' || s.pc === 'stale' || s.pc === 'relink') ? pcWhyText(lastWhy?.code) : null;
  const [showLog, setShowLog] = useState(false);
  const pending = s.pending.receipts + s.pending.cash;
  const ids = pair ? identityLines({ accountEmail: pair.accountEmail ?? null, desktopName: pair.desktopName ?? null }) : null;
  const paired = pair ? new Date(pair.pairedAt) : null;
  return (
    <Screen
      title="PC 연결"
      onBack={onDone}
      testID="connection-screen"
      footer={pair && pending > 0 ? <Button label={`지금 보내기 ${pending}건`} onPress={() => void s.sync()} busy={s.syncing} /> : undefined}
    >
      {pair && ids && paired && (
        <Group>
          <Row label={ids.pc} strong value={<StatusDot tone={line.tone} label={line.sub ? `${line.label} ${line.sub}` : line.label} busy={line.busy} testID="conn-state" />} testID="conn-pc-name" />
          <Row label="계정" value={ids.account} testID="conn-account" />
          <Row label="연결한 날" value={`${paired.getMonth() + 1}월 ${paired.getDate()}일`} />
        </Group>
      )}
      {whyLine && (
        <T v="sub" c="ink2" testID="conn-why">
          {whyLine}
        </T>
      )}

      <Group>
        <Row label={pair ? '다시 연결' : 'PC와 연결'} onPress={onRepair} testID="re-pair" />
        {pair && !!s.data.pcLog?.length && <Row label="연결 기록" onPress={() => setShowLog((v) => !v)} testID="pc-log" />}
        <Row label="보호 상태" onPress={async () => setSp1(await sp1Report())} testID="sp1" />
        {pair && (
          <Pressable testID="unpair" accessibilityRole="button" onPress={() => confirmLeaveThisPhone({ pair, keys: s.keys, onReset })} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s4 }}>
            <T v="body" c="attention">
              연결 끊기
            </T>
          </Pressable>
        )}
      </Group>

      {sp1 && (
        <Group title="보호 상태" testID="sp1-result">
          <Row label={sp1.ok ? '열쇠와 파일 보호 정상' : '보호가 약한 항목이 있어요'} valueInk={sp1.ok ? 'ink2' : 'attention'} value={sp1.ok ? '정상' : '확인'} />
          <Row label="열쇠" value={sp1.keychain.accessible} sub={sp1.keychain.auth === 'none' ? '인증 없음(시뮬레이터 개발)' : sp1.keychain.auth === 'missing' ? '열쇠 보호 방식을 확인하지 못했어요' : '열 때 얼굴이나 지문, 안 되면 폰 암호'} />
          {sp1.files.slice(0, 8).map((f, i) => (
            <Row key={`${i}:${f.path}`} label={f.path} value={f.excludedFromBackup ? '백업 제외' : '백업 포함'} valueInk={f.excludedFromBackup ? 'ink3' : 'attention'} sub={f.protection} />
          ))}
        </Group>
      )}
      {showLog && s.data.pcLog && (
        <Group title="연결 기록" note="PC와 잇지 못한 최근 이유예요. 문의할 때 이 화면을 보여 주세요." testID="pc-log-list">
          {[...s.data.pcLog].reverse().map((w) => (
            <Row key={`${w.at}:${w.code}`} label={pcWhyText(w.code) ?? '이유를 알 수 없어요'} sub={`${new Date(w.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${w.code}`} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
