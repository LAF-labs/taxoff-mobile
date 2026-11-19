// 첫 실행 온보딩(스플래시 직후, 열쇠 만들기 앞). 세 장: 편리함 · 할 수 있는 일 · 보안.
// - 옆으로 넘기거나 [다음]. 1·2장 오른쪽 위 [건너뛰기], 마지막 장도 [다음] → 열쇠 만들기(LockScreen firstRun, 그 화면의 [시작하기]).
// - 한 번 넘기면(건너뛰기·마지막 [다음]) 설치 표지에 적어 다시 보이지 않는다(App.tsx · keyring.markOnboarded).
// - 글은 모두 사실만: 보안 장의 각 줄은 코드에 있는 동작이다(키 ThisDeviceOnly·백업 제외, 릴레이는 내용을 못 봄,
//   승인은 매번 생체, 홈택스 비밀번호·인증서는 PC 금고). iPhone은 하드웨어 키 증명이 없어 "하드웨어"라고 쓰지 않는다.
// - 큰 글씨로 강조하지 않는다(design.md): 제목 17/600, 예쁨은 그림(실제 화면을 줄인 모형)과 움직임으로.
//
// 3D 모션(끊김·가려짐 없이):
// - 장 안의 모든 등장은 "넘기는 위치"(pos = 스크롤 x + 처음 등장용 lead)에 묶은 보간이다. 시간으로 따로 돌지 않으므로
//   넘기는 중에도 다음 장의 겹이 손가락을 따라 이미 들어오고 있다(빈 장이 보이지 않는다). 되돌리면 그대로 되감긴다.
//   [다음]은 scrollTo 애니메이션이라 같은 길을 탄다. 첫 장은 lead(-1 → 0)가 한 번 밀어 준다.
// - 모두 transform·opacity, 네이티브 드라이버. 매 프레임 JS 일 없음(장 번호는 반쯤 넘겼을 때 한 번만 바뀐다).
// - 움직이는 겹에는 그림자·잘라내기(overflow)를 두지 않는다(iOS가 매 프레임 화면 밖 렌더를 다시 해서 끊긴다).
//   깊이는 원근(perspective는 transform 맨 앞)·크기·흐림 정도와 은은한 경계선으로만 낸다.
// - 잔잔한 반복(떠 있기·빛·물결)은 지금 장에서만 돌고, 넘기면 멈춘다.
// - 동작 줄이기면 움직임 없이 완성 상태.
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactElement } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View, useColorScheme, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import markDark from '../../assets/splash-icon-dark.png';
import markLight from '../../assets/splash-icon.png';
import { BRAND } from '../config';
import { radius, space, usePalette, useReducedMotion, type Palette } from '../theme';
import { Button, Check, T } from '../ui/kit';

type Anim = Animated.Value | Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition;

interface ArtProps {
  p: Palette;
  /** 이 장이 지금 장인지(잔잔한 반복만 이것으로 켠다) */
  active: boolean;
  reduce: boolean;
  /** 이 장의 진행 0(옆) → 1(가운데)에 묶은 보간을 만든다. from·to는 0~1 구간(겹마다 늦게 들어오게) */
  at: (from: number, to: number) => Anim;
}

interface Page {
  key: string;
  title: string;
  body: string;
  Art: (props: ArtProps) => ReactElement;
}

export const ONBOARDING: Page[] = [
  {
    key: 'easy',
    title: '홈택스 일은 PC가, 사장님은 승인만',
    body: '말로 시키면 내 PC가 홈택스에 들어가 세금계산서를 만들어요. 사장님은 폰에서 확인하고 승인만 하면 돼요.',
    Art: ChatArt,
  },
  {
    key: 'what',
    title: '가게 일을 폰에서 바로',
    body: 'PC 앞에 앉지 않아도 돼요. PC가 꺼져 있을 때도 폰에서 물어볼 수 있어요.',
    Art: FeatureArt,
  },
  {
    key: 'safe',
    title: '내 정보는 내 PC와 내 폰에만',
    body: '중요한 것은 처음부터 밖으로 나가지 않게 만들었어요.',
    Art: SafeArt,
  },
];

