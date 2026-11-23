import { Asset } from 'expo-asset';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UNSURE_BELOW, parseBizReg, type BizRegFields, type BizRegKey } from '../capture/bizreg';
import { GUIDE_RATIO, fitEdge, guideCrop, guideRect } from '../capture/crop';
import { toRows } from '../capture/invoice';
import { ocrEngine } from '../capture/ocr';
import { PDF_LINE, pickPhoto } from '../capture/pick';
import { validBizNo } from '../capture/parser';
import { DEV_LOCAL, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '../config';
import { findByBizNo, type Counterparty } from '../issue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { deleteQuietly, sweepCaptureTemps } from '../storage/files';
import { radius, space, usePalette } from '../theme';
import { glueAddress } from '../ui/address';
import { Field } from '../ui/field';
import { Button, Group, Notice, Screen, StatusDot, T, tap } from '../ui/kit';
import sampleBizReg from '../../assets/dev/sample-bizreg.jpg';

interface Shot {
  uri: string;
  width: number;
  height: number;
}

export interface BizRegPreview {
  phase: 'camera' | 'confirm';
  denied?: boolean;
  fromAlbum?: boolean;
  err?: string;
  shot?: Shot;
  values?: BizRegFields & { email: string };
  conf?: Partial<Record<BizRegKey, number>>;
  poor?: boolean;
}

const EMPTY = { name: '', bizNo: '', ceo: '', address: '', bizType: '', item: '', email: '' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BizRegScreen({
  existing: given, onDone, onSaved, onUseExisting, preview,
}: {
  existing?: Counterparty[];
  onDone: () => void;
  onSaved: (cp: Counterparty) => void;
  onUseExisting: (cp: Counterparty) => void;
  preview?: BizRegPreview;
}) {
  const p = usePalette();
  const q = useQueue();
  const s = useSession();
  const existing = given ?? q.counterparties;
  const [realPerm, requestPerm] = useCameraPermissions();
  const perm = preview?.denied ? { granted: false, canAskAgain: false } : realPerm;
  const cam = useRef<CameraView>(null);
  const [view, setView] = useState<LayoutRectangle | null>(null);
  const [phase, setPhase] = useState<'camera' | 'reading' | 'confirm'>(preview?.phase ?? 'camera');
  const [shot, setShot] = useState<Shot | null>(preview?.shot ?? null);
  const [v, setV] = useState(preview?.values ?? EMPTY);
  const [conf, setConf] = useState<Partial<Record<BizRegKey, number>>>(preview?.conf ?? {});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [poor, setPoor] = useState(!!preview?.poor);
  const [err, setErr] = useState<string | null>(preview?.err ?? null);
  const [fromAlbum, setFromAlbum] = useState(!!preview?.fromAlbum);
  const [zoom, setZoom] = useState(false);
  const temp = useRef<string[]>([]);
  const gone = useRef(false);

  const cleanup = () => {
    for (const u of temp.current) deleteQuietly(u);
    temp.current = [];
  };
  const track = (uri: string) => {
    temp.current.push(uri);
    if (gone.current) cleanup();
  };
  useEffect(
    () => () => {
      gone.current = true;
      cleanup();
      sweepCaptureTemps();
    },
    [],
  );

  async function process(raw: { uri: string; width: number; height: number }, crop: boolean) {
    setPhase('reading');
    track(raw.uri);
    try {
      let ctx = ImageManipulator.manipulate(raw.uri);
      let w = raw.width;
      let h = raw.height;
      if (crop && view) {
        const c = guideCrop(raw, view, guideRect(view, GUIDE_RATIO.bizReg));
        ctx = ctx.crop(c);
        w = c.width;
        h = c.height;
      }
      const fit = fitEdge(w, h, PHOTO_MAX_EDGE);
      if (fit) ctx = ctx.resize(fit);
      const img = await ctx.renderAsync();
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
      track(out.uri);
      const lines = toRows(await ocrEngine().boxes(out.uri)).map((r) => r.text);
      const r = parseBizReg(lines);
      setV({ ...r.fields, email: '' });
      setConf(r.conf);
      setPoor(r.poor);
      setTouched(new Set());
      setShot({ uri: out.uri, width: out.width, height: out.height });
      setPhase('confirm');
    } catch {
      cleanup();
      setErr('사진을 읽지 못했어요. 다시 찍어 주세요.');
      setPhase('camera');
    }
  }

  async function album() {
    setErr(null);
    tap();
    try {
      const r = await pickPhoto();
      if (!r) return;
      if (r.kind === 'pdf') return setErr(PDF_LINE);
      setFromAlbum(true);
      await process(r, false);
    } catch {
      setErr('사진을 고르지 못했어요.');
    }
  }

  async function take() {
    setErr(null);
    setFromAlbum(false);
    tap();
    try {
      const r = await cam.current?.takePictureAsync({ quality: 0.92, exif: false, shutterSound: true });
      if (r) await process(r, true);
    } catch {
      setErr('사진을 찍지 못했어요.');
    }
  }

  async function devSample() {
    const a = Asset.fromModule(sampleBizReg);
    await a.downloadAsync();
    const src = new File(a.localUri!);
    const copy = new File(src.parentDirectory, `dev-bizreg-${Date.now()}.jpg`);
    src.copySync(copy);
    await process({ uri: copy.uri, width: a.width ?? 1140, height: a.height ?? 1608 }, false);
  }

  const retake = () => {
    cleanup();
    setShot(null);
    setPoor(false);
    setPhase('camera');
  };

  if (phase === 'confirm' && shot) {
    const set = (k: keyof typeof EMPTY) => (x: string) => {
      setV((o) => ({ ...o, [k]: x }));
      setTouched((t) => new Set(t).add(k));
    };
    const unsure = (k: BizRegKey) => !touched.has(k) && (conf[k] ?? 0) < UNSURE_BELOW;
    const digits = v.bizNo.replace(/\D/g, '');
    const badNo = digits.length > 0 && !(digits.length === 10 && validBizNo(digits));
    const dup = badNo ? null : findByBizNo(existing, v.bizNo);
    const badEmail = v.email !== '' && !EMAIL.test(v.email);
    const ready = !!v.name.trim() && digits.length === 10 && validBizNo(digits) && !badEmail;
    const save = () => {
      cleanup();
      const cp: Counterparty = {
        id: `cp-${Date.now()}`, name: v.name.trim(), bizNo: v.bizNo, issued: 0, ceo: v.ceo.trim() || undefined, address: v.address.trim() || undefined,
        bizType: v.bizType.trim() || undefined, item: v.item.trim() || undefined, email: v.email || undefined,
      };
      q.addCounterparty(cp, s.pc === 'online');
      onSaved(cp);
    };
    const notice = dup ? (
      <Notice testID="bizreg-dup">이미 있는 거래처예요: {dup.name}</Notice>
    ) : poor ? (
      <View style={{ gap: space.s2 }} testID="bizreg-poor">
        <Notice>사진이 흐리거나 어두워 글자를 잘 읽지 못했어요</Notice>
        <Button small kind="secondary" label="다시 찍기" onPress={retake} style={{ alignSelf: 'flex-start' }} />
      </View>
    ) : null;
    return (
      <Screen
        title="사업자등록증 확인"
        onBack={retake}
        backLabel="다시 찍기"
        testID="bizreg-confirm"
        footer={
          dup ? (
            <>
              <Button
                label="그 거래처로 쓰기"
                onPress={() => {
                  cleanup();
                  q.setPick(dup.id);
                  onUseExisting(dup);
                }}
                testID="bizreg-use-existing"
              />
              <Button kind="quiet" label="다시 찍기" onPress={retake} />
            </>
          ) : (
            <Button label="거래처로 저장" onPress={save} disabled={!ready} testID="bizreg-save" />
          )
        }
      >
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel="찍은 등록증 크게 보기" style={[st.preview, { backgroundColor: p.tint }]}>
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <View style={[st.zoomHint, { backgroundColor: p.cameraVeil }]}>
            <T v="label" c="onCamera">
              크게 보기
            </T>
          </View>
        </Pressable>
        {notice}
        <Group title="거래처" note="폰이 읽은 값이에요. 사진과 맞는지 봐 주세요.">
          <Field testID="bz-name" label="상호" value={v.name} onChange={set('name')} placeholder="상호" unsure={unsure('name')} multiline={v.name.length > 14} />
          <Field
            testID="bz-bizNo"
            label="사업자번호"
            mask="bizNo"
            value={v.bizNo}
            onChange={set('bizNo')}
            placeholder="000-00-00000"
            unsure={unsure('bizNo') && !badNo}
            error={badNo ? '번호가 맞지 않아요. 사진을 보고 고쳐 주세요' : null}
          />
          <Field testID="bz-ceo" label="대표자" value={v.ceo} onChange={set('ceo')} placeholder="대표자" unsure={unsure('ceo')} />
          <Field testID="bz-address" label="사업장 주소" value={v.address} onChange={set('address')} placeholder="주소" unsure={unsure('address')} multiline format={glueAddress} />
          <Field testID="bz-bizType" label="업태" value={v.bizType} onChange={set('bizType')} placeholder="업태" unsure={unsure('bizType')} />
          <Field testID="bz-item" label="종목" value={v.item} onChange={set('item')} placeholder="종목" unsure={unsure('item')} />
        </Group>
        <Group title="세금계산서 받을 곳" note={v.email ? undefined : '등록증에는 없어요. 적어 두면 발급할 때 바로 보내요.'}>
          <Field testID="bz-email" label="이메일" mask="email" value={v.email} onChange={set('email')} placeholder="tax@example.com" multiline={v.email.length > 24} error={badEmail ? '이메일 모양이 아니에요' : null} />
        </Group>
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }} testID="bizreg-privacy">
          {fromAlbum ? '사진은 PC에 보관하고 앨범 원본은 그대로 둬요' : '사진은 PC에 보관하고 이 폰에서는 지워요'}
        </T>

        <Modal visible={zoom} animationType="fade" onRequestClose={() => setZoom(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: p.camera }}>
            <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={{ flexGrow: 1 }}>
              <Image source={{ uri: shot.uri }} style={{ flex: 1, minHeight: 400 }} resizeMode="contain" accessibilityLabel="찍은 등록증" />
            </ScrollView>
            <View style={{ padding: space.s5 }}>
              <Button kind="secondary" label="닫기" onPress={() => setZoom(false)} />
            </View>
          </SafeAreaView>
        </Modal>
      </Screen>
    );
  }

  const g = view ? guideRect(view, GUIDE_RATIO.bizReg) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.camera }} testID="bizreg-camera">
      <View style={st.camTop}>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={() => {
            cleanup();
            onDone();
          }} hitSlop={8} style={st.camSide}>
          <T v="subStrong" c="onCamera">
            닫기
          </T>
        </Pressable>
        <View style={st.camSide} />
      </View>
      <T v="subStrong" c="onCamera" center style={{ paddingHorizontal: space.s5, paddingBottom: space.s2 }}>
        사업자등록증 전체가 보이게 찍어 주세요
      </T>
      <View style={{ flex: 1 }} onLayout={(e) => setView(e.nativeEvent.layout)}>
        {perm?.granted && !DEV_LOCAL ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" animateShutter />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1C1D1F' }]} />
        )}
        {g && (
          <View pointerEvents="none" style={[st.guide, { left: g.x, top: g.y, width: g.w, height: g.h }]}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <View key={c} style={[st.corner, st[c]]} />
            ))}
          </View>
        )}
        {phase === 'reading' && (
          <View style={[StyleSheet.absoluteFill, st.center, { backgroundColor: p.cameraVeil }]}>
            <StatusDot busy label="글자를 읽는 중" tone="quiet" />
          </View>
        )}
        {!perm?.granted && !DEV_LOCAL && (
          <View style={[StyleSheet.absoluteFill, st.center, { padding: space.s6, gap: space.s4 }]} testID="bizreg-perm">
            <View style={{ gap: space.s1 }}>
              <T v="subStrong" c="onCamera" center>
                등록증을 찍으려면 카메라가 필요해요
              </T>
              <T v="meta" c="onCamera" center style={{ opacity: 0.72 }}>
                사진은 사진 앱에 저장하지 않아요
              </T>
            </View>
            {perm && !perm.canAskAgain ? (
              <Button small kind="secondary" label="설정에서 허용" onPress={() => void Linking.openSettings()} testID="bizreg-open-settings" />
            ) : (
              <Button small kind="secondary" label="카메라 허용" onPress={() => void requestPerm()} testID="bizreg-ask-camera" />
            )}
          </View>
        )}
      </View>
      <View style={st.camBar}>
        {err && <Notice testID="bizreg-cam-err">{err}</Notice>}
        {DEV_LOCAL ? (
          <Button kind="secondary" label="개발: 견본 등록증으로 찍기" onPress={() => void devSample()} busy={phase === 'reading'} style={{ alignSelf: 'stretch' }} />
        ) : (
          <View style={st.shutterRow}>
            {}
            <Pressable testID="bizreg-album" accessibilityRole="button" accessibilityLabel="앨범에서 고르기" onPress={() => void album()} disabled={phase === 'reading'} style={({ pressed }) => [st.side, pressed && { opacity: 0.6 }]}>
              <T v="subStrong" c="onCamera">
                앨범
              </T>
            </Pressable>
            {perm?.granted ? (
              <Pressable
                testID="bizreg-shutter"
                accessibilityRole="button"
                accessibilityLabel="찍기"
                disabled={phase === 'reading'}
                onPress={() => void take()}
                style={st.shutter}
              >
                {({ pressed }) => <View style={[st.shutterIn, { transform: [{ scale: pressed ? 0.92 : 1 }] }]} />}
              </Pressable>
            ) : (
              <View style={st.shutterSpace} />
            )}
            <View style={st.side} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const CORNER = 28;
const st = StyleSheet.create({
  preview: { width: '100%', height: 150, borderRadius: radius.lg, overflow: 'hidden' },
  zoomHint: { position: 'absolute', right: space.s3, bottom: space.s3, borderRadius: 9999, paddingHorizontal: space.s3, paddingVertical: space.s1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  camTop: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s4 },
  camSide: { minWidth: 56, height: 44, justifyContent: 'center' },
  camBar: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s4, gap: space.s4, alignItems: 'center' },
  guide: { position: 'absolute' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  side: { width: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  shutterSpace: { width: 76, height: 76 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#FFFFFF' },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
});
