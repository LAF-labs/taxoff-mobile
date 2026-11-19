// 첫 실행 온보딩(스플래시 직후, 열쇠 만들기 앞). 세 장: 편리함 · 할 수 있는 일 · 보안.
// - 옆으로 넘기거나 [다음]. 1·2장 오른쪽 위 [건너뛰기], 마지막 장도 [다음] → 열쇠 만들기(LockScreen firstRun, 그 화면의 [시작하기]).
// - 한 번 넘기면(건너뛰기·마지막 [다음]) 설치 표지에 적어 다시 보이지 않는다(App.tsx · keyring.markOnboarded).
// - 글은 모두 사실만: 보안 장의 각 줄은 코드에 있는 동작이다(키 ThisDeviceOnly·백업 제외, 릴레이는 내용을 못 봄,
//   승인은 매번 생체, 홈택스 비밀번호·인증서는 PC 금고). iPhone은 하드웨어 키 증명이 없어 "하드웨어"라고 쓰지 않는다.
// - 큰 글씨로 강조하지 않는다(design.md): 제목 17/600, 예쁨은 그림(실제 화면을 줄인 모형)과 움직임으로.
// - 3D 모션: 넘길 때 그림 면이 원근 속에서 돌고(rotateY·scale), 장 안의 겹은 저마다 깊이가 달라 따로 떠오르고(rotateX·스프링)
//   잔잔히 떠 있다(사인 반복). 모두 transform·opacity만 써서 네이티브 드라이버로 돈다(60fps). 동작 줄이기면 모두 멈춘 완성 상태.
import { useEffect, useRef, useState, type ComponentRef, type ReactElement } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View, useColorScheme, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import markDark from '../../assets/splash-icon-dark.png';
import markLight from '../../assets/splash-icon.png';
import { BRAND } from '../config';
import { motion, radius, space, usePalette, useReducedMotion, type Palette } from '../theme';
import { Button, Check, T } from '../ui/kit';

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

export function OnboardingScreen({ onDone, start = 0 }: { onDone: () => void; /** 갤러리: 몇 번째 장부터 그릴지 */ start?: number }) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [page, setPage] = useState(start);
  const x = useRef(new Animated.Value(0)).current;
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  // 스플래시에서 넘어올 때 툭 바뀌지 않게 살짝 떠오른다(동작 줄이기면 바로)
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: reduce ? 0 : motion.slow + 80, useNativeDriver: true }).start();
  }, [enter, reduce]);

  const onLayout = (e: LayoutChangeEvent) => {
    const nw = e.nativeEvent.layout.width;
    setH(e.nativeEvent.layout.height);
    if (nw === w) return;
    setW(nw);
    x.setValue(page * nw);
    requestAnimationFrame(() => list.current?.scrollTo({ x: page * nw, animated: false }));
  };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / w));
  };
  const last = page === ONBOARDING.length - 1;
  const next = () => {
    if (last) return onDone();
    const n = page + 1;
    setPage(n);
    list.current?.scrollTo({ x: n * w, animated: !reduce });
  };

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

      <Animated.View style={[st.fill, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]} onLayout={onLayout}>
        <Animated.ScrollView
          ref={list}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
          onMomentumScrollEnd={onEnd}
          onScrollEndDrag={onEnd}
          contentOffset={{ x: start * w, y: 0 }}
          testID="onboarding-pages"
        >
          {w > 0 &&
            ONBOARDING.map((pg, i) => (
              <View key={pg.key} style={{ width: w, height: h }} testID={`onboarding-${pg.key}`} accessibilityElementsHidden={i !== page} importantForAccessibility={i === page ? 'auto' : 'no-hide-descendants'}>
                <ScrollView contentContainerStyle={st.page} showsVerticalScrollIndicator={false}>
                  {/* 넘길 때 그림 면이 원근 속에서 돌아 들어온다(3D 넘김). 글보다 덜 움직여 깊이감이 난다. 동작 줄이기면 그대로 */}
                  <Animated.View
                    style={[
                      st.art,
                      { backgroundColor: p.tint },
                      !reduce && {
                        opacity: x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' }),
                        transform: [
                          { perspective: 1000 },
                          { translateX: x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [-w * 0.22, 0, w * 0.22] }) },
                          { rotateY: x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: ['-32deg', '0deg', '32deg'], extrapolate: 'clamp' }) },
                          { scale: x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [0.84, 1, 0.84], extrapolate: 'clamp' }) },
                        ],
                      },
                    ]}
                  >
                    <Glow p={p} active={i === page} reduce={reduce} />
                    <pg.Art p={p} active={i === page} reduce={reduce} />
                  </Animated.View>
                  <Animated.View
                    style={[
                      st.text,
                      !reduce && { opacity: x.interpolate({ inputRange: [(i - 0.6) * w, i * w, (i + 0.6) * w], outputRange: [0, 1, 0], extrapolate: 'clamp' }) },
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
            ))}
        </Animated.ScrollView>
      </Animated.View>

      <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4) }]}>
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

