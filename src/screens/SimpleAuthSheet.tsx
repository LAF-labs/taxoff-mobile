import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, TextInput, View } from 'react-native';
import { PASS_CARRIERS, SIMPLE_APPS, simpleAppOf } from '../run';
import { draftOf, stepOk, stepsOf, toId, type SimpleDraft, type SimpleStep } from '../simpleAuth';
export { draftOf, type SimpleDraft, type SimpleStep } from '../simpleAuth';
import type { SimpleId } from '../storage/state';
import { space } from '../theme';
import { Actions, Kv, KvRow } from '../ui/card';
import { BigInput } from '../ui/form';
import { josa } from '../ui/josa';
import { masked } from '../ui/mask';
import { Button, T, tap } from '../ui/kit';
import { ChoiceGrid, Sheet } from '../ui/sheet';

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
    <ChoiceGrid
      choices={choices}
      value={value}
      testID={testPrefix}
      onPick={(code) => {
        tap();
        const d = set(code);
        setDraft(d);
        next(d);
      }}
    />
  );

  const field = (key: 'name' | 'birth' | 'phone') => (
    <BigInput
      ref={input}
      testID={`simple-${key}`}
      label={ASK[key]}
      value={draft[key]}
      onChange={(t) => setDraft({ ...draft, [key]: key === 'name' ? t : masked(key === 'birth' ? 'day' : 'phone', t) })}
      placeholder={key === 'name' ? '홍길동' : key === 'birth' ? '1990-01-01' : '010-1234-5678'}
      keyboardType={key === 'name' ? 'default' : key === 'birth' ? 'number-pad' : 'phone-pad'}
      maxLength={key === 'name' ? 20 : key === 'birth' ? 10 : 13}
      autoComplete={key === 'name' ? 'name' : key === 'birth' ? 'birthdate-full' : 'tel'}
      returnKey="next"
      onSubmit={() => stepOk(step, draft) && next()}
    />
  );

  const app = simpleAppOf(draft.provider);
  let body;
  let primary: { label: string; on: boolean; go: () => void } | null = null;
  if (step === 'confirm' && known) {
    const a = simpleAppOf(known.provider);
    body = (
      <View style={{ gap: space.s4 }}>
        <T v="ask" role="header">
          {`${ro(a?.name ?? '인증 앱')} 승인 요청을 보낼까요?`}
        </T>
        <Kv>
          <KvRow label="이름" value={known.name} />
          <KvRow label="휴대폰" value={maskPhone(known.phone)} />
        </Kv>
      </View>
    );
    primary = { label: '승인 요청 보내기', on: true, go: () => onSend(known) };
  } else if (step === 'app') {
    body = (
      <>
        <T v="ask" role="header">
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
        <T v="ask" role="header">
          {ASK.carrier}
        </T>
        {pick(PASS_CARRIERS, draft.carrier, (code) => ({ ...draft, carrier: code }), 'simple-carrier')}
      </>
    );
  } else if (step === 'name' || step === 'birth' || step === 'phone') {
    body = (
      <>
        {field(step)}
        {step === 'phone' && (
          <T v="sub" c="ink2">
            {`${ro(app?.app ?? '인증 앱')} 승인 요청이 가요`}
          </T>
        )}
      </>
    );
    primary = { label: step === 'phone' ? '승인 요청 보내기' : '다음', on: stepOk(step, draft), go: () => next() };
  }

  const canBack = idx > 0 || (!!known && step !== 'confirm');
  return (
    <Sheet
      title="간편인증"
      step={idx >= 0 ? `${idx + 1}/${order.length}` : undefined}
      onBack={canBack ? back : undefined}
      onClose={onClose}
      inline
      a11yClose="간편인증 닫기"
      testID="simple-sheet"
      footer={
        primary && (
          <Actions>
            <Button label={primary.label} onPress={primary.go} disabled={!primary.on} testID="simple-next" />
            {step === 'confirm' && <Button kind="secondary" label="다른 정보로" onPress={() => go('app')} testID="simple-other" />}
          </Actions>
        )
      }
    >
      <Animated.View
        style={[
          st.body,
          { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 28 * dir.current] }) }] },
        ]}
        key={step}
      >
        {body}
      </Animated.View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  body: { flex: 1, gap: space.s3 },
});