const ONE = new Animated.Value(1);

export function OnboardingScreen({ onDone, start = 0 }: { onDone: () => void; /** 갤러리: 몇 번째 장부터 그릴지 */ start?: number }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [page, setPage] = useState(start);
  const pageRef = useRef(start);
  const x = useRef(new Animated.Value(0)).current;
  /** 처음 등장: -1 → 0. pos = x + lead·w 라서 첫 장도 넘겨 들어오는 것과 같은 길로 들어온다 */
  const lead = useRef(new Animated.Value(reduce ? 0 : -1)).current;
  const list = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (reduce || w === 0) return lead.setValue(0);
    const a = Animated.timing(lead, { toValue: 0, duration: 900, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [lead, reduce, w]);

  const pos = useMemo(() => Animated.add(x, Animated.multiply(lead, w || 1)), [x, lead, w]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: nw, height: nh } = e.nativeEvent.layout;
    if (nh !== h) setH(nh);
    if (nw === w) return;
    setW(nw);
    x.setValue(pageRef.current * nw);
    requestAnimationFrame(() => list.current?.scrollTo({ x: pageRef.current * nw, animated: false }));
  };
  const go = (n: number) => {
    if (n === pageRef.current) return;
    pageRef.current = n;
    setPage(n);
  };
  // 장 번호는 넘기기가 끝났을 때만 바꾼다(손가락이 움직이는 동안 다시 그리지 않는다: 등장은 위치에 묶여 있어 필요 없다)
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true }), [x]);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w > 0) go(Math.min(ONBOARDING.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / w))));
  };
  const last = page === ONBOARDING.length - 1;
  const next = () => {
    if (last) return onDone();
    const n = pageRef.current + 1;
    go(n);
    list.current?.scrollTo({ x: n * w, animated: !reduce });
  };

  /**
   * i번째 장의 진행: pos가 (i-1)w → iw 로 오면 0 → 1, iw → (i+1)w 로 떠나면 1 → 0. 겹마다 from·to로 늦게.
   * 같은 구간은 한 번만 만든다(다시 그릴 때 네이티브 보간 노드를 새로 잇지 않게).
   */
  const ats = useMemo(
    () =>
      ONBOARDING.map((_, i) => {
        const cache = new Map<string, Anim>();
        return (from: number, to: number): Anim => {
          if (reduce || w === 0) return ONE;
          const key = `${from}:${to}`;
          let v = cache.get(key);
          if (!v) {
            v = pos.interpolate({ inputRange: [(i - 1 + from) * w, (i - 1 + to) * w, (i + 1 - to) * w, (i + 1 - from) * w], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
            cache.set(key, v);
          }
          return v;
        };
      }),
    [pos, w, reduce],
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID="onboarding">
      <View style={st.top}>
        <BrandMark />
        {!last ? (
          <Pressable testID="onboarding-skip" accessibilityRole="button" accessibilityLabel="건너뛰기" onPress={onDone} hitSlop={8} style={({ pressed }) => [st.skip, pressed && { backgroundColor: p.tint }]}>
            <T v="subStrong" c="ink2">
              건너뛰기
            </T>
          </Pressable>
        ) : (
          <View style={st.skip} />
        )}
      </View>

      <View style={st.fill} onLayout={onLayout}>
        <Animated.ScrollView
          ref={list}
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={settle}
          onScrollEndDrag={settle}
          testID="onboarding-pages"
        >
          {w > 0 &&
            ONBOARDING.map((pg, i) => {
              const at = ats[i]!;
              const near = at(0, 1);
              const k = near as Animated.AnimatedInterpolation<number>;
              return (
                <View key={pg.key} style={{ width: w, height: h }} testID={`onboarding-${pg.key}`} accessibilityElementsHidden={i !== page} importantForAccessibility={i === page ? 'auto' : 'no-hide-descendants'}>
                  <ScrollView contentContainerStyle={st.page} showsVerticalScrollIndicator={false} scrollEnabled={h > 0 && h < 640}>
                    {/* 그림 면: 원근 속에서 돌아 들어온다. 안쪽(화면 가운데 쪽) 모서리가 뒤로 물러나게 돌려서 옆 장을 덮지 않는다. 옆 장도 흐리게만 */}
                    <Animated.View
                      renderToHardwareTextureAndroid
                      style={[
                        st.art,
                        { backgroundColor: p.tint },
                        !reduce && {
                          opacity: k.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                          transform: [
                            { perspective: 1000 },
                            { rotateY: pos.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: ['22deg', '0deg', '-22deg'], extrapolate: 'clamp' }) },
                            { scale: k.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] }) },
                          ],
                        },
                      ]}
                    >
                      <Glow p={p} active={i === page} reduce={reduce} />
                      <pg.Art p={p} active={i === page} reduce={reduce} at={at} />
                    </Animated.View>
                    <Animated.View
                      style={[
                        st.text,
                        !reduce && {
                          opacity: lerp(at(0.35, 1), 0.3, 1),
                          transform: [{ translateY: (at(0.35, 1) as Animated.AnimatedInterpolation<number>).interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
                        },
                      ]}
                    >
                      <T v="title" role="header">
                        {pg.title}
                      </T>
                      <T v="sub" c="ink2">
                        {pg.body}
                      </T>
                    </Animated.View>
                  </ScrollView>
                </View>
              );
            })}
        </Animated.ScrollView>
      </View>

      <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4), backgroundColor: p.canvas }]}>
        <Dots x={x} w={w} n={ONBOARDING.length} page={page} reduce={reduce} />
        <Button testID="onboarding-next" label="다음" onPress={next} />
      </View>
    </SafeAreaView>
  );
}