/** 지금 장 표시: 고른 점은 길게(ink), 나머지는 짧게(ink4). 넘기는 손가락을 따라 늘었다 줄어든다. */
function Dots({ x, w, n, page, reduce }: { x: Animated.Value; w: number; n: number; page: number; reduce: boolean }) {
  const p = usePalette();
  return (
    <View style={st.dots} accessible accessibilityRole="text" accessibilityLabel={`${n}장 중 ${page + 1}장`} testID="onboarding-dots">
      {Array.from({ length: n }, (_, i) => {
        const on = reduce || w === 0
          ? i === page ? 1 : 0
          : x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [0, 1, 0], extrapolate: 'clamp' });
        // 너비 대신 가로 늘림(scaleX): 넘기는 값이 네이티브에서 돌아 손가락을 바로 따른다
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

// ── 움직임 도구(모두 transform·opacity만, 네이티브 드라이버) ──

/** 장이 보이게 되면 0 → 1(스프링). 다른 장으로 가면 0으로 돌아가 다시 볼 때 또 등장한다. 동작 줄이기면 늘 1. */
function useEnter(active: boolean, reduce: boolean, delay = 0): Animated.Value {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return v.setValue(1);
    if (!active) {
      v.stopAnimation();
      v.setValue(0);
      return;
    }
    const a = Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, damping: 14, stiffness: 120, mass: 0.9, useNativeDriver: true })]);
    a.start();
    return () => a.stop();
  }, [active, reduce, delay, v]);
  return v;
}

/** 잔잔한 반복(0 ↔ 1, 사인 곡선). 떠 있는 카드·빛에 쓴다. 보이는 장에서만 돈다. */
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

function lerp(v: Animated.Value, a: number, b: number): Animated.AnimatedInterpolation<number>;
function lerp(v: Animated.Value, a: string, b: string): Animated.AnimatedInterpolation<string>;
function lerp(v: Animated.Value, a: number | string, b: number | string) {
  return v.interpolate({ inputRange: [0, 1], outputRange: [a, b] as never });
}

/** 떠 있는 겹의 그림자(그림 안에서만. 앱 화면의 카드에는 그림자를 쓰지 않는다) */
const lift = (p: Palette, dark: boolean, depth = 1) => ({
  shadowColor: dark ? '#000000' : p.ink,
  shadowOpacity: (dark ? 0.45 : 0.1) * depth,
  shadowRadius: 18 * depth,
  shadowOffset: { width: 0, height: 10 * depth },
  elevation: 4 * depth,
});

/** 그림 뒤 은은한 빛 두 개(천천히 떠돈다). 깊이감을 주는 맨 뒤 겹이다. */
function Glow({ p, active, reduce }: ArtProps) {
  const a = useFloat(active, reduce, 7000, 0);
  const b = useFloat(active, reduce, 9000, 0.6);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[st.glow, { backgroundColor: p.accentSoft, top: -60, right: -50, transform: [{ translateX: lerp(a, -10, 18) }, { translateY: lerp(a, 0, 22) }, { scale: lerp(b, 1, 1.12) }] }]} />
      <Animated.View style={[st.glow, st.glowSm, { backgroundColor: p.sunken, bottom: -50, left: -40, opacity: 0.7, transform: [{ translateX: lerp(b, 0, 16) }, { translateY: lerp(b, 8, -14) }] }]} />
    </View>
  );
}

