// S-03 폰 쪽(D08 §4): 앱 안 스캐너로 PC의 QR을 찍고 → 검사(만료·릴레이 허용 목록) → Noise XXpsk0 → 6자리를 보여 준다
// (사용자가 PC에 입력, "일치" 버튼 없음) → pair.ok 검사(AIK 서명 기기 목록·이 PC가 목록에 있음) → 24시간 경고
// → 계정 확인(계정 서비스 서명 acct_claim의 이메일 전체 + PC가 알려 준 이름, [내 계정 맞음], 설계 #120) → 저장.
// 폰에는 계정 로그인이 없어 서버에서 기기 목록을 받지 않는다. 계정 등록은 PC가 대신 한다(팀장 결정 2026-11-06, D08 §4.2 3·7단계).
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { MobilePairing, b64, fromB64, softNoiseStatic, type MobilePairFailure, type MobilePairResult } from '@sax/remote';
import { BRAND, DEV_LOCAL, accountKeys, relayAllowlist } from '../config';
import { inflight } from '../inflight';
import { devFetchQr } from '../net/account';
import { identityLines } from '../pairing/identity';
import { relayFor } from '../net/pc';
import { useSession } from '../session';
import { radius, space, usePalette, useReducedMotion } from '../theme';
import { Button, Group, Notice, Screen, StatusDot, T, success } from '../ui/kit';
import { STEP_PAIR } from '../ui/StepDots';
import { OnboardingStep, StepHint } from './OnboardingScreen';

type Phase = 'scan' | 'warn' | 'confirm' | 'working' | 'sas' | 'done' | 'failed';

const FAIL: Record<MobilePairFailure | 'relay' | 'save', string> = {
  qr_invalid: `${BRAND}의 연결 QR이 아니에요. PC 화면의 QR을 다시 찍어 주세요.`,
  qr_expired: 'QR 시간이 지났어요. PC에서 [새 QR]을 눌러 주세요.',
  relay_not_allowed: `${BRAND}가 아닌 곳으로 연결하려 해서 멈췄어요. PC에서 [새 QR]을 눌러 다시 해 주세요.`,
  devlist_invalid: '내 계정의 기기 목록이 맞는지 확인하지 못해 멈췄어요. PC에서 [새 QR]을 눌러 다시 해 주세요.',
  desktop_unknown: '계정에 등록된 PC가 아니에요. 직접 설치한 PC가 아니면 연결하지 마세요.',
  handshake: 'PC와 연결하지 못했어요. PC에서 [새 QR]을 눌러 다시 해 주세요.',
  pair_ok_invalid: 'PC가 보낸 연결 정보가 맞지 않아 멈췄어요. PC에서 [새 QR]을 눌러 다시 해 주세요.',
  aik_mismatch: '폰과 PC의 계정이 서로 달라 멈췄어요. PC에서 로그인한 계정 메일을 확인해 주세요.',
  acct_claim_invalid: '계정을 확인하지 못했어요. 연결을 멈췄어요. PC에서 [새 QR]을 눌러 다시 해 주세요.',
  timeout: '시간이 지났어요. PC에서 다시 시작해 주세요.',
  relay: '인터넷에 연결되지 않았어요. 와이파이나 데이터를 켜고 다시 해 주세요.',
  save: '연결 정보를 이 폰에 저장하지 못했어요. PC에서 [새 QR]을 눌러 다시 연결해 주세요.',
};

export interface PairOnboarding {
  /** 뒤로(‹·왼쪽 가장자리 쓸기): 온보딩 마지막 장으로. 열쇠는 이미 있으니 [다음]은 다시 이 화면으로 온다 */
  onBack: () => void;
}