function BrandMark() {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={st.brand} accessible accessibilityRole="header" accessibilityLabel={BRAND}>
      <Image source={dark ? markDark : markLight} style={st.brandMark} accessible={false} />
      <T v="title">{BRAND}</T>
    </View>
  );
}

/** 지금 장 표시: 고른 점은 길게(ink), 나머지는 짧게(ink4). 넘기는 손가락을 따라 늘었다 줄어든다(scaleX, 네이티브). */
function Dots({ x, w, n, page, reduce }: { x: Animated.Value; w: number; n: number; page: number; reduce: boolean }) {
  const p = usePalette();
  return (
    <View style={st.dots} accessible accessibilityRole="text" accessibilityLabel={`${n}장 중 ${page + 1}장`} testID="onboarding-dots">
      {Array.from({ length: n }, (_, i) => {
        const on = reduce || w === 0 ? (i === page ? 1 : 0) : x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [0, 1, 0], extrapolate: 'clamp' });
        const scaleX = typeof on === 'number' ? (on ? 1 : 0.3) : on.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
        return (
          <View key={i} style={st.dotSlot}>
            <View style={[st.dot, { backgroundColor: p.ink4 }]} />
            <Animated.View style={[st.dot, st.dotOn, { backgroundColor: p.ink, opacity: on, transform: [{ scaleX }] }]} />
          </View>
        );
      })}
    </View>
  );
}

// ── 움직임 도구 ──

/** 잔잔한 반복(0 ↔ 1, 사인 곡선). 지금 장에서만 돌고 넘기면 멈춘다. 네이티브 드라이버. */
function useFloat(active: boolean, reduce: boolean, period = 3600, phase = 0): Animated.Value {
  const v = useRef(new Animated.Value(phase)).current;
  useEffect(() => {
    if (reduce || !active) return;
    const half = { duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, ...half }), Animated.timing(v, { toValue: 0, ...half })]));
    a.start();
    return () => a.stop();
  }, [active, reduce, period, v]);
  return v;
}

function lerp(v: Anim, a: number, b: number): Animated.AnimatedInterpolation<number>;
function lerp(v: Anim, a: string, b: string): Animated.AnimatedInterpolation<string>;
function lerp(v: Anim, a: number | string, b: number | string) {
  return (v as Animated.Value).interpolate({ inputRange: [0, 1], outputRange: [a, b] as never });
}