interface ArtProps {
  p: Palette;
  active: boolean;
  reduce: boolean;
}

// ── 그림: 실제 화면을 줄인 모형(같은 면·같은 색 규칙). 겹마다 깊이가 달라 따로 떠오르고 떠 있다. ──

/** 1장: 내가 말하고 → PC가 홈택스에서 되읽은 카드 → [승인하고 발급](앱에서 유일한 파랑 채움, 그대로 보인다) */
function ChatArt({ p, active, reduce }: ArtProps) {
  const dark = useColorScheme() === 'dark';
  const e1 = useEnter(active, reduce, 60);
  const e2 = useEnter(active, reduce, 260);
  const e3 = useEnter(active, reduce, 520);
  const f1 = useFloat(active, reduce, 3800, 0);
  const f2 = useFloat(active, reduce, 4400, 0.5);
  const shine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || !active) return;
    shine.setValue(0);
    const a = Animated.loop(Animated.sequence([Animated.delay(1100), Animated.timing(shine, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }), Animated.delay(1600)]));
    a.start();
    return () => a.stop();
  }, [active, reduce, shine]);
  return (
    <View style={st.artInner} accessible accessibilityLabel="예: 동네마트에 32만원 세금계산서 발급해 달라고 말하면, PC가 만든 세금계산서를 폰에서 확인하고 승인해요">
      <Animated.View
        style={[
          st.bubble,
          { backgroundColor: p.canvas },
          lift(p, dark, 0.6),
          { opacity: e1, transform: [{ perspective: 800 }, { translateY: Animated.add(lerp(e1, 18, 0), lerp(f1, -3, 3)) }, { rotateX: lerp(e1, '35deg', '0deg') }, { translateX: lerp(f1, 0, -2) }] },
        ]}
      >
        <T v="sub">동네마트에 32만원 발급해 줘</T>
      </Animated.View>
      <Animated.View
        style={[
          st.mockCard,
          { backgroundColor: p.canvas },
          lift(p, dark, 1),
          {
            opacity: e2,
            transform: [
              { perspective: 900 },
              { translateY: Animated.add(lerp(e2, 34, 0), lerp(f2, 3, -4)) },
              { rotateX: Animated.add(lerp(e2, 22, 0), lerp(f2, 2, -2)).interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) },
              { rotateY: lerp(f2, '-2deg', '2deg') },
              { scale: lerp(e2, 0.92, 1) },
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
        <Animated.View style={[st.mockApprove, { backgroundColor: p.accent, opacity: e3, transform: [{ scale: lerp(e3, 0.9, 1) }] }]}>
          {/* 단추 위를 지나가는 빛 한 줄 */}
          <Animated.View
            pointerEvents="none"
            style={[st.shine, { transform: [{ translateX: lerp(shine, -120, 360) }, { rotate: '18deg' }], opacity: shine.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.35, 0.35, 0] }) }]}
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

/** 2장: 실제로 되는 일 넷. 줄이 차례로 위에서 뒤집히며 내려앉고, 그림 칸은 저마다 떠 있다. */
function FeatureArt({ p, active, reduce }: ArtProps) {
  return (
    <View style={[st.artInner, { gap: space.s2 }]}>
      {FEATURES.map((f, i) => (
        <FeatureRow key={f.glyph} f={f} i={i} p={p} active={active} reduce={reduce} />
      ))}
    </View>
  );
}

function FeatureRow({ f, i, p, active, reduce }: ArtProps & { f: (typeof FEATURES)[number]; i: number }) {
  const dark = useColorScheme() === 'dark';
  const e = useEnter(active, reduce, 80 + i * 110);
  const fl = useFloat(active, reduce, 3200 + i * 300, (i % 2) * 0.5);
  return (
    <Animated.View
      style={[
        st.feature,
        { backgroundColor: p.canvas },
        lift(p, dark, 0.45),
        { opacity: e, transform: [{ perspective: 700 }, { rotateX: lerp(e, '-75deg', '0deg') }, { translateY: lerp(e, -14, 0) }, { scale: lerp(e, 0.96, 1) }] },
      ]}
    >
      <Animated.View style={[st.glyphWrap, { backgroundColor: p.tint, transform: [{ translateY: lerp(fl, -2, 2) }, { rotate: lerp(fl, '-3deg', '3deg') }] }]}>
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

/** 3장: 자물쇠가 돌아 들어와 철컥 잠기고(고리가 내려앉음), 둘레로 잔잔한 물결. 사실 네 줄이 차례로 체크된다. */
function SafeArt({ p, active, reduce }: ArtProps) {
  const dark = useColorScheme() === 'dark';
  const spin = useEnter(active, reduce, 60);
  const shut = useEnter(active, reduce, 620);
  const fl = useFloat(active, reduce, 4200, 0);
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || !active) return;
    ring.setValue(0);
    const a = Animated.loop(Animated.sequence([Animated.delay(900), Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [active, reduce, ring]);
  return (
    <View style={[st.artInner, { gap: space.s3 }]}>
      <View style={st.lockStage} accessible={false}>
        <Animated.View style={[st.ring, { borderColor: p.ink4, opacity: lerp(ring, 0.5, 0), transform: [{ scale: lerp(ring, 0.7, 1.6) }] }]} />
        <Animated.View
          style={[
            st.lockWrap,
            {
              opacity: spin,
              transform: [{ perspective: 600 }, { translateY: lerp(fl, -3, 3) }, { rotateY: lerp(spin, '-200deg', '0deg') }, { rotateX: lerp(fl, '6deg', '-6deg') }, { scale: lerp(spin, 0.6, 1) }],
            },
          ]}
        >
          <Animated.View style={[st.shackle, { borderColor: p.ink, transform: [{ translateY: lerp(shut, -9, 0) }] }]} />
          <View style={[st.lockBody, { backgroundColor: p.ink }, lift(p, dark, 0.8)]}>
            <View style={[st.keyhole, { backgroundColor: p.tint }]} />
          </View>
        </Animated.View>
      </View>
      {SAFE.map((s, i) => (
        <SafeRow key={s.title} s={s} i={i} p={p} active={active} reduce={reduce} />
      ))}
    </View>
  );
}

function SafeRow({ s, i, p, active, reduce }: ArtProps & { s: (typeof SAFE)[number]; i: number }) {
  const e = useEnter(active, reduce, 820 + i * 140);
  return (
    <Animated.View style={[st.safeRow, { opacity: e, transform: [{ translateX: lerp(e, 14, 0) }] }]}>
      <Animated.View style={[st.checkWrap, { backgroundColor: p.canvas, transform: [{ scale: lerp(e, 0.4, 1) }, { rotate: lerp(e, '-90deg', '0deg') }] }]}>
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
      {[7, 12, 16].map((h) => (
        <View key={h} style={{ width: 4, height: h, borderRadius: 1, backgroundColor: c }} />
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
  art: { borderRadius: radius.xl, padding: space.s4, justifyContent: 'center', minHeight: 300, overflow: 'hidden' },
  glow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, opacity: 0.9 },
  glowSm: { width: 170, height: 170, borderRadius: 85 },
  artInner: { gap: space.s3 },
  text: { gap: space.s2, paddingHorizontal: space.s1 },
  bubble: { alignSelf: 'flex-end', borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s2 + 2, maxWidth: '85%' },
  mockCard: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  mockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mockTotal: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.s2 },
  mockApprove: { marginTop: space.s1, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shine: { position: 'absolute', left: 0, top: -20, width: 36, height: 90, backgroundColor: '#FFFFFF' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2 + 2, paddingHorizontal: space.s3, borderRadius: radius.lg },
  glyphWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  lockStage: { height: 72, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 2 },
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
