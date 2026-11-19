// 설정(홈 오른쪽 위): 연결(PC · 계정 · 연결된 기기) · 알림 · 보안(앱 잠금) · 도움말(사용 안내 · 문의) · 앱 정보(버전 · 약관).
// D08 §4.2: 연결된 PC와 계정은 설정에 늘 보인다. "준비 중"처럼 아무것도 못 하는 줄은 두지 않는다.
import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { APP_VERSION, LOCK_AFTER_MS, PUBLIC_ORIGIN } from '../config';
import { useSession } from '../session';
import { useBioInfo, type BioInfo } from '../biometry';
import { bioName } from '../biometryLabel';
import { DEFAULT_PREFS, wakeOn } from '../notify/events';
import { permission, type Permission } from '../notify/local';
import { space, type TextSize } from '../theme';
import { Group, Row, Screen, Seg, T } from '../ui/kit';
import { pcLine } from './HomeScreen';
import { NotifyScreen } from './NotifyScreen';

export const HELP = {
  guide: `${PUBLIC_ORIGIN}/guide/`,
  privacy: `${PUBLIC_ORIGIN}/privacy/`,
  terms: `${PUBLIC_ORIGIN}/terms/`,
  mail: 'mailto:contact@laf-co.com?subject=%ED%83%9D%EC%8A%A4%EC%98%A4%ED%94%84%20%ED%8F%B0%20%EB%AC%B8%EC%9D%98',
} as const;

const open = (url: string) => () => void Linking.openURL(url).catch(() => {});

export function SettingsScreen({
  onDone, onConnection, onPair, onDevices, bioPreview, permPreview, sub: initialSub = null,
}: { onDone: () => void; onConnection: () => void; onPair: () => void; onDevices: () => void; bioPreview?: BioInfo; permPreview?: Permission; sub?: 'notify' | null }) {
  const s = useSession();
  const bio = useBioInfo(bioPreview);
  const [sub, setSub] = useState<'notify' | null>(initialSub);
  const [perm, setPerm] = useState<Permission | null>(permPreview ?? null);
  useEffect(() => {
    if (permPreview || sub) return;
    void permission().then(setPerm);
    const x = AppState.addEventListener('change', (st) => st === 'active' && void permission().then(setPerm));
    return () => x.remove();
  }, [permPreview, sub]);

  if (sub === 'notify') return <NotifyScreen onDone={() => setSub(null)} permPreview={permPreview} />;

  const pair = s.data.pair;
  const line = pcLine(s.pc, s.data.lastSeenPc);
  const prefs = s.data.notify ?? DEFAULT_PREFS;
  const anyOn = prefs.run || prefs.money || wakeOn(prefs);
  // 사장님 말로 둘만: 폰이 알려 주면 켜짐, 아니면 꺼짐(OS가 아직 묻지 않은 상태도 꺼짐이다)
  const notifyValue = perm === 'granted' && anyOn ? '켜짐' : '꺼짐';
  const lockSub = bio && bio.enrolled && bio.kind !== 'none' ? `${bioName(bio.kind)}, 안 되면 폰 암호` : '폰 암호';

  return (
    <Screen title="설정" onBack={onDone} testID="settings">
      <Group title="연결">
        {pair ? (
          <Row testID="settings-pc" label={pair.desktopName ?? '내 PC'} sub={line.label} subInk={line.tone === 'attention' ? 'attention' : 'ink3'} onPress={onConnection} />
        ) : (
          <Row testID="settings-pair" label="PC와 연결하기" sub="아직 연결한 PC가 없어요" onPress={onPair} />
        )}
        {pair?.accountEmail && <Row testID="settings-account" label="계정" value={pair.accountEmail} />}
        <Row testID="settings-devices" label="연결된 기기" sub="PC와 폰을 3대씩 연결할 수 있어요" onPress={onDevices} />
      </Group>

      <Group title="알림">
        <Row testID="settings-notify" label="알림" value={perm === null ? '' : notifyValue} valueInk={perm === 'denied' ? 'attention' : 'ink2'} onPress={() => setSub('notify')} />
      </Group>

      <View style={{ gap: space.s2 }} testID="settings-text-size">
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          글자 크기
        </T>
        <Seg<TextSize>
          testID="text-size"
          options={[
            { key: 'small', label: '작게' },
            { key: 'medium', label: '중간' },
            { key: 'large', label: '크게' },
          ]}
          value={s.data.textSize ?? 'medium'}
          onChange={(k) => void s.update((d) => ({ ...d, textSize: k }))}
        />
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          앱 안의 모든 글자에 적용돼요. 폰 설정의 글자 크기와 함께 커져요.
        </T>
      </View>

      <Group title="보안" note={`앱을 열 때와 ${Math.round(LOCK_AFTER_MS / 1000)}초 넘게 다른 앱에 있다 돌아올 때 잠가요. 앱 전환 화면에서는 내용을 가려요.`}>
        <Row label="앱 잠금" value="켜짐" sub={lockSub} testID="settings-lock" />
      </Group>

      <Group title="도움말">
        <Row testID="settings-guide" label="사용 안내" onPress={open(HELP.guide)} />
        <Row testID="settings-mail" label="문의하기" sub="contact@laf-co.com" onPress={open(HELP.mail)} />
      </Group>

      <Group title="앱 정보">
        <Row label="버전" value={APP_VERSION} />
        <Row testID="settings-privacy" label="개인정보 처리방침" onPress={open(HELP.privacy)} />
        <Row testID="settings-terms" label="이용약관" onPress={open(HELP.terms)} />
      </Group>
    </Screen>
  );
}
