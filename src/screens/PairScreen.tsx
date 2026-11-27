import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { MobilePairing, b64, fromB64, softNoiseStatic, type MobilePairFailure, type MobilePairResult } from '@sax/remote';
import { BRAND, DEV_LOCAL, accountKeys, relayAllowlist } from '../config';
import { deviceModel } from '../deviceModel';
import { inflight } from '../inflight';
import { devFetchQr } from '../net/account';
import { identityLines } from '../pairing/identity';
import { leavePc, relayFor } from '../net/pc';
import { useSession } from '../session';
import { radius, space, usePalette, useReducedMotion } from '../theme';
import { Button, Group, Notice, Screen, StatusDot, T, success } from '../ui/kit';
import { STEP_PAIR } from '../ui/StepDots';
import { Sheet } from '../ui/sheet';
import { OnboardingStep, StepHint } from './OnboardingScreen';

type Phase = 'scan' | 'warn' | 'confirm' | 'switch' | 'working' | 'sas' | 'done' | 'failed';

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

interface PairOnboarding {
  onBack: () => void;
}

export function PairScreen({ onDone, onboarding, previewPhase }: { onDone: () => void; onboarding?: PairOnboarding; previewPhase?: 'scan' | 'done' }) {
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
  const pendingRef = useRef<MobilePairResult | null>(null);
  const gone = useRef(false);
  /** 이미 연결한 폰의 다시 연결: 지금 화면 위 바텀시트 하나에서 QR, 숫자, 끝. 먼저 끊지 않는다. */
  const prev = useRef(s.data.pair).current;
  const relink = !onboarding && !!prev;

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
        name: deviceModel(),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
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
      link.close();
      return failWith(mp.failure ?? 'handshake');
    }
    r.channel.close();
    if (gone.current) return;
    pendingRef.current = r;
    setPhase(mp.newDesktopWarning ? 'warn' : afterCheck(r));
  }

  /** 다시 연결이면 계정은 이미 확인했다(AIK가 같아야 여기까지 온다). 다른 PC면 바꿀지만 묻는다. */
  function afterCheck(r: MobilePairResult): Phase {
    if (!relink || !prev) return 'confirm';
    if (r.desktopDeviceId !== prev.desktopDeviceId) return 'switch';
    void save(r);
    return 'working';
  }

  const stop = () => {
    pendingRef.current = null;
    (onboarding?.onBack ?? onDone)();
  };

  async function save(r: MobilePairResult) {
    pendingRef.current = null;
    if (gone.current) return;
    if (prev && prev.desktopDeviceId !== r.desktopDeviceId) await leavePc({ keys: s.keys, data: () => s.data, update: s.update }, prev);
    try {
      await inflight(() => s.update((d) => ({
        ...d,
        pcCopy: d.pair?.desktopDeviceId === r.desktopDeviceId ? d.pcCopy : undefined,
        pair: {
          pairId: r.pairId, desktopStatic: b64(r.desktopStatic), desktopVd: b64(r.desktopVd), desktopDeviceId: r.desktopDeviceId,
          accountEmail: r.identity.account.email, desktopName: r.identity.desktopName,
          kvPub: b64(r.kvPub), aikPub: b64(r.aikPub), cert: r.cert, certNotAfter: r.certNotAfter, mbxId: r.mbxId, tokRead: r.tokRead,
            tokWrite: r.tokWrite,
          mbxEpoch: r.mbxEpoch, relayHost: r.relayHost, pairedAt: Date.now(),
        },
        deviceList: r.deviceList,
        qbundleSeq: 0,
        seenListVersion: Math.max(d.seenListVersion, r.deviceList.listVersion),
      })));
    } catch {
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
      <Frame sheet={relink} step={1} title={relink ? '다시 연결' : 'PC와 연결'} onBack={onDone} backLabel="취소" scroll={false} testID="pair-scan">
        {relink ? (
          <T v="body">PC 앱의 [폰 연결] QR을 찍어 주세요.</T>
        ) : (
          <View style={{ gap: space.s2 }}>
            <T v="strong">PC 화면의 QR을 찍어 주세요</T>
            <T v="sub" c="ink2">PC의 {BRAND} → 설정 → 기기 연결 → [폰 연결]을 누르면 QR이 떠요.</T>
          </View>
        )}
        {perm?.granted ? (
          <View style={[st.scanner, relink && st.scannerFill, { backgroundColor: p.camera }]}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(e) => void onQr(e.data)} />
            <View pointerEvents="none" style={st.reticle}>
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <View key={c} style={[st.corner, st[c], { borderColor: p.onCamera }]} />
              ))}
            </View>
          </View>
        ) : (
          <View style={[st.scanner, relink && st.scannerFill, st.center, { backgroundColor: p.tint, gap: space.s4, padding: space.s6 }]}>
            <T v="sub" c="ink2" center>
              QR을 찍으려면 카메라가 필요해요. 찍은 화면은 저장하지 않아요.
            </T>
            <Button small label="카메라 허용" onPress={() => void requestPerm()} />
          </View>
        )}
        {DEV_LOCAL && <Button testID="dev-qr" kind="quiet" label="개발: 더미 PC의 QR 받기" onPress={async () => void onQr(await devFetchQr())} />}
      </Frame>
    );
  }

  if (phase === 'warn') {
    return (
      <Frame
        sheet={relink}
        step={1}
        title={relink ? '다시 연결' : 'PC와 연결'}
        footer={
          <>
            <Button testID="warn-stop" label="중단" onPress={stop} />
            <Button testID="warn-continue" kind="quiet" label="내가 등록한 PC예요. 계속" onPress={() => pendingRef.current && setPhase(afterCheck(pendingRef.current))} />
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
      </Frame>
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
        <Group>
          <View style={st.kv}>
            <T v="label" c="ink3">계정</T>
            <T v="strong" testID="confirm-account">
              {lines.account}
            </T>
          </View>
          <View style={st.kv}>
            <T v="label" c="ink3">PC 이름</T>
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
      <Frame sheet step={2} title={relink ? '다시 연결' : 'PC와 연결'} testID="pair-sas" onBack={onboarding?.onBack ?? onDone}>
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
        <Notice>이 숫자는 PC 화면에만 입력하세요. 전화, 문자, 메신저로 묻는 사람에게는 알려 주지 마세요.</Notice>
      </Frame>
    );
  }

  if (phase === 'done' && onboarding) return <PairedScene onStart={onDone} pcName={s.data.pair?.desktopName ?? null} />;

  if (phase === 'switch' && pendingRef.current) {
    const next = pendingRef.current.identity.desktopName ?? 'PC';
    return (
      <Frame
        sheet
        title="다시 연결"
        step={1}
        testID="pair-switch"
        onBack={stop}
        footer={
          <>
            <Button testID="switch-yes" label="바꾸기" onPress={() => pendingRef.current && void save(pendingRef.current)} />
            <Button testID="switch-no" kind="quiet" label="그대로 두기" onPress={stop} />
          </>
        }
      >
        <T v="strong">{next}로 바꿀까요?</T>
        <T v="sub" c="ink2">
          폰은 PC 하나와만 이어져요. 바꾸면 {prev?.desktopName ?? '지금 PC'}와는 끊겨요.
        </T>
      </Frame>
    );
  }

  if (phase === 'done' && relink) return <RelinkDone onDone={onDone} />;

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
      <Frame
        sheet={relink}
        step={1}
        title={relink ? '다시 연결' : 'PC와 연결'}
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
      </Frame>
    );
  }

  return (
    <Frame sheet step={2} title={relink ? '다시 연결' : 'PC와 연결'} onBack={onboarding?.onBack ?? onDone} testID="pair-working">
      <StatusDot busy label="PC와 연결하는 중" />
    </Frame>
  );
}