export function PairScreen({ onDone, onboarding, previewPhase }: { onDone: () => void; /** 첫 실행 온보딩의 마지막 단계(5/5)로 쓸 때 */ onboarding?: PairOnboarding; /** 갤러리: 이 단계로 그린다(연결 없음) */ previewPhase?: 'scan' | 'done' }) {
  const s = useSession();
  const p = usePalette();
  const [perm, requestPerm] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>(previewPhase ?? 'scan');
  const [fail, setFail] = useState<keyof typeof FAIL | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const pairing = useRef<MobilePairing | null>(null);
  const noiseRef = useRef<ReturnType<typeof softNoiseStatic> | null>(null);
  const scanned = useRef(false);
  const linkRef = useRef<{ close(): void } | null>(null);
  /** 24시간 경고·계정 확인에서 사용자가 고르기 전까지 들고 있는 pair.ok 결과(아직 저장하지 않았다). */
  const pendingRef = useRef<MobilePairResult | null>(null);
  const gone = useRef(false);

  // 화면을 떠나면(잠금 포함) 페어링을 멈춘다: 룸 연결을 닫아 PC 쪽도 끝나게 하고(1회용 룸), 메모리의 Sm 사본을 지운다.
  // 잠긴 뒤 PC가 SAS를 받아도 폰은 키 없이 pair.ok를 저장할 수 없으므로, 끝까지 가지 않게 한다.
  useEffect(
    () => () => {
      gone.current = true;
      linkRef.current?.close();
      noiseRef.current?.destroy();
    },
    [],
  );

  const failWith = (f: keyof typeof FAIL) => {
    if (gone.current) return;
    setFail(f);
    setPhase('failed');
  };

  async function onQr(text: string) {
    if (scanned.current) return;
    scanned.current = true;
    noiseRef.current?.destroy();
    const noise = softNoiseStatic(s.keys.sm);
    noiseRef.current = noise;
    const mp = new MobilePairing({
      keys: {
        noise, vmPub: s.keys.vmPub, kmPub: s.keys.kmPub, deviceId: s.keys.deviceId,
        name: (Device.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android')).slice(0, 40),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
      // 다시 연결이면 앞서 고정한 계정 AIK와 같아야 한다(C-01). 처음이면 QR·6자리로 고른 이 PC의 AIK를 믿는다(TOFU).
      knownAikPub: s.data.pair ? fromB64(s.data.pair.aikPub) : undefined,
      seenListVersion: s.data.seenListVersion,
      accountKeys: accountKeys().map((k) => fromB64(k)),
      relayAllowlist: relayAllowlist(),
    });
    pairing.current = mp;
    mp.onState((st) => {
      if (st === 'show_sas') {
        setSas(mp.sas);
        setPhase('sas');
      }
    });
    if (!mp.scan(text)) return failWith(mp.failure ?? 'qr_invalid');
    await run(mp);
  }

  async function run(mp: MobilePairing) {
    setPhase('working');
    let link;
    try {
      link = await relayFor(mp.relayHost).joinRoom(mp.roomId, 'mobile');
    } catch {
      return failWith('relay');
    }
    linkRef.current = link;
    if (gone.current) return link.close();
    let r: Awaited<ReturnType<MobilePairing['run']>>;
    try {
      r = await mp.run(link);
    } catch {
      r = null;
    }
    if (!r) {
      // 룸 연결을 닫는다(룸은 1회용이라 릴레이가 폐기한다. 다시 할 때는 PC의 새 QR로 새 룸을 연다).
      link.close();
      return failWith(mp.failure ?? 'handshake');
    }
    r.channel.close();
    if (gone.current) return;
    // 3단계 24시간 경고는 PAIR_OK의 AIK 서명 목록으로 판단한다. 그 뒤 PC 이름·계정을 확인한다. 둘 다 고르기 전에는 저장하지 않는다.
    pendingRef.current = r;
    setPhase(mp.newDesktopWarning ? 'warn' : 'confirm');
  }

  const stop = () => {
    pendingRef.current = null;
    (onboarding?.onBack ?? onDone)();
  };

  async function save(r: MobilePairResult) {
    pendingRef.current = null;
    if (gone.current) return;
    try {
      await inflight(() => s.update((d) => ({
        ...d,
        pair: {
          pairId: r.pairId, desktopStatic: b64(r.desktopStatic), desktopVd: b64(r.desktopVd), desktopDeviceId: r.desktopDeviceId,
          accountEmail: r.identity.account.email, desktopName: r.identity.desktopName,
          kvPub: b64(r.kvPub), aikPub: b64(r.aikPub), cert: r.cert, certNotAfter: r.certNotAfter, mbxId: r.mbxId, tokRead: r.tokRead,
            tokWrite: r.tokWrite,
          mbxEpoch: r.mbxEpoch, relayHost: r.relayHost, pairedAt: Date.now(),
        },
        deviceList: r.deviceList,
        // 다시 연결하면 새 우편함·새 번들이다(seq가 처음부터). 옛 최고값을 두면 새 번들을 거부한다.
        qbundleSeq: 0,
        seenListVersion: Math.max(d.seenListVersion, r.deviceList.listVersion),
      })));
    } catch {
      // PC는 이미 이 폰을 받았지만 폰은 기록이 없다. 다시 연결하면 PC가 같은 키를 갱신한다(upsertDevice).
      // 화면 상태에는 남지 않도록 pair를 비워 둔다(저장 실패 뒤 메모리만 연결된 것처럼 보이지 않게).
      await s.update((d) => ({ ...d, pair: null, px: undefined })).catch(() => undefined);
      return failWith('save');
    }
    setPhase('done');
    void s.sync();
  }

  const camera = perm?.granted ? (
    <View style={[st.scanner, { backgroundColor: p.camera }]}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(e) => void onQr(e.data)} />
      <View pointerEvents="none" style={st.reticle}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View key={c} style={[st.corner, st[c], { borderColor: p.onCamera }]} />
        ))}
      </View>
    </View>
  ) : null;

  if (phase === 'scan' && onboarding) {
    return (
      <OnboardingStep
        testID="pair-scan"
        step={STEP_PAIR}
        onBack={onboarding.onBack}
        title="마지막으로, PC와 연결해요"
        body={`PC의 ${BRAND} 앱에서 설정 → 기기 연결 → [폰 연결]을 누르면 QR이 떠요. 그 QR을 여기에 비춰 주세요.`}
        action={
          perm?.granted ? (
            DEV_LOCAL ? (
              <Button testID="dev-qr" kind="secondary" label="개발: 더미 PC의 QR 받기" onPress={async () => void onQr(await devFetchQr())} />
            ) : (
              <StepHint testID="pair-hint">QR이 보이면 저절로 넘어가요</StepHint>
            )
          ) : (
            <Button testID="pair-camera" label="카메라 켜기" onPress={() => void requestPerm()} />
          )
        }
        art={
          camera ?? (
            <View style={[st.scanner, st.center, { backgroundColor: p.canvas, borderColor: p.line, borderWidth: StyleSheet.hairlineWidth, gap: space.s3, padding: space.s6 }]}>
              <View style={st.reticleIdle}>
                {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                  <View key={c} style={[st.corner, st[c], { borderColor: p.ink3 }]} />
                ))}
              </View>
              <T v="sub" c="ink2" center>
                QR을 찍으려면 카메라가 필요해요.{'\n'}찍은 화면은 저장하지 않아요.
              </T>
            </View>
          )
        }
      />
    );
  }

  if (phase === 'scan') {
    return (
      <Screen title="PC와 연결" onBack={onDone} backLabel="취소" scroll={false} testID="pair-scan">
        <View style={{ gap: space.s2 }}>
          <T v="strong">PC 화면의 QR을 찍어 주세요</T>
          <T v="sub" c="ink2">PC의 {BRAND} → 설정 → 기기 연결 → [폰 연결]을 누르면 QR이 떠요.</T>
        </View>
        {perm?.granted ? (
          <View style={[st.scanner, { backgroundColor: p.camera }]}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(e) => void onQr(e.data)} />
            <View pointerEvents="none" style={st.reticle}>
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <View key={c} style={[st.corner, st[c], { borderColor: p.onCamera }]} />
              ))}
            </View>
          </View>
        ) : (
          <View style={[st.scanner, st.center, { backgroundColor: p.tint, gap: space.s4, padding: space.s6 }]}>
            <T v="sub" c="ink2" center>
              QR을 찍으려면 카메라가 필요해요. 찍은 화면은 저장하지 않아요.
            </T>
            <Button small label="카메라 허용" onPress={() => void requestPerm()} />
          </View>
        )}
        {DEV_LOCAL && <Button testID="dev-qr" kind="quiet" label="개발: 더미 PC의 QR 받기" onPress={async () => void onQr(await devFetchQr())} />}
      </Screen>
    );
  }

  if (phase === 'warn') {
    return (
      <Screen
        title="PC와 연결"
        footer={
          <>
            <Button testID="warn-stop" label="중단" onPress={stop} />
            <Button testID="warn-continue" kind="quiet" label="내가 등록한 PC예요. 계속" onPress={() => setPhase('confirm')} />
          </>
        }
      >
        <View style={{ gap: space.s3 }}>
          <StatusDot tone="attention" label="오늘 등록된 PC예요" />
          <T v="body">직접 등록한 PC가 아니면 여기서 중단하세요.</T>
          <T v="sub" c="ink2">
            중단하면 이 폰에 연결 정보를 남기지 않아요. 계정에 다른 기기가 있으면 그 기기와 메일로도 알려요.
          </T>
        </View>
      </Screen>
    );
  }

  if (phase === 'confirm' && pendingRef.current) {
    const id = pendingRef.current.identity;
    const lines = identityLines({ accountEmail: id.account.email, desktopName: id.desktopName });
    return (
      <Screen
        title="PC와 연결"
        testID="pair-confirm"
        footer={
          <>
            <Button testID="confirm-mine" label="내 계정이 맞아요" onPress={() => pendingRef.current && void save(pendingRef.current)} />
            <Button testID="confirm-stop" kind="quiet" label="아니에요, 중단" onPress={stop} />
          </>
        }
      >
        <T v="strong">내 계정과 내 PC가 맞나요?</T>
        <Group note="내 계정이 아니면 중단하세요. 연결한 뒤에도 [PC 연결]에서 늘 볼 수 있어요.">
          <View style={st.kv}>
            <T v="label" c="ink3">계정 · {BRAND}가 확인함</T>
            <T v="strong" testID="confirm-account">
              {lines.account}
            </T>
          </View>
          <View style={st.kv}>
            <T v="label" c="ink3">PC가 알려 준 이름 · 참고</T>
            <T v="body" testID="confirm-pc">
              {lines.pc}
            </T>
          </View>
        </Group>
      </Screen>
    );
  }

  if (phase === 'sas' && sas) {
    return (
      <Screen title="PC와 연결" testID="pair-sas" onBack={onboarding?.onBack ?? onDone} backLabel="취소">
        <View style={{ gap: space.s2 }}>
          <T v="strong">PC 화면에 이 숫자를 입력하세요</T>
          <T v="sub" c="ink2">
            입력하면 이 화면이 저절로 넘어가요. 세 번 틀리면 처음부터 다시 해요.
          </T>
        </View>
        <View style={[st.sasBox, { backgroundColor: p.tint }]} accessible accessibilityLabel={`확인 숫자 ${sas.split('').join(' ')}`}>
          <T v="sas" testID="sas-code">
            {sas.slice(0, 3)} {sas.slice(3)}
          </T>
        </View>
        <Notice>이 숫자는 PC 화면에만 입력하세요. 전화·문자·메신저로 묻는 사람에게는 알려 주지 마세요.</Notice>
      </Screen>
    );
  }

  if (phase === 'done' && onboarding) return <PairedScene onStart={onDone} pcName={s.data.pair?.desktopName ?? null} />;

  if (phase === 'done') {
    return (
      <Screen title="PC와 연결" testID="pair-done" footer={<Button label="확인" onPress={onDone} />}>
        <View style={{ gap: space.s3 }}>
          <StatusDot tone="accent" label="연결됐어요" />
          <T v="body">이제 종이 증빙과 현금 매출을 이 PC로 보낼 수 있어요.</T>
          <T v="sub" c="ink2">
            보내는 내용은 이 폰과 PC만 열 수 있어요. 중간의 연결 서버도 볼 수 없어요.
          </T>
        </View>
      </Screen>
    );
  }

  if (phase === 'failed') {
    return (
      <Screen
        title="PC와 연결"
        footer={
          <>
            <Button
              label="다시 찍기"
              onPress={() => {
                scanned.current = false;
                setFail(null);
                setPhase('scan');
              }}
            />
            {!onboarding && <Button kind="quiet" label="닫기" onPress={onDone} />}
          </>
        }
      >
        <View style={{ gap: space.s3 }}>
          <T v="strong">연결하지 못했어요</T>
          <Notice>{FAIL[fail ?? 'handshake']}</Notice>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="PC와 연결" onBack={onboarding?.onBack ?? onDone} backLabel="취소" testID="pair-working">
      <StatusDot busy label="PC와 연결하는 중" />
    </Screen>
  );
}

