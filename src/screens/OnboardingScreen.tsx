// 첫 실행 온보딩(스플래시 직후, 열쇠 만들기 앞). 세 장: 편리함 · 할 수 있는 일 · 보안.
// - 옆으로 넘기거나 [다음]. 1·2장 오른쪽 위 [건너뛰기], 마지막 장 [시작하기] → 열쇠 만들기(LockScreen firstRun).
// - 한 번 넘기면(건너뛰기·시작하기) 설치 표지에 적어 다시 보이지 않는다(App.tsx · keyring.markOnboarded).
// - 글은 모두 사실만: 보안 장의 각 줄은 코드에 있는 동작이다(키 ThisDeviceOnly·백업 제외, 릴레이는 내용을 못 봄,
//   승인은 매번 생체, 홈택스 비밀번호·인증서는 PC 금고). iPhone은 하드웨어 키 증명이 없어 "하드웨어"라고 쓰지 않는다.
// - 큰 글씨로 강조하지 않는다(design.md): 제목 17/600, 예쁨은 그림(실제 화면을 줄인 모형)과 여백으로.
import { useEffect, useRef, useState, type ComponentRef, type ReactElement } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View, useColorScheme, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
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
  Art: (props: { p: Palette }) => ReactElement;
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
                  {/* 그림은 넘길 때 글보다 조금 덜 움직인다(깊이감). 동작 줄이기면 그대로 */}
                  <Animated.View
                    style={[
                      st.art,
                      { backgroundColor: p.tint },
                      !reduce && { transform: [{ translateX: x.interpolate({ inputRange: [(i - 1) * w, i * w, (i + 1) * w], outputRange: [-w * 0.18, 0, w * 0.18] }) }] },
                    ]}
                  >
                    <pg.Art p={p} />
                  </Animated.View>
                  <View style={st.text}>
                    <T v="title" role="header">
                      {pg.title}
                    </T>
                    <T v="sub" c="ink2">
                      {pg.body}
                    </T>
                  </View>
                </ScrollView>
              </View>
            ))}
        </Animated.ScrollView>
      </Animated.View>

      <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, space.s4) }]}>
        <Dots x={x} w={w} n={ONBOARDING.length} page={page} reduce={reduce} />
        <Button testID="onboarding-next" label={last ? '시작하기' : '다음'} onPress={next} />
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

// ── 그림: 실제 화면을 줄인 모형(같은 면·같은 색 규칙) ──

/** 1장: 내가 말하고 → PC가 홈택스에서 되읽은 카드 → [승인하고 발급](앱에서 유일한 파랑 채움, 그대로 보인다) */
function ChatArt({ p }: { p: Palette }) {
  return (
    <View style={st.artInner} accessible accessibilityLabel="예: 동네마트에 32만원 세금계산서 발급해 달라고 말하면, PC가 만든 세금계산서를 폰에서 확인하고 승인해요">
      <View style={[st.bubble, { backgroundColor: p.canvas }]}>
        <T v="sub">동네마트에 32만원 발급해 줘</T>
      </View>
      <View style={[st.mockCard, { backgroundColor: p.canvas }]}>
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
        <View style={[st.mockApprove, { backgroundColor: p.accent }]}>
          <T v="subStrong" style={{ color: p.onAccent }}>
            승인하고 발급
          </T>
        </View>
      </View>
    </View>
  );
}

const FEATURES: Array<{ title: string; sub: string; glyph: 'doc' | 'camera' | 'cash' | 'chart' }> = [
  { title: '세금계산서 발급·승인', sub: '말로 시키고, 확인하고, 승인해요', glyph: 'doc' },
  { title: '종이 증빙 찍어 보내기', sub: '영수증·종이 계산서를 찍으면 PC에 정리돼요', glyph: 'camera' },
  { title: '현금 매출 적기', sub: '그날그날 적어 두면 PC로 가요', glyph: 'cash' },
  { title: '받을 돈·낼 돈 보기', sub: '이번 달 돈 흐름을 한눈에', glyph: 'chart' },
];

/** 2장: 실제로 되는 일 넷(홈 빠른 일·찍기·현금·돈 탭) */
function FeatureArt({ p }: { p: Palette }) {
  return (
    <View style={[st.artInner, { gap: 0 }]}>
      {FEATURES.map((f, i) => (
        <View key={f.glyph} style={[st.feature, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
          <View style={[st.glyphWrap, { backgroundColor: p.canvas }]}>
            <Glyph kind={f.glyph} p={p} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="subStrong">{f.title}</T>
            <T v="label" c="ink3" style={{ fontWeight: '400' }}>
              {f.sub}
            </T>
          </View>
        </View>
      ))}
    </View>
  );
}

const SAFE: Array<{ title: string; sub: string }> = [
  { title: '홈택스 비밀번호·인증서는 내 PC에만', sub: '폰이나 저희 서버로 보내지 않아요' },
  { title: '폰과 PC 사이는 잠가서 주고받아요', sub: '중간에서 전달하는 서버도 내용을 열어 볼 수 없어요' },
  { title: '발급 승인은 매번 얼굴·지문으로', sub: '승인 전에 PC가 홈택스에서 다시 읽은 값을 그대로 보여 줘요' },
  { title: '이 폰의 열쇠는 폰 밖으로 나가지 않아요', sub: '백업되지 않고, 폰을 잃어버리면 PC에서 끊을 수 있어요' },
];

/** 3장: 자물쇠 + 사실 네 줄 */
function SafeArt({ p }: { p: Palette }) {
  return (
    <View style={[st.artInner, { gap: space.s3 }]}>
      <View style={st.lockWrap} accessible={false}>
        <View style={[st.shackle, { borderColor: p.ink }]} />
        <View style={[st.lockBody, { backgroundColor: p.ink }]}>
          <View style={[st.keyhole, { backgroundColor: p.tint }]} />
        </View>
      </View>
      {SAFE.map((s) => (
        <View key={s.title} style={st.safeRow}>
          <View style={[st.checkWrap, { backgroundColor: p.canvas }]}>
            <Check color={p.ink} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="subStrong">{s.title}</T>
            <T v="label" c="ink3" style={{ fontWeight: '400' }}>
              {s.sub}
            </T>
          </View>
        </View>
      ))}
    </View>
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
  art: { borderRadius: radius.xl, padding: space.s4, justifyContent: 'center', minHeight: 300 },
  artInner: { gap: space.s3 },
  text: { gap: space.s2, paddingHorizontal: space.s1 },
  bubble: { alignSelf: 'flex-end', borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s2 + 2, maxWidth: '85%' },
  mockCard: { borderRadius: radius.lg, padding: space.s4, gap: space.s2 },
  mockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mockTotal: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.s2 },
  mockApprove: { marginTop: space.s1, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s3 },
  glyphWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  lockWrap: { alignSelf: 'center', alignItems: 'center', marginBottom: space.s1 },
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