/** 그림 뒤 은은한 빛 두 개(면 안쪽에 들어가는 크기라 잘라내기 없이). 지금 장에서만 천천히 떠돈다. */
function Glow({ p, active, reduce }: { p: Palette; active: boolean; reduce: boolean }) {
  const a = useFloat(active, reduce, 7000, 0);
  const b = useFloat(active, reduce, 9000, 0.6);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[st.glow, { backgroundColor: p.accentSoft, top: space.s3, right: space.s3, transform: [{ translateX: lerp(a, 0, -14) }, { translateY: lerp(a, 0, 12) }] }]} />
      <Animated.View style={[st.glow, st.glowSm, { backgroundColor: p.sunken, bottom: space.s3, left: space.s3, opacity: 0.55, transform: [{ translateX: lerp(b, 0, 12) }, { translateY: lerp(b, 0, -10) }] }]} />
    </View>
  );
}

// ── 그림: 실제 화면을 줄인 모형(같은 면·같은 색 규칙). 겹마다 들어오는 구간이 달라 깊이가 난다. ──

/** 1장: 내가 말하고 → PC가 홈택스에서 되읽은 카드 → [승인하고 발급](앱에서 유일한 파랑 채움, 그대로 보인다) */
function ChatArt({ p, active, reduce, at }: ArtProps) {
  const e1 = at(0.15, 0.7);
  const e2 = at(0.3, 0.9);
  const e3 = at(0.5, 1);
  const f = useFloat(active, reduce, 4200, 0);
  const shine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || !active) return;
    shine.setValue(0);
    const a = Animated.loop(Animated.sequence([Animated.delay(1400), Animated.timing(shine, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }), Animated.delay(1800)]));
    a.start();
    return () => a.stop();
  }, [active, reduce, shine]);
  return (
    <View style={st.artInner} accessible accessibilityLabel="예: 동네마트에 32만원 세금계산서 발급해 달라고 말하면, PC가 만든 세금계산서를 폰에서 확인하고 승인해요">
      <Animated.View
        style={[
          st.bubble,
          { backgroundColor: p.canvas, borderColor: p.line },
          { opacity: lerp(e1, 0.35, 1), transform: [{ perspective: 800 }, { translateY: Animated.add(lerp(e1, 22, 0), lerp(f, 0, -3)) }, { translateX: lerp(e1, 30, 0) }, { rotateX: lerp(e1, '40deg', '0deg') }] },
        ]}
      >
        <T v="sub">동네마트에 32만원 발급해 줘</T>
      </Animated.View>
      <Animated.View
        style={[
          st.mockCard,
          { backgroundColor: p.canvas, borderColor: p.line },
          {
            opacity: lerp(e2, 0.35, 1),
            transform: [
              { perspective: 900 },
              { translateY: Animated.add(lerp(e2, 40, 0), lerp(f, 0, 4)) },
              { rotateX: lerp(e2, '28deg', '0deg') },
              { rotateY: lerp(f, '0deg', '2deg') },
              { scale: lerp(e2, 0.9, 1) },
            ],
          },
        ]}
      >
        <T v="label" c="ink3">
          PC가 홈택스에서 다시 읽은 값
        </T>
        <View style={st.mockRow}>
          <T v="sub" c="ink2">
            동네마트 성수점
          </T>
          <T v="sub" c="ink2">
            생활용품
          </T>
        </View>
        <View style={[st.mockRow, st.mockTotal, { borderTopColor: p.line }]}>
          <T v="subStrong">합계</T>
          <T v="figure">352,000원</T>
        </View>
        <Animated.View style={[st.mockApprove, { backgroundColor: p.accent, opacity: lerp(e3, 0.4, 1), transform: [{ scale: lerp(e3, 0.88, 1) }] }]}>
          {/* 단추 안에서 커졌다 사라지는 빛(잘라내기 없이: 단추보다 작고 둥글다) */}
          <Animated.View
            pointerEvents="none"
            style={[st.shine, { opacity: shine.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.28, 0.28, 0] }), transform: [{ translateX: lerp(shine, -110, 110) }, { scaleX: 2.4 }] }]}
          />
          <T v="subStrong" style={{ color: p.onAccent }}>
            승인하고 발급
          </T>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const FEATURES: Array<{ title: string; sub: string; glyph: 'doc' | 'camera' | 'cash' | 'chart' }> = [
  { title: '세금계산서 발급·승인', sub: '말로 시키고, 확인하고, 승인해요', glyph: 'doc' },
  { title: '종이 증빙 찍어 보내기', sub: '영수증·종이 계산서를 찍으면 PC에 정리돼요', glyph: 'camera' },
  { title: '현금 매출 적기', sub: '그날그날 적어 두면 PC로 가요', glyph: 'cash' },
  { title: '받을 돈·낼 돈 보기', sub: '이번 달 돈 흐름을 한눈에', glyph: 'chart' },
];