type FrameProps = { sheet: boolean; step?: number; title?: string; onBack?: () => void; backLabel?: string; footer?: ReactNode; scroll?: boolean; testID?: string; children: ReactNode };

/** 처음 연결은 화면, 다시 연결은 지금 화면 위 바텀시트. 단계는 시트 하나 안에서 내용만 바뀐다. */
function Frame({ sheet, step, ...rest }: FrameProps) {
  if (!sheet) return <Screen {...rest} />;
  return <SheetFrame step={step} {...rest} />;
}

const RELINK_STEPS = 3;

function SheetFrame({ step = 1, title, onBack, footer, testID, children }: Omit<FrameProps, 'sheet'>) {
  const close = onBack ?? (() => undefined);
  return (
    <Sheet
      title={title ?? '다시 연결'}
      step={`${step}/${RELINK_STEPS}`}
      onClose={close}
      inline
      a11yClose="다시 연결 닫기"
      testID={testID}
      footer={footer}
    >
      {children}
    </Sheet>
  );
}

function RelinkDone({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    success();
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <SheetFrame step={3} title="다시 연결" testID="pair-done" footer={<Button label="확인" onPress={onDone} />}>
      <StatusDot tone="accent" label="다시 연결했어요" />
    </SheetFrame>
  );
}


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
  scannerFill: { flex: 1, aspectRatio: undefined, borderRadius: radius.lg },
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