/**
 * 첫 실행 끝 장면: 체크가 그려지듯 커지고 물결이 한 번 퍼진 뒤 글이 떠오른다. [시작하기] → 홈.
 * transform·opacity 네이티브 드라이버, 동작 줄이기면 바로 완성 상태.
 */
function PairedScene({ onStart, pcName }: { onStart: () => void; pcName: string | null }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const pop = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const text = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    success();
    const a = Animated.parallel([
      Animated.spring(pop, { toValue: 1, damping: 11, stiffness: 160, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 900, delay: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: 420, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [pop, ring, text, reduce]);
  return (
    <Screen scroll={false} testID="pair-done" footer={<Button testID="pair-start" label="시작하기" onPress={onStart} />}>
      <View style={st.doneWrap}>
        <View style={st.doneMark}>
          <Animated.View style={[st.doneRing, { borderColor: p.accent, opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] }) }] }]} />
          <Animated.View style={[st.doneDisc, { backgroundColor: p.accentSoft, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '0deg'] }) }] }]}>
            <View style={[st.doneCheck, { borderColor: p.accent }]} />
          </Animated.View>
        </View>
        <Animated.View style={{ gap: space.s2, alignItems: 'center', opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <T v="title" role="header" center>
            연결됐어요
          </T>
          <T v="sub" c="ink2" center>
            {pcName ? `${pcName}와 이 폰이 이어졌어요. ` : ''}이제 폰에서 세금계산서를 확인하고 승인하고, 증빙을 찍어 보낼 수 있어요.
          </T>
        </Animated.View>
      </View>
    </Screen>
  );
}

const CORNER = 28;
const st = StyleSheet.create({
  scanner: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  reticleIdle: { width: 96, height: 96, marginBottom: space.s2 },
  reticle: { position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  sasBox: { alignItems: 'center', paddingVertical: space.s7, borderRadius: radius.lg },
  kv: { paddingHorizontal: space.s4, paddingVertical: space.s3, gap: 2 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s6, paddingHorizontal: space.s3, paddingBottom: space.s7 },
  doneMark: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  doneRing: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2 },
  doneDisc: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  doneCheck: { width: 34, height: 18, borderLeftWidth: 5, borderBottomWidth: 5, transform: [{ rotate: '-45deg' }], marginTop: -8 },
});
