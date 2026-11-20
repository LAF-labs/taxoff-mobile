import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactElement, type ReactNode } from 'react';
import { Animated, Easing, Image, PanResponder, Pressable, ScrollView, StyleSheet, View, useColorScheme, type GestureResponderEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import markDark from '../../assets/splash-icon-dark.png';
import markLight from '../../assets/splash-icon.png';
import { BRAND } from '../config';
import { radius, space, usePalette, useReducedMotion, type Palette } from '../theme';
import { Button, Check, Chevron, T } from '../ui/kit';
import { FIRST_RUN_STEPS, StepDots } from '../ui/StepDots';

type Anim = Animated.Value | Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition;

interface ArtProps {
  p: Palette;
  active: boolean;
  reduce: boolean;
  at: (from: number, to: number) => Anim;
}

interface Page {
  key: string;
  title: string;
  body: string;
  Art: (props: ArtProps) => ReactElement;
}

const ONBOARDING: Page[] = [
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

export function OnboardingScreen({ onDone, start = 0, fromSplash = false, revealed = true }: { onDone: () => void; start?: number; fromSplash?: boolean; revealed?: boolean }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [page, setPage] = useState(start);
  const pageRef = useRef(start);
  const x = useRef(new Animated.Value(0)).current;
  const lead = useRef(new Animated.Value(reduce ? 0 : -1)).current;
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const cover = useRef(new Animated.Value(fromSplash && !reduce ? 1 : 0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const [coverGone, setCoverGone] = useState(!fromSplash || reduce);

  useEffect(() => {
    if (reduce) {
      lead.setValue(0);
      cover.setValue(0);
      setCoverGone(true);
      return;
    }
    if (w === 0 || !revealed) return;
    const out = Animated.parallel([
      Animated.timing(cover, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(lead, { toValue: 0, duration: 900, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    const a = fromSplash
      ? Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: SPLASH_BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: SPLASH_BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          out,
        ])
      : out;
    a.start(({ finished }) => finished && setCoverGone(true));
    return () => a.stop();
  }, [lead, cover, breath, reduce, w, fromSplash, revealed]);

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
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true }), [x]);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w > 0) go(Math.min(ONBOARDING.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / w))));
  };
  const last = page === ONBOARDING.length - 1;
  const touch = useRef<{ x: number; y: number; page: number } | null>(null);
  const onTouchStart = (e: GestureResponderEvent) => (touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, page: pageRef.current });
  const onTouchEnd = (e: GestureResponderEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t || t.page !== ONBOARDING.length - 1 || pageRef.current !== ONBOARDING.length - 1) return;
    const dx = e.nativeEvent.pageX - t.x;
    if (dx < -60 && Math.abs(e.nativeEvent.pageY - t.y) < Math.abs(dx)) onDone();
  };
  const next = () => {
    if (last) return onDone();
    const n = pageRef.current + 1;
    go(n);
    list.current?.scrollTo({ x: n * w, animated: !reduce });
  };

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
    <View style={[st.fill, { backgroundColor: p.canvas }]}>
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

      <View style={st.fill} onLayout={onLayout} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
                    {}
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
        <Dots x={x} w={w} n={FIRST_RUN_STEPS} page={page} reduce={reduce} />
        <Button testID="onboarding-next" label="다음" onPress={next} />
      </View>
    </SafeAreaView>
      {}
      {!coverGone && <SplashCover cover={cover} breath={breath} />}
    </View>
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

const SPLASH_BREATH_MS = 1500;

function SplashCover({ cover, breath }: { cover: Animated.Value; breath: Animated.Value }) {
  const p = usePalette();
  const dark = useColorScheme() === 'dark';
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.cover, { backgroundColor: p.canvas, opacity: cover }]} testID="splash-cover">
      <Animated.Image
        source={dark ? markDark : markLight}
        accessible={false}
        style={[
          st.splashMark,
          {
            opacity: cover.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.2, 1] }),
            transform: [{ scale: Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] }), cover.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0] })) }],
          },
        ]}
      />
    </Animated.View>
  );
}

export function OnboardingStep({
  step, onBack, onNext, art, title, body, action, testID,
}: { step: number; onBack?: () => void; onNext?: () => void; art: ReactNode; title: string; body: string; action: ReactNode; testID?: string }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const e = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    const a = Animated.timing(e, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [e, reduce]);
  const back = useRef(onBack);
  back.current = onBack;
  const fwd = useRef(onNext);
  fwd.current = onNext;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2 && (g.dx > 0 ? !!back.current : !!fwd.current),
        onPanResponderRelease: (_, g) => {
          if (g.dx > 60 || (g.dx > 20 && g.vx > 0.5)) back.current?.();
          else if (g.dx < -60 || (g.dx < -20 && g.vx < -0.5)) fwd.current?.();
        },
      }),
    [],
  );
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[st.fill, { backgroundColor: p.canvas }]} testID={testID} {...pan.panHandlers}>
      <View style={st.top}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s1, marginLeft: onBack ? -space.s3 : 0 }}>
          {onBack && (
            <Pressable testID="step-back" accessibilityRole="button" accessibilityLabel="뒤로" onPress={onBack} hitSlop={8} style={({ pressed }) => [st.backBtn, pressed && { backgroundColor: p.tint }]}>
              <Chevron dir="left" color={p.ink2} sizePx={10} />
            </Pressable>
          )}
          <BrandMark />
        </View>
        <View style={st.skip} />
      </View>
      <ScrollView contentContainerStyle={st.page} showsVerticalScrollIndicator={false}>
        <Animated.View
          style={[
            st.art,
            { backgroundColor: p.tint },
            !reduce && {
              opacity: lerp(e, 0.6, 1),
              transform: [{ perspective: 1000 }, { rotateY: lerp(e, '22deg', '0deg') }, { scale: lerp(e, 0.86, 1) }],
            },
          ]}
        >
          <Glow p={p} active reduce={reduce} />
          {art}
        </Animated.View>
        <Animated.View style={[st.text, !reduce && { opacity: lerp(e, 0.3, 1), transform: [{ translateY: lerp(e, 10, 0) }] }]}>
          <T v="title" role="header">
            {title}
          </T>
          <T v="sub" c="ink2">
            {body}
          </T>
        </Animated.View>
      </ScrollView>
      <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4), backgroundColor: p.canvas }]}>
        <StepDots index={step} />
        {action}
      </View>
    </SafeAreaView>
  );
}

export function StepHint({ children, testID }: { children: string; testID?: string }) {
  return (
    <View style={st.hint} testID={testID}>
      <T v="sub" c="ink3" center>
        {children}
      </T>
    </View>
  );
}

function Dots({ x, w, n, page, reduce }: { x: Animated.Value; w: number; n: number; page: number; reduce: boolean }) {
  const p = usePalette();
  return (
    <View style={st.dots} accessible accessibilityRole="text" accessibilityLabel={`${n}단계 중 ${page + 1}단계`} testID="onboarding-dots">
      {Array.from({ length: n }, (_, i) => {
        const on = i >= ONBOARDING.length ? 0 : reduce || w === 0 ? (i === page ? 1 : 0) : x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [0, 1, 0], extrapolate: 'clamp' });
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
          {}
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
  splashMark: { width: 96, height: 96 },
  cover: { alignItems: 'center', justifyContent: 'center' },
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
  backBtn: { width: 36, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  hint: { height: 52, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.s1, height: 6 },
  dotSlot: { width: 20, height: 6, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  dotOn: { width: 20 },
});
