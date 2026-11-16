// P-08 종이 증빙 촬영: 앱 안 카메라 → 안내 틀로 자르기 → 기기 안 OCR(글자 상자) → 규칙 파서 후보 → 사장님 확인 → 보관함 → PC로.
// 영수증과 종이 세금계산서·계산서 두 가지다. 찍기 전에 고르고(틀 비율이 다르다), 찍은 뒤 서식 이름을 보고 바로잡는다.
// 세금계산서는 칸 위치로 공급자·공급받는자·금액·품목을 읽고 검산한다(src/capture/invoice.ts). PC는 원본과 확인한 값을 꾸러미에 함께 넣는다.
// 갤러리 가져오기 없음, 카메라 롤 저장 없음(ADR-034 결정 9). 카메라·편집 임시 파일은 캐시에 생기며 봉인해 옮긴 뒤 바로 지운다.
// 사진·금액은 로그에 넣지 않는다.
import { Asset } from 'expo-asset';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeReceiptOffer, type PaperInvoice as WireInvoice, type ReceiptCandidates } from '@sax/remote';
import { toWire } from '../capture/invoice-wire';
import { DEV_LOCAL, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '../config';
import { GUIDE_RATIO, fitEdge, guideCrop, guideRect } from '../capture/crop';
import { blocking, checkInvoice, issueText, looksLikeInvoice, parsePaperInvoice, toRows, toV1Candidates } from '../capture/invoice';
import { FIELD_KEY, editInvoiceForm, emptyInvoiceForm, formFrom, invoiceOf, type InvoiceForm } from '../capture/invoice-form';
import { ocrEngine } from '../capture/ocr';
import { parseReceipt, validBizNo } from '../capture/parser';
import { useSession } from '../session';
import { deleteQuietly, sweepCaptureTemps } from '../storage/files';
import { radius, space, usePalette } from '../theme';
import { Field, masked } from '../ui/field';
import { Button, Group, Notice, Row, Screen, Seg, StatusDot, T, success, tap, warn, won } from '../ui/kit';
import sampleReceipt from '../../assets/dev/sample-receipt.jpg';

interface Shot {
  uri: string;
  width: number;
  height: number;
  capturedAt: number;
}

type Phase = 'camera' | 'reading' | 'confirm' | 'saving' | 'saved';
export type Mode = 'receipt' | 'invoice';

/** 화면 갤러리(gallery/)에서 확인 화면을 바로 그릴 때만 쓴다. 앱은 넘기지 않는다. */
export interface CapturePreview {
  phase: Phase;
  docMode: Mode;
  shot: Shot;
  inv?: InvoiceForm;
  conf?: Record<string, number>;
  receipt?: { amount: string; issuedOn: string; merchant: string; bizNo: string };
  electronicCopy?: boolean;
  switched?: boolean;
  tried?: boolean;
  engine?: 'ios_vision' | 'none';
  sent?: { title: string; value: string };
}

export { formFrom };

export function CaptureScreen({ onDone, preview }: { onDone: () => void; preview?: CapturePreview }) {
  const s = useSession();
  const p = usePalette();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [view, setView] = useState<LayoutRectangle | null>(null);
  const [mode, setMode] = useState<Mode>('receipt');
  const [phase, setPhase] = useState<Phase>(preview?.phase ?? 'camera');
  const [shot, setShot] = useState<Shot | null>(preview?.shot ?? null);
  const [engine, setEngine] = useState<'ios_vision' | 'none'>(preview?.engine ?? 'none');
  const [docMode, setDocMode] = useState<Mode>(preview?.docMode ?? 'receipt');
  const [f, setF] = useState(preview?.receipt ?? { amount: '', issuedOn: '', merchant: '', bizNo: '' });
  const [inv, setInv] = useState<InvoiceForm>(preview?.inv ?? emptyInvoiceForm());
  const [conf, setConf] = useState<Record<string, number>>(preview?.conf ?? {});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<{ electronicCopy: boolean; switched: boolean }>({ electronicCopy: !!preview?.electronicCopy, switched: !!preview?.switched });
  const [tried, setTried] = useState(!!preview?.tried);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [sent, setSent] = useState<{ title: string; value: string } | null>(preview?.sent ?? null);
  const temp = useRef<string[]>([]);
  const gone = useRef(false);

  const cleanup = () => {
    for (const u of temp.current) deleteQuietly(u);
    temp.current = [];
  };
  /** 임시 파일을 기록한다. 화면이 이미 내려갔으면(30초 잠금 등) 곧바로 지운다. */
  const track = (uri: string) => {
    temp.current.push(uri);
    if (gone.current) cleanup();
  };

  // 잠금·이동으로 화면이 내려가면 봉인 전 사진을 남기지 않는다(ADR-034 결정 9, 규칙 ②).
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
        const c = guideCrop(raw, view, guideRect(view, GUIDE_RATIO[mode]));
        ctx = ctx.crop(c);
        w = c.width;
        h = c.height;
      }
      const fit = fitEdge(w, h, PHOTO_MAX_EDGE);
      if (fit) ctx = ctx.resize(fit);
      const img = await ctx.renderAsync();
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
      track(out.uri);
      const ocr = ocrEngine();
      const boxes = await ocr.boxes(out.uri);
      const lines = toRows(boxes).map((r) => r.text);
      setEngine(ocr.id);
      // 찍기 전 고른 것과 서식 이름이 다르면 서식 이름을 따른다(세금계산서를 영수증으로 찍어도 바로잡는다)
      const kind = looksLikeInvoice(lines);
      const asInvoice = mode === 'invoice' || kind !== null;
      setDocMode(asInvoice ? 'invoice' : 'receipt');
      setMeta({ electronicCopy: false, switched: asInvoice !== (mode === 'invoice') });
      setTouched(new Set());
      setTried(false);
      if (asInvoice) {
        const r = parsePaperInvoice(boxes);
        setInv(r ? formFrom(r.invoice) : emptyInvoiceForm(kind ?? 'tax_invoice'));
        setConf(r?.invoice.fieldConfidence ?? {});
        setMeta((m) => ({ ...m, electronicCopy: !!r?.electronicCopy }));
      } else {
        const c = parseReceipt(lines);
        setF({ amount: c.amount ? masked('won', String(c.amount)) : '', issuedOn: c.issuedOn ?? '', merchant: c.merchant ?? '', bizNo: c.merchantBizNo ?? '' });
      }
      setShot({ uri: out.uri, width: out.width, height: out.height, capturedAt: Date.now() });
      setPhase('confirm');
    } catch {
      cleanup();
      setErr('사진을 처리하지 못했어요. 다시 찍어 주세요.');
      setPhase('camera');
    }
  }

  async function take() {
    setErr(null);
    tap();
    try {
      const r = await cam.current?.takePictureAsync({ quality: 0.92, exif: false, shutterSound: true });
      if (r) await process(r, true);
    } catch {
      setErr('사진을 찍지 못했어요.');
    }
  }

  /** 시뮬레이터 개발 빌드만: 카메라가 없어서 앱에 묶인 견본 영수증을 카메라 프레임 대신 쓴다(갤러리 아님). */
  async function devSample() {
    const a = Asset.fromModule(sampleReceipt);
    await a.downloadAsync();
    const src = new File(a.localUri!);
    const copy = new File(src.parentDirectory, `dev-shot-${Date.now()}.jpg`);
    src.copySync(copy);
    await process({ uri: copy.uri, width: a.width ?? 1200, height: a.height ?? 1800 }, false);
  }

  function receiptCandidates(): ReceiptCandidates | string {
    const c: ReceiptCandidates = {};
    const amt = f.amount.replace(/\D/g, '');
    if (amt) {
      const n = Number(amt);
      if (!Number.isSafeInteger(n) || n <= 0 || n > 100_000_000_000) return '금액을 숫자로 적어 주세요.';
      c.amount = n;
    }
    if (f.issuedOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.issuedOn) || Number.isNaN(Date.parse(`${f.issuedOn}T00:00:00Z`))) return '날짜는 2026-11-05처럼 적어 주세요.';
      c.issuedOn = f.issuedOn;
    }
    if (f.merchant.trim()) c.merchant = f.merchant.trim().slice(0, 80);
    if (f.bizNo) {
      const d = f.bizNo.replace(/\D/g, '');
      if (!validBizNo(d)) return '사업자번호가 맞지 않아요. 비워 두어도 돼요.';
      c.merchantBizNo = `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    }
    return c;
  }

  const invoice = useMemo(() => invoiceOf(inv, conf, touched), [inv, conf, touched]);
  const issues = useMemo(() => (docMode === 'invoice' ? checkInvoice(invoice) : []), [docMode, invoice]);
  const sumIssue = issues.find((i) => i.code === 'sum_mismatch') ?? null;
  const issueFor = (field: string) => {
    const i = issues.find((x) => x.field === field);
    // 합계 불일치·세액 10%는 바로, 빈 칸 문제는 [보내기]를 눌러 본 뒤에 보인다
    if (!i) return null;
    if (!tried && (i.code === 'amount_required' || i.code === 'direction_required' || i.code === 'required')) return null;
    return issueText(i);
  };

  /** photoOnly: 세금계산서 칸을 다 못 채웠을 때 사진과 v1 후보만 보낸다(PC·세무사가 사진에서 읽는다). */
  async function save(photoOnly = false) {
    if (!shot) return;
    let c: ReceiptCandidates | string;
    let paper: WireInvoice | undefined;
    if (docMode === 'invoice') {
      setTried(true);
      if (!photoOnly) {
        if (issues.some(blocking)) {
          warn();
          return setErr('표시한 칸을 확인해 주세요. 다 채우기 어려우면 사진만 보낼 수 있어요.');
        }
        const w = toWire(invoice);
        if (!w.ok) {
          warn();
          return setErr('표시한 칸을 확인해 주세요. 다 채우기 어려우면 사진만 보낼 수 있어요.');
        }
        paper = w.invoice;
      }
      c = toV1Candidates(invoice);
    } else c = receiptCandidates();
    if (typeof c === 'string') return setErr(c);
    setErr(null);
    setPhase('saving');
    let jpeg: Uint8Array | null = null;
    try {
      jpeg = await new File(shot.uri).bytes();
      const offer = makeReceiptOffer(jpeg, { capturedAt: shot.capturedAt, width: shot.width, height: shot.height, ocrEngine: engine, ownerConfirmed: true, candidates: c, paperInvoice: paper });
      await s.outbox.put({ kind: 'receipt', msgId: offer.msgId, offer, createdAt: Date.now(), attempts: 0 }, jpeg);
      cleanup();
      setShot(null);
      const rec = docMode === 'invoice'
        ? { kind: invoice.docKind, title: `${(invoice.direction === 'sales' ? invoice.buyer.name : invoice.supplier.name) ?? (invoice.docKind === 'invoice' ? '계산서' : '세금계산서')}`, amount: invoice.total }
        : { kind: 'receipt' as const, title: c.merchant ?? '영수증', amount: c.amount ?? null };
      await s.update((d) => ({ ...d, recent: [{ msgId: offer.msgId, at: Date.now(), state: 'pending' as const, ...rec }, ...d.recent].slice(0, 30) }));
      await s.refreshPending();
      setSent(
        docMode === 'invoice'
          ? { title: `${invoice.docKind === 'invoice' ? '계산서' : '세금계산서'} · ${invoice.direction === 'sales' ? '매출' : invoice.direction === 'purchase' ? '매입' : '사진만'}`, value: invoice.total !== null ? won(invoice.total) : '' }
          : { title: c.merchant ?? '영수증', value: c.amount ? won(c.amount) : '' },
      );
      success();
      setPhase('saved');
      void s.sync();
    } catch {
      setErr('사진을 보관하지 못했어요. 이 폰에 보호된 저장 공간이 없으면 보낼 수 없어요.');
      setPhase('confirm');
    } finally {
      // 보관에 실패해도 메모리의 평문 JPEG를 지운다
      jpeg?.fill(0);
    }
  }

  const close = () => {
    cleanup();
    onDone();
  };
  const retake = () => {
    cleanup();
    setShot(null);
    setErr(null);
    setPhase('camera');
  };

  /** 칸 바꾸기. 공급가액·세액을 고치면 사장님이 만지지 않은 합계를 따라 맞춘다. */
  const setI = (k: keyof InvoiceForm, v: InvoiceForm[keyof InvoiceForm]) => {
    setTouched((t) => new Set(t).add(k));
    setInv((cur) => editInvoiceForm(cur, k, v, touched));
  };
  const unsure = (k: string) => !touched.has(FIELD_KEY[k] ?? k) && (conf[k] ?? 0) < 0.8;

  if (phase === 'saved') {
    return (
      <Screen
        title="종이 증빙"
        testID="capture-saved"
        footer={
          <>
            <Button label="한 장 더 찍기" onPress={() => setPhase('camera')} />
            <Button kind="quiet" label="처음으로" onPress={close} />
          </>
        }
      >
        <View style={{ gap: space.s3 }}>
          <StatusDot tone={s.pc === 'online' ? 'accent' : 'quiet'} label={s.pc === 'online' ? 'PC로 보내는 중' : 'PC가 켜지면 받아요'} busy={s.syncing} />
          <T v="sub" c="ink2">
            사진은 이 폰의 보호된 공간에만 있고 사진 앱에는 없어요. PC가 받으면 이 폰에서 지워요. PC는 원본 사진과 확인한 값을 세무사 꾸러미에 함께 넣어요.
          </T>
        </View>
        {sent && (
          <Group>
            <Row label={sent.title} value={sent.value} valueInk="ink" />
          </Group>
        )}
      </Screen>
    );
  }

  if ((phase === 'confirm' || phase === 'saving') && shot) {
    const isInv = docMode === 'invoice';
    return (
      <Screen
        title={isInv ? (inv.docKind === 'invoice' ? '계산서 확인' : '세금계산서 확인') : '영수증 확인'}
        onBack={retake}
        backLabel="다시 찍기"
        testID="capture-confirm"
        footer={
          <>
            {err && <Notice testID="capture-error">{err}</Notice>}
            <Button testID="capture-send" label="PC로 보내기" onPress={() => void save()} busy={phase === 'saving'} />
            {isInv && tried && issues.some(blocking) && phase !== 'saving' && (
              <Button testID="capture-photo-only" kind="quiet" label="사진만 보내기" hint="읽은 칸 없이 원본 사진만 보내요. PC와 세무사가 사진에서 읽어요." onPress={() => void save(true)} />
            )}
          </>
        }
      >
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel="찍은 사진 크게 보기" style={[st.preview, { backgroundColor: p.tint }]}>
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <View style={[st.zoomHint, { backgroundColor: p.cameraVeil }]}>
            <T v="label" c="onCamera">
              크게 보기
            </T>
          </View>
        </Pressable>

        {meta.switched && (
          <Notice tone="quiet" testID="switched-note">
            {isInv ? '서식 이름을 보고 세금계산서로 읽었어요.' : '세금계산서 서식이 보이지 않아 영수증으로 읽었어요.'}
          </Notice>
        )}
        {isInv && meta.electronicCopy && (
          <Notice testID="electronic-copy">
            승인번호가 있는 전자세금계산서 출력물이에요. PC가 홈택스에서 이미 가져오니 꾸러미에 두 번 들어가지 않게 PC가 승인번호로 맞춰요.
          </Notice>
        )}
        {engine === 'none' && (
          <T v="meta" c="ink3">
            이 폰에서는 글자를 읽지 않아요. 비워 두면 PC가 사진에서 읽어요.
          </T>
        )}

        {isInv ? (
          <InvoiceFields inv={inv} setI={setI} unsure={unsure} issueFor={issueFor} sumFix={sumIssue && sumIssue.code === 'sum_mismatch' ? sumIssue.expected : null} />
        ) : (
          <Group note="폰이 읽은 값은 참고용이에요. PC가 사진을 다시 읽어 세무사 꾸러미에 넣어요.">
              <Field testID="field-amount" label="금액" mask="won" unit="원" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} placeholder="15,000" />
              <Field testID="field-issuedOn" label="날짜" mask="day" value={f.issuedOn} onChange={(v) => setF({ ...f, issuedOn: v })} placeholder="2026-11-05" />
              <Field testID="field-merchant" label="상호" value={f.merchant} onChange={(v) => setF({ ...f, merchant: v })} placeholder="가게 이름" />
              <Field testID="field-bizNo" label="사업자번호" mask="bizNo" value={f.bizNo} onChange={(v) => setF({ ...f, bizNo: v })} placeholder="000-00-00000" />
          </Group>
        )}

        <Modal visible={zoom} animationType="fade" onRequestClose={() => setZoom(false)} supportedOrientations={['portrait', 'landscape']}>
          <SafeAreaView style={{ flex: 1, backgroundColor: p.camera }}>
            <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
              <Image source={{ uri: shot.uri }} style={{ flex: 1, minHeight: 400 }} resizeMode="contain" accessibilityLabel="찍은 사진" />
            </ScrollView>
            <View style={st.zoomBar}>
              <Button kind="secondary" label="닫기" onPress={() => setZoom(false)} style={{ alignSelf: 'stretch' }} />
            </View>
          </SafeAreaView>
        </Modal>
      </Screen>
    );
  }

  const g = view ? guideRect(view, GUIDE_RATIO[mode]) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.camera }} testID="capture-camera">
      <View style={st.camTop}>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={close} hitSlop={8} style={st.camClose} testID="capture-close">
          <T v="subStrong" c="onCamera">
            닫기
          </T>
        </Pressable>
        <T v="subStrong" c="onCamera">
          {mode === 'invoice' ? '세금계산서를 틀에 맞춰 주세요' : '영수증을 틀에 맞춰 주세요'}
        </T>
        <View style={st.camClose} />
      </View>
      <View style={{ flex: 1 }} onLayout={(e) => setView(e.nativeEvent.layout)}>
        {perm?.granted && !DEV_LOCAL ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" animateShutter />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1C1D1F' }]} />
        )}
        {g && (
          <View pointerEvents="none" style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h }}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <View key={c} style={[st.corner, st[c]]} />
            ))}
          </View>
        )}
        {phase === 'reading' && (
          <View style={[StyleSheet.absoluteFill, st.center, { backgroundColor: p.cameraVeil }]} testID="capture-reading">
            <StatusDot busy label="글자를 읽는 중" tone="quiet" />
          </View>
        )}
        {!perm?.granted && !DEV_LOCAL && (
          <View style={[StyleSheet.absoluteFill, st.center, { padding: space.s6, gap: space.s4 }]}>
            <T v="sub" c="onCamera" center>
              종이 증빙을 찍으려면 카메라가 필요해요. 사진은 사진 앱에 저장하지 않아요.
            </T>
            <Button small kind="secondary" label="카메라 허용" onPress={() => void requestPerm()} />
          </View>
        )}
      </View>
      <View style={st.camBar}>
        {err && <Notice>{err}</Notice>}
        <View style={{ alignSelf: 'stretch' }}>
          <CamSeg value={mode} onChange={setMode} />
        </View>
        {DEV_LOCAL ? (
          <Button testID="dev-sample" kind="secondary" label="개발: 견본 영수증으로 찍기" onPress={() => void devSample()} busy={phase === 'reading'} style={{ alignSelf: 'stretch' }} />
        ) : (
          <Pressable
            testID="shutter"
            accessibilityRole="button"
            accessibilityLabel="찍기"
            disabled={!perm?.granted || phase === 'reading'}
            onPress={() => void take()}
            style={[st.shutter, { opacity: !perm?.granted ? 0.4 : 1 }]}
          >
            {({ pressed }) => <View style={[st.shutterIn, { transform: [{ scale: pressed ? 0.92 : 1 }] }]} />}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

/** 카메라 화면의 두 칸 전환(검정 바탕용) */
function CamSeg({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <View style={st.camSeg} accessibilityRole="radiogroup">
      {(
        [
          ['receipt', '영수증'],
          ['invoice', '세금계산서·계산서'],
        ] as const
      ).map(([k, l]) => (
        <Pressable
          key={k}
          testID={`mode-${k}`}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === k }}
          onPress={() => {
            tap();
            onChange(k);
          }}
          style={[st.camSegItem, value === k && { backgroundColor: '#FFFFFF' }]}
        >
          <T v="subStrong" style={{ color: value === k ? '#111112' : '#FFFFFFCC' }}>
            {l}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

function InvoiceFields({
  inv, setI, unsure, issueFor, sumFix,
}: { inv: InvoiceForm; setI: (k: keyof InvoiceForm, v: InvoiceForm[keyof InvoiceForm]) => void; unsure: (k: string) => boolean; issueFor: (field: string) => string | null; sumFix: number | null }) {
  const isTax = inv.docKind === 'tax_invoice';
  const dirErr = issueFor('direction');
  return (
    <>
      <View style={{ gap: space.s2 }}>
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          구분
        </T>
        <Seg
          testID="direction"
          value={inv.direction}
          onChange={(v) => setI('direction', v)}
          options={[
            { key: 'purchase', label: '받은 것 · 매입' },
            { key: 'sales', label: '발급한 것 · 매출' },
          ]}
        />
        {dirErr ? (
          <T v="meta" c="attention" style={{ paddingHorizontal: space.s1 }}>
            {dirErr}
          </T>
        ) : (
          unsure('direction') &&
          inv.direction && (
            <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
              {inv.direction === 'purchase' ? '‘공급받는자 보관용’이라 매입으로 골랐어요.' : '‘공급자 보관용’이라 매출로 골랐어요.'}
            </T>
          )
        )}
      </View>

      <Group title="금액">
          <Field testID="inv-writtenOn" label="작성일자" mask="day" value={inv.writtenOn} onChange={(v) => setI('writtenOn', v)} placeholder="2026-11-05" unsure={unsure('writtenOn')} error={issueFor('writtenOn')} />
          <Field testID="inv-supply" label="공급가액" mask="won" unit="원" value={inv.supply} onChange={(v) => setI('supply', v)} placeholder="0" unsure={unsure('supplyAmount')} error={issueFor('supplyAmount')} />
          {isTax && <Field testID="inv-vat" label="세액" mask="won" unit="원" value={inv.vat} onChange={(v) => setI('vat', v)} placeholder="0" unsure={unsure('vatAmount')} error={issueFor('vatAmount')} />}
          <Field
            testID="inv-total"
            label="합계금액"
            mask="won"
            unit="원"
            value={inv.total}
            onChange={(v) => setI('total', v)}
            placeholder="0"
            unsure={unsure('total')}
            error={issueFor('total')}
            fix={sumFix !== null ? { label: `${won(sumFix)}으로 맞추기`, value: masked('won', String(sumFix)) } : undefined}
          />
      </Group>

      <Group title="공급자">
          <Field testID="inv-supplierBiz" label="등록번호" mask="bizNo" value={inv.supplierBiz} onChange={(v) => setI('supplierBiz', v)} placeholder="000-00-00000" unsure={unsure('supplier.bizNo')} error={issueFor('supplier.bizNo')} />
          <Field testID="inv-supplierName" label="상호" value={inv.supplierName} onChange={(v) => setI('supplierName', v)} placeholder="상호(법인명)" unsure={unsure('supplier.name')} error={issueFor('supplier.name')} />
          <Field testID="inv-supplierCeo" label="성명" value={inv.supplierCeo} onChange={(v) => setI('supplierCeo', v)} placeholder="대표자" unsure={unsure('supplier.ceo')} />
      </Group>

      <Group title="공급받는자">
          <Field testID="inv-buyerBiz" label="등록번호" mask="bizNo" value={inv.buyerBiz} onChange={(v) => setI('buyerBiz', v)} placeholder="000-00-00000" unsure={unsure('buyer.bizNo')} error={issueFor('buyer.bizNo')} />
          <Field testID="inv-buyerName" label="상호" value={inv.buyerName} onChange={(v) => setI('buyerName', v)} placeholder="상호(법인명)" unsure={unsure('buyer.name')} error={issueFor('buyer.name')} />
      </Group>

      {inv.items.length > 0 && (
        <Group title={`품목 ${inv.items.length}개`} note="품목은 읽은 그대로 보내요. 고칠 게 있으면 PC에서 고쳐요.">
          {inv.items.map((it, i) => (
            <Row
              key={i}
              label={it.name}
              sub={[it.month && it.day ? `${it.month}/${it.day}` : null, it.spec, it.qty !== null && it.unitPrice !== null ? `${it.qty} × ${it.unitPrice.toLocaleString('ko-KR')}` : null].filter(Boolean).join(' · ') || undefined}
              value={won(it.supply)}
            />
          ))}
        </Group>
      )}

      <View style={{ gap: space.s2 }}>
        <T v="label" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          이 금액을
        </T>
        <Seg
          testID="receiptOrClaim"
          value={inv.receiptOrClaim}
          onChange={(v) => setI('receiptOrClaim', v)}
          options={[
            { key: 'receipt', label: '영수 함' },
            { key: 'claim', label: '청구 함' },
          ]}
        />
      </View>

      {(inv.bookNo || inv.serialNo) && (
        <T v="meta" c="ink3" style={{ paddingHorizontal: space.s1 }}>
          {[inv.bookNo && `책번호 ${inv.bookNo}`, inv.serialNo && `일련번호 ${inv.serialNo}`].filter(Boolean).join(' · ')}
        </T>
      )}
    </>
  );
}

const CORNER = 28;
const st = StyleSheet.create({
  preview: { width: '100%', height: 220, borderRadius: radius.lg, overflow: 'hidden' },
  zoomHint: { position: 'absolute', right: space.s3, bottom: space.s3, borderRadius: 9999, paddingHorizontal: space.s3, paddingVertical: space.s1 },
  zoomBar: { padding: space.s5 },
  center: { alignItems: 'center', justifyContent: 'center' },
  camTop: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s4 },
  camClose: { minWidth: 56, height: 44, justifyContent: 'center' },
  camBar: { paddingHorizontal: space.s5, paddingTop: space.s4, paddingBottom: space.s4, gap: space.s4, alignItems: 'center' },
  camSeg: { flexDirection: 'row', borderRadius: radius.md, padding: 3, backgroundColor: '#FFFFFF1F' },
  camSegItem: { flex: 1, minHeight: 38, borderRadius: radius.sm + 1, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#FFFFFF' },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
});