/** 2장: 실제로 되는 일 넷. 넘기는 만큼 줄이 차례로 뒤집히며 내려앉는다. 그림 칸은 저마다 떠 있다. */
function FeatureArt({ p, active, reduce, at }: ArtProps) {
  return (
    <View style={[st.artInner, { gap: space.s2 }]}>
      {FEATURES.map((f, i) => (
        <FeatureRow key={f.glyph} f={f} i={i} p={p} active={active} reduce={reduce} at={at} />
      ))}
    </View>
  );
}

function FeatureRow({ f, i, p, active, reduce, at }: ArtProps & { f: (typeof FEATURES)[number]; i: number }) {
  const e = at(0.15 + i * 0.12, 0.6 + i * 0.12);
  const fl = useFloat(active, reduce, 3200 + i * 300, (i % 2) * 0.5);
  return (
    <Animated.View
      style={[
        st.feature,
        { backgroundColor: p.canvas, borderColor: p.line },
        { opacity: lerp(e, 0.35, 1), transform: [{ perspective: 700 }, { translateX: lerp(e, 40, 0) }, { rotateY: lerp(e, '-35deg', '0deg') }, { scale: lerp(e, 0.94, 1) }] },
      ]}
    >
      <Animated.View style={[st.glyphWrap, { backgroundColor: p.tint, transform: [{ translateY: lerp(fl, -2, 2) }] }]}>
        <Glyph kind={f.glyph} p={p} />
      </Animated.View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="subStrong">{f.title}</T>
        <T v="label" c="ink3" style={{ fontWeight: '400' }}>
          {f.sub}
        </T>
      </View>
    </Animated.View>
  );
}

const SAFE: Array<{ title: string; sub: string }> = [
  { title: '홈택스 비밀번호·인증서는 내 PC에만', sub: '폰이나 저희 서버로 보내지 않아요' },
  { title: '폰과 PC 사이는 잠가서 주고받아요', sub: '중간에서 전달하는 서버도 내용을 열어 볼 수 없어요' },
  { title: '발급 승인은 매번 얼굴·지문으로', sub: '승인 전에 PC가 홈택스에서 다시 읽은 값을 그대로 보여 줘요' },
  { title: '이 폰의 열쇠는 폰 밖으로 나가지 않아요', sub: '백업되지 않고, 폰을 잃어버리면 PC에서 끊을 수 있어요' },
];

