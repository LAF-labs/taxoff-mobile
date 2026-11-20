import { useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { usePalette, useReducedMotion } from '../theme';
import { tap } from './kit';

const PULL = 64;
const FIRE = 48;

export function SwipeReply({ children, onReply, enabled }: { children: ReactNode; onReply: () => void; enabled: boolean }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const on = useRef(enabled);
  on.current = enabled;
  const reply = useRef(onReply);
  reply.current = onReply;

  const back = () => Animated.spring(x, { toValue: 0, stiffness: 420, damping: 34, useNativeDriver: true }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => on.current && g.dx > 10 && g.dx > Math.abs(g.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_, g) => on.current && g.dx > 10 && g.dx > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        armed.current = false;
      },
      onPanResponderMove: (_, g) => {
        const d = Math.max(0, g.dx);
        x.setValue(d < PULL ? d : PULL + (d - PULL) * 0.2);
        if (!armed.current && d >= FIRE) {
          armed.current = true;
          tap();
        } else if (armed.current && d < FIRE) armed.current = false;
      },
      onPanResponderRelease: () => {
        if (armed.current) reply.current();
        armed.current = false;
        back();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        back();
      },
    }),
  ).current;

  const icon = x.interpolate({ inputRange: [0, FIRE * 0.5, FIRE], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  return (
    <View style={st.wrap}>
      <Animated.View pointerEvents="none" style={[st.icon, { opacity: icon, transform: [{ scale: reduce ? 1 : icon.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        <ReplyGlyph color={p.ink3} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

export function ReplyGlyph({ color }: { color: string }) {
  return (
    <View style={st.glyph}>
      <View style={[st.curve, { borderColor: color }]} />
      <View style={[st.head, { borderColor: color }]} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  icon: { position: 'absolute', left: 4, top: 0, bottom: 0, justifyContent: 'center' },
  glyph: { width: 18, height: 16 },
  curve: { position: 'absolute', left: 3, top: 4, width: 14, height: 11, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 8 },
  head: { position: 'absolute', left: 1, top: 0.5, width: 8, height: 8, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '45deg' }] },
});
