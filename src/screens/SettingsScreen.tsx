import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { APP_VERSION, LOCK_AFTER_MS, PUBLIC_ORIGIN } from '../config';
import { useSession } from '../session';
import { useBioInfo, type BioInfo } from '../biometry';
import { chatCopyOf } from '../net/pcCopy';
import { offlineChat } from '../offline/device';
import { bioName } from '../biometryLabel';
import { DEFAULT_PREFS, wakeOn } from '../notify/events';
import { permission, type Permission } from '../notify/local';
import { space, type TextSize } from '../theme';
import { Group, Row, Screen, Seg, T } from '../ui/kit';
import { pcLine } from './HomeScreen';
import { NotifyScreen } from './NotifyScreen';

const HELP = {
  guide: `${PUBLIC_ORIGIN}/guide/`,
  privacy: `${PUBLIC_ORIGIN}/privacy/`,
  terms: `${PUBLIC_ORIGIN}/terms/`,
  mail: 'mailto:contact@laf-co.com?subject=%ED%83%9D%EC%8A%A4%EC%98%A4%ED%94%84%20%ED%8F%B0%20%EB%AC%B8%EC%9D%98',
} as const;

const open = (url: string) => () => void Linking.openURL(url).catch(() => {});

/** 주간 한도가 다시 채워지는 날(한국 시간), 예: "12월 1일 월요일". */
export function resetDay(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${'일월화수목금토'[d.getUTCDay()]}요일`;
}

export function SettingsScreen({
  onDone, onConnection, onPair, onDevices, bioPreview, permPreview, sub: initialSub = null,
}: { onDone: () => void; onConnection: () => void; onPair: () => void; onDevices: () => void; bioPreview?: BioInfo; permPreview?: Permission; sub?: 'notify' | null }) {
  const s = useSession();
  const bio = useBioInfo(bioPreview);
  const [sub, setSub] = useState<'notify' | null>(initialSub);
  const [perm, setPerm] = useState<Permission | null>(permPreview ?? null);
  const [usage, setUsage] = useState<{ percent: number; resetAt: number } | null>(null);
  const pairNow = s.data.pair;
  useEffect(() => {
    if (!pairNow) return;
    let live = true;
    void offlineChat(pairNow, s.keys, () => chatCopyOf(s.data.pcCopy))?.usage().then((u) => live && setUsage(u)).catch(() => undefined);
    return () => { live = false; };
  }, [pairNow, s.keys]);
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

      {usage && (
        <Group title="대화">
          <Row testID="settings-usage" label="이번 주 대화" value={`${usage.percent}%`} />
          <Row testID="settings-usage-reset" label="다시 채워지는 날" value={resetDay(usage.resetAt)} />
        </Group>
      )}

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