/** 3장: 넘기는 만큼 자물쇠가 돌아 들어오고, 끝에서 고리가 내려앉아 잠긴다. 잠긴 뒤 둘레로 물결. 사실 네 줄이 차례로. */
function SafeArt({ p, active, reduce, at }: ArtProps) {
  const spin = at(0.1, 0.75);
  const shut = at(0.7, 1);
  const fl = useFloat(active, reduce, 4200, 0);
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || !active) return;
    ring.setValue(0);
    const a = Animated.loop(Animated.sequence([Animated.delay(700), Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [active, reduce, ring]);
  return (
    <View style={[st.artInner, { gap: space.s3 }]}>
      <View style={st.lockStage} accessible={false}>
        <Animated.View style={[st.ring, { borderColor: p.ink4, opacity: lerp(ring, 0.45, 0), transform: [{ scale: lerp(ring, 0.8, 1.5) }] }]} />
        <Animated.View
          style={[
            st.lockWrap,
            { opacity: lerp(spin, 0.3, 1), transform: [{ perspective: 600 }, { translateY: lerp(fl, -2, 2) }, { rotateY: lerp(spin, '-180deg', '0deg') }, { scale: lerp(spin, 0.7, 1) }] },
          ]}
        >
          <Animated.View style={[st.shackle, { borderColor: p.ink, transform: [{ translateY: lerp(shut, -8, 0) }] }]} />
          <View style={[st.lockBody, { backgroundColor: p.ink }]}>
            <View style={[st.keyhole, { backgroundColor: p.tint }]} />
          </View>
        </Animated.View>
      </View>
      {SAFE.map((s, i) => (
        <SafeRow key={s.title} s={s} e={at(0.35 + i * 0.1, 0.75 + i * 0.08)} p={p} />
      ))}
    </View>
  );
}

function SafeRow({ s, e, p }: { s: (typeof SAFE)[number]; e: Anim; p: Palette }) {
  return (
    <Animated.View style={[st.safeRow, { opacity: lerp(e, 0.35, 1), transform: [{ translateX: lerp(e, 24, 0) }] }]}>
      <Animated.View style={[st.checkWrap, { backgroundColor: p.canvas, transform: [{ scale: lerp(e, 0.5, 1) }, { rotate: lerp(e, '-90deg', '0deg') }] }]}>
        <Check color={p.ink} />
      </Animated.View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="subStrong">{s.title}</T>
        <T v="label" c="ink3" style={{ fontWeight: '400' }}>
          {s.sub}
        </T>
      </View>
    </Animated.View>
  );
}

/** 선과 면으로만 그린 작은 그림(아이콘 묶음 없이, design.md) */
function Glyph({ kind, p }: { kind: 'doc' | 'camera' | 'cash' | 'chart'; p: Palette }) {
  const c = p.ink2;
  if (kind === 'doc')
    return (
      <View style={{ width: 14, height: 18, borderWidth: 2, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 2, backgroundColor: c, marginBottom: 2 }} />
        <View style={{ width: 6, height: 2, backgroundColor: c }} />
      </View>
    );
  if (kind === 'camera')
    return (
      <View style={{ width: 20, height: 15, borderWidth: 2, borderColor: c, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 7, height: 7, borderWidth: 2, borderColor: c, borderRadius: 4 }} />
      </View>
    );
  if (kind === 'cash')
    return (
      <View style={{ width: 20, height: 13, borderWidth: 2, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />
      </View>
    );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 16 }}>
      {[7, 12, 16].map((hh) => (
        <View key={hh} style={{ width: 4, height: hh, borderRadius: 1, backgroundColor: c }} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  top: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.s5, paddingRight: space.s2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  brandMark: { width: 24, height: 24 },
  skip: { minWidth: 44, minHeight: 44, paddingHorizontal: space.s3, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  page: { flexGrow: 1, paddingHorizontal: space.s5, paddingTop: space.s3, paddingBottom: space.s4, gap: space.s6, justifyContent: 'center' },
  art: { borderRadius: radius.xl, padding: space.s4, justifyContent: 'center', minHeight: 300 },
  glow: { position: 'absolute', width: 150, height: 150, borderRadius: 75, opacity: 0.9 },
  glowSm: { width: 110, height: 110, borderRadius: 55 },
  artInner: { gap: space.s3 },
  text: { gap: space.s2, paddingHorizontal: space.s1 },
  bubble: { alignSelf: 'flex-end', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.s4, paddingVertical: space.s2 + 2, maxWidth: '85%' },
  mockCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.s4, gap: space.s2 },
  mockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mockTotal: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.s2 },
  mockApprove: { marginTop: space.s1, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  shine: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2 + 2, paddingHorizontal: space.s3, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  glyphWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  lockStage: { height: 72, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 2 },
  lockWrap: { alignItems: 'center' },
  shackle: { width: 26, height: 18, borderWidth: 4, borderBottomWidth: 0, borderTopLeftRadius: 13, borderTopRightRadius: 13, marginBottom: -1 },
  lockBody: { width: 40, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  keyhole: { width: 6, height: 10, borderRadius: 3 },
  safeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3 },
  checkWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  footer: { paddingHorizontal: space.s5, paddingTop: space.s3, gap: space.s4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.s1, height: 6 },
  dotSlot: { width: 20, height: 6, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  dotOn: { width: 20 },
});
