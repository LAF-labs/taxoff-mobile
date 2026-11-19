// 옆으로 밀어 치우기(iOS 알림 센터의 알림 지우기처럼). 좌우 어느 쪽이든.
// - 손가락이 닿아 있는 동안은 카드가 손가락과 1:1로 움직인다(애니메이션 없음).
// - 놓으면: 폭의 40%를 넘겼거나 빠르게 튕겼으면 그 방향으로 날려 보내고 높이를 접은 뒤 onDismiss.
//   아니면 스프링으로 빠르게 제자리. 날아가는 속도는 손가락 속도를 잇는다.
// - 세로 스크롤과 다투지 않게: 가로 움직임이 10px을 넘고 세로의 1.5배일 때만 잡는다.
// - 읽기 도구에는 "치우기" 동작으로 같은 일을 한다. 동작 줄이기면 밀어낸 뒤 바로 접는다.
import { useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from '../theme';
import { tap } from './kit';

const useNative = true;

export function SwipeAway({ children, onDismiss, label, testID }: { children: ReactNode; onDismiss: () => void; /** 읽기 도구용 이름 */ label: string; testID?: string }) {
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const h = useRef(new Animated.Value(1)).current;
  const width = useRef(1);
  // 접기 시작할 때만 높이를 고정한다(그 전에는 내용이 높이를 정한다)
  const [fixed, setFixed] = useState<number | null>(null);
  const measured = useRef(0);
  const gone = useRef(false);

  const collapse = () => {
    setFixed(measured.current);
    // 높이는 레이아웃 값이라 JS 쪽에서 접는다(짧게, 아래 카드가 자연스럽게 올라온다)
    Animated.timing(h, { toValue: 0, duration: reduce ? 0 : 180, useNativeDriver: false }).start(() => onDismiss());
  };
  const fling = (dir: 1 | -1, vx: number) => {
    gone.current = true;
    tap();
    if (reduce) {
      x.setValue(dir * width.current);
      collapse();
      return;
    }
    // 남은 거리를 손가락 속도로(최소 1.2px/ms) 가는 시간. 너무 느리거나 빠르지 않게 120~260ms
    const to = dir * width.current * 1.1;
    const left = Math.abs(to - (x as unknown as { __getValue: () => number }).__getValue());
    const duration = Math.min(260, Math.max(120, left / Math.max(Math.abs(vx), 1.2)));
    Animated.timing(x, { toValue: to, duration, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }).start(collapse);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !gone.current && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_, g) => !gone.current && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const far = Math.abs(g.dx) > width.current * 0.4;
        const quick = Math.abs(g.vx) > 0.5 && Math.sign(g.vx) === Math.sign(g.dx);
        if (far || quick) fling(g.dx >= 0 ? 1 : -1, g.vx);
        else Animated.spring(x, { toValue: 0, velocity: g.vx, stiffness: 400, damping: 34, useNativeDriver: useNative }).start();
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, stiffness: 400, damping: 34, useNativeDriver: useNative }).start(),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width || 1;
    measured.current = e.nativeEvent.layout.height;
  };
  // 멀리 밀수록 흐려진다(같은 값에서 나온다)
  const opacity = x.interpolate({ inputRange: [-400, -120, 0, 120, 400], outputRange: [0.2, 0.75, 1, 0.75, 0.2], extrapolate: 'clamp' });
  const wrapStyle = fixed === null ? null : { height: h.interpolate({ inputRange: [0, 1], outputRange: [0, fixed] }), opacity: h, overflow: 'hidden' as const };

  return (
    <Animated.View style={[st.clip, wrapStyle]}>
      <Animated.View
        testID={testID}
        onLayout={onLayout}
        accessible={false}
        accessibilityActions={[{ name: 'dismiss', label: `${label} 치우기` }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'dismiss' && fling(1, 0)}
        style={{ transform: [{ translateX: x }], opacity }}
        {...pan.panHandlers}
      >
        <View>{children}</View>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  clip: { overflow: 'visible' },
});
