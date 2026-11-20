import { useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from '../theme';
import { tap } from './kit';

const useNative = true;

export function SwipeAway({ children, onDismiss, label, testID }: { children: ReactNode; onDismiss: () => void; label: string; testID?: string }) {
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const h = useRef(new Animated.Value(1)).current;
  const width = useRef(1);
  const [fixed, setFixed] = useState<number | null>(null);
  const measured = useRef(0);
  const gone = useRef(false);

  const collapse = () => {
    setFixed(measured.current);
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
