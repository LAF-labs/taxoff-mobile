import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PASS_CARRIERS, SIMPLE_APPS, simpleAppOf } from '../run';
import { draftOf, stepOk, stepsOf, toId, type SimpleDraft, type SimpleStep } from '../simpleAuth';
export { draftOf, type SimpleDraft, type SimpleStep } from '../simpleAuth';
import type { SimpleId } from '../storage/state';
import { radius, space, type as typeScale, usePalette } from '../theme';
import { josa } from '../ui/josa';
import { masked } from '../ui/mask';
import { Button, Check, Chevron, T, tap } from '../ui/kit';

const ASK: Record<Exclude<SimpleStep, 'confirm'>, string> = {
  app: '어느 앱으로 승인할까요?',
  carrier: '어느 통신사인가요?',
  name: '이름을 알려 주세요',
  birth: '생년월일을 알려 주세요',
  phone: '휴대폰 번호를 알려 주세요',
};

const ro = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 === 8 ? `${w}로` : `${w}${josa(w, '으로', '로').slice(w.length)}`;
};

const maskPhone = (p: string) => p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, (_, a: string, b: string, c: string) => `${a}-${'*'.repeat(b.length)}-${c}`);

export function SimpleAuthSheet({ remembered, failed, onSend, onClose, start }: {
  remembered?: SimpleId | null;
  failed?: boolean;
  onSend: (id: SimpleId) => void;
  onClose: () => void;
  start?: { step: SimpleStep; draft?: SimpleDraft };
}) {
  const p = usePalette();
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const known = remembered ? toId(draftOf(remembered)) : null;
  const [draft, setDraft] = useState<SimpleDraft>(start?.draft ?? draftOf(remembered));
  const [step, setStep] = useState<SimpleStep>(start?.step ?? (known && !failed ? 'confirm' : 'app'));
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const dir = useRef(1);
  const go = (to: SimpleStep, back = false) => {
    dir.current = back ? -1 : 1;
    setStep(to);
  };
  useEffect(() => {
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    if (step === 'name' || step === 'birth' || step === 'phone') setTimeout(() => input.current?.focus(), 230);
  }, [step, slide]);

  const order = stepsOf(draft);
  const idx = order.indexOf(step);
  const next = (d = draft) => {
    const o = stepsOf(d);
    const i = o.indexOf(step);
    if (i >= 0 && i < o.length - 1) return go(o[i + 1]!);
    const id = toId(d);
    if (id) onSend(id);
  };
  const back = () => (idx > 0 ? go(order[idx - 1]!, true) : known && step !== 'confirm' ? go('confirm', true) : onClose());

  const pick = (choices: ReadonlyArray<{ code: string; name: string }>, value: string, set: (code: string) => SimpleDraft, testPrefix: string) => (
    <View style={st.grid} accessibilityRole="radiogroup">
      {choices.map((c) => {
        const on = value === c.code;
        return (
          <Pressable
            key={c.code}
            onPress={() => {
              tap();
              const d = set(c.code);
              setDraft(d);
              next(d);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={c.name}
            testID={`${testPrefix}-${c.code}`}
            style={({ pressed }) => [st.choice, { borderColor: on ? p.ink : p.line, borderWidth: on ? 1.5 : 1, backgroundColor: p.canvas }, pressed && { opacity: 0.6 }]}
          >
            <T v={on ? 'subStrong' : 'sub'} lines={1}>
              {c.name}
            </T>
            {on && (
              <View style={st.check}>
                <Check color={p.ink} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  const field = (key: 'name' | 'birth' | 'phone') => (
    <View style={[st.input, { borderColor: p.ink }]}>
      <TextInput
        ref={input}
        testID={`simple-${key}`}
        value={draft[key]}
        onChangeText={(t) => setDraft({ ...draft, [key]: key === 'name' ? t : masked(key === 'birth' ? 'day' : 'phone', t) })}
        placeholder={key === 'name' ? '홍길동' : key === 'birth' ? '1990-01-01' : '010-1234-5678'}
        placeholderTextColor={p.ink4}
        keyboardType={key === 'name' ? 'default' : key === 'birth' ? 'number-pad' : 'phone-pad'}
        maxLength={key === 'name' ? 20 : key === 'birth' ? 10 : 13}
        autoComplete={key === 'name' ? 'name' : key === 'birth' ? 'birthdate-full' : 'tel'}
        returnKeyType="next"
        onSubmitEditing={() => stepOk(step, draft) && next()}
        accessibilityLabel={ASK[key]}
        style={[typeScale.title, { color: p.ink, paddingVertical: space.s3 }, { outlineStyle: 'none' } as object]}
      />
    </View>
  );

  const app = simpleAppOf(draft.provider);
  let body;
  let primary: { label: string; on: boolean; go: () => void } | null = null;
  if (step === 'confirm' && known) {
    const a = simpleAppOf(known.provider);
    body = (
      <View style={{ gap: space.s4 }}>
        <T v="title" role="header">
          {`${ro(a?.name ?? '인증 앱')} 승인 요청을 보낼까요?`}
        </T>
        <View style={[st.summary, { backgroundColor: p.tint }]}>
          <T v="sub">{known.name}</T>
          <T v="sub" c="ink2">
            {maskPhone(known.phone)}
          </T>
        </View>
      </View>
    );
    primary = { label: '승인 요청 보내기', on: true, go: () => onSend(known) };
  } else if (step === 'app') {
    body = (
      <>
        <T v="title" role="header">
          {ASK.app}
        </T>
        {failed && (
          <T v="sub" c="attention" testID="simple-failed">
            방금 요청은 보내지 못했어요. 다시 골라 주세요.
          </T>
        )}
        {pick(SIMPLE_APPS, draft.provider, (code) => ({ ...draft, provider: code, carrier: code === 'pass' ? draft.carrier : '' }), 'simple-app')}
      </>
    );
  } else if (step === 'carrier') {
    body = (
      <>
        <T v="title" role="header">
          {ASK.carrier}
        </T>
        {pick(PASS_CARRIERS, draft.carrier, (code) => ({ ...draft, carrier: code }), 'simple-carrier')}
      </>
    );
  } else if (step === 'name' || step === 'birth' || step === 'phone') {
    body = (
      <>
        <T v="title" role="header">
          {ASK[step]}
        </T>
        {field(step)}
        {step === 'phone' && (
          <T v="meta" c="ink3">
            {`${ro(app?.app ?? '인증 앱')} 승인 요청이 가요`}
          </T>
        )}
      </>
    );
    primary = { label: step === 'phone' ? '승인 요청 보내기' : '다음', on: stepOk(step, draft), go: () => next() };
  }

  return (
    <View style={StyleSheet.absoluteFill} testID="simple-sheet">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="간편인증 닫기" accessibilityRole="button" />
      {}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined} style={st.kav} pointerEvents="box-none">
      <View style={[st.sheet, { backgroundColor: p.canvas, height: Math.min(SHEET_H + Math.max(inset.bottom, space.s4), height * 0.9), paddingBottom: Math.max(inset.bottom, space.s4) }]} accessibilityViewIsModal>
        <View style={[st.grabber, { backgroundColor: p.sunken }]} />
        <View style={st.head}>
          <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={idx > 0 ? '이전 단계' : '닫기'} style={st.headBtn} testID="simple-back">
            {idx > 0 || (known && step !== 'confirm') ? <Chevron dir="left" color={p.ink2} sizePx={9} /> : <T v="meta" c="ink3">닫기</T>}
          </Pressable>
          <T v="meta" c="ink3" style={{ flex: 1, textAlign: 'center' }}>
            간편인증
          </T>
          <View style={[st.headBtn, { alignItems: 'flex-end' }]}>
            <T v="meta" c="ink3" testID="simple-progress">
              {idx >= 0 ? `${idx + 1}/${order.length}` : ''}
            </T>
          </View>
        </View>
        <Animated.View
          style={[
            st.body,
            { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 28 * dir.current] }) }] },
          ]}
          key={step}
        >
          {body}
        </Animated.View>
        {primary && (
          <View style={st.foot}>
            <Button label={primary.label} onPress={primary.go} disabled={!primary.on} testID="simple-next" />
            {step === 'confirm' && <Button kind="quiet" label="다른 정보로" onPress={() => go('app')} testID="simple-other" />}
          </View>
        )}
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const SHEET_H = 452;

const st = StyleSheet.create({
  kav: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.s2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: space.s2 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, minHeight: 44 },
  headBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: space.s5, paddingTop: space.s2, paddingBottom: space.s3, gap: space.s3 },
  foot: { paddingHorizontal: space.s5, gap: space.s1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  choice: { minHeight: 48, width: '31.5%', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: space.s2 },
  check: { position: 'absolute', top: 6, right: 8 },
  input: { borderBottomWidth: 1.5 },
  summary: { borderRadius: radius.lg, padding: space.s4, gap: space.s1 },
});
