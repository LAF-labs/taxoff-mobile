import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, Keyboard, Platform, ScrollView, StyleSheet, TextInput } from 'react-native';
import type { ChatItem } from '../chat';
import { findByBizNo, orderedCounterparties, searchCounterparties, type Counterparty } from '../issue';
import { useCustomers } from '../customers';
import type { IssuePrefill } from '../queueStore';
import { space } from '../theme';
import { Actions } from '../ui/card';
import { BigInput, SearchField } from '../ui/form';
import { masked } from '../ui/mask';
import { Button, Group, Row, T, tap } from '../ui/kit';
import { Sheet } from '../ui/sheet';

export type IssueStep = 'cp' | 'name' | 'bizNo';

export interface IssueSheetPreview {
  step?: IssueStep;
  query?: string;
  name?: string;
  bizNo?: string;
  kb?: number;
  focus?: boolean;
}

export type IssuePick = { cp: Counterparty } | { cp: null; name: string; bizNo: string };

export function issueCard(pick: IssuePick, pre: IssuePrefill | null = null, now = Date.now()): ChatItem {
  const name = pick.cp ? pick.cp.name : pick.name;
  const bizNo = pick.cp ? pick.cp.bizNo ?? '' : pick.bizNo;
  const amount = pre?.amount ?? pick.cp?.lastSupply ?? 0;
  const id = `issue-${now}`;
  return {
    kind: 'msg', id, from: 'pc', via: 'phone', at: now,
    card: {
      title: `${name} 세금계산서`, rows: [],
      draft: {
        id, counterpartyId: pick.cp?.id ?? '', amount, vat: pre?.vat ?? 'separate', item: pre ? pre.item : pick.cp?.lastItem ?? null,
        phone: { name, bizNo, edit: amount <= 0, draftId: pre?.draftId },
      },
    },
  };
}

const ASK: Record<IssueStep, string> = {
  cp: '어디에 발급할까요?',
  name: '상호를 알려 주세요',
  bizNo: '사업자등록번호를 알려 주세요',
};

const subOf = (c: Counterparty) => c.bizNo || '등록번호 없음';

export function IssueSheet({ onClose, onPick, onCapture, counterparties: given, preview }: {
  onClose: () => void;
  onPick: (pick: IssuePick) => void;
  onCapture: () => void;
  counterparties?: Counterparty[];
  preview?: IssueSheetPreview;
}) {
  const customers = useCustomers();
  const all = useMemo(() => orderedCounterparties(given ?? customers.counterparties), [given, customers.counterparties]);

  const [step, setStep] = useState<IssueStep>(preview?.step ?? 'cp');
  const [q, setQ] = useState(preview?.query ?? '');
  const [name, setName] = useState(preview?.name ?? '');
  const [bizNo, setBizNo] = useState(preview?.bizNo ?? '');

  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const dir = useRef(1);
  const go = (to: IssueStep, back = false) => {
    dir.current = back ? -1 : 1;
    setStep(to);
  };
  const opened = useRef(false);
  useEffect(() => {
    const first = !opened.current;
    opened.current = true;
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    if (step === 'cp') {
      if (first && preview?.focus) setTimeout(() => search.current?.focus(), 400);
      else if (!first && preview?.kb === undefined) Keyboard.dismiss();
    } else if (preview?.kb === undefined || preview.kb > 0) setTimeout(() => input.current?.focus(), first ? 400 : 230);
  }, [step, slide]);

  const pick = (x: IssuePick) => {
    tap();
    Keyboard.dismiss();
    onPick(x);
  };
  const manual = () => {
    tap();
    const t = q.trim();
    const isName = t !== '' && !/^[\d-\s]+$/.test(t);
    setName(isName ? t : '');
    setBizNo(!isName && t.replace(/\D/g, '').length >= 3 ? masked('bizNo', t) : '');
    go('name');
  };
  const done = () => {
    const known = findByBizNo(all, bizNo);
    pick(known ? { cp: known } : { cp: null, name: name.trim(), bizNo });
  };
  const back = () => (step === 'bizNo' ? go('name', true) : step === 'name' ? go('cp', true) : onClose());

  const underline = (key: 'name' | 'bizNo', value: string, set: (v: string) => void, opts: { placeholder: string; pad?: boolean; max: number; onDone: () => void }) => (
    <BigInput ref={input} testID={`issue-sheet-${key}`} label={ASK[key]} value={value} onChange={set} placeholder={opts.placeholder} pad={opts.pad} maxLength={opts.max} returnKey={opts.pad ? undefined : 'next'} onSubmit={opts.onDone} />
  );

  let body: React.ReactNode;
  let primary: { label: string; on: boolean; go: () => void } | null = null;
  if (step === 'cp') {
    const found = q.trim() ? searchCounterparties(all, q) : all;
    body =
      all.length === 0 ? (
        <T v="sub" c="ink2" testID="issue-sheet-empty">
          아직 거래처가 없어요. 상호와 등록번호를 적으면 바로 쓸 수 있어요
        </T>
      ) : (
        <>
          <SearchField ref={search} testID="issue-sheet-search" value={q} onChange={setQ} placeholder="상호나 등록번호로 찾기" label="거래처 찾기" />
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" testID="issue-sheet-list">
            {found.length ? (
              <Group>
                {found.map((c) => (
                  <Row key={c.id} label={c.name} sub={subOf(c)} onPress={() => pick({ cp: c })} a11y={`${c.name}, ${subOf(c)}`} testID={`issue-sheet-cp-${c.id}`} />
                ))}
              </Group>
            ) : (
              <T v="sub" c="ink2" testID="issue-sheet-none">
                찾는 거래처가 없어요. 직접 입력해 주세요
              </T>
            )}
          </ScrollView>
        </>
      );
  } else if (step === 'name') {
    const on = name.trim().length > 0;
    body = underline('name', name, setName, { placeholder: '예: 동네마트', max: 60, onDone: () => on && go('bizNo') });
    primary = { label: '다음', on, go: () => go('bizNo') };
  } else {
    const on = bizNo.replace(/\D/g, '').length === 10;
    body = underline('bizNo', bizNo, (v) => setBizNo(masked('bizNo', v)), { placeholder: '000-00-00000', pad: true, max: 12, onDone: () => on && done() });
    primary = { label: '확인', on, go: done };
  }

  return (
    <Sheet
      title={step === 'cp' ? '어디에 발급할까요?' : '직접 입력'}
      step={step === 'cp' ? undefined : step === 'name' ? '1/2' : '2/2'}
      onBack={step !== 'cp' ? back : undefined}
      onClose={onClose}
      inline
      a11yClose="세금계산서 발급 닫기"
      testID="issue-sheet"
      footer={
        step === 'cp' ? (
          <Actions>
            <Button kind={all.length === 0 ? 'primary' : 'secondary'} label="직접 입력" onPress={manual} testID="issue-sheet-manual" />
            <Button kind="secondary" label="등록증 찍기" onPress={onCapture} testID="issue-sheet-capture" />
          </Actions>
        ) : (
          primary && <Button label={primary.label} onPress={primary.go} disabled={!primary.on} testID="issue-sheet-next" />
        )
      }
    >
      <Animated.View
        key={step}
        style={[
          st.body,
          { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 28 * dir.current] }) }] },
        ]}
      >
        {body}
      </Animated.View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  body: { flex: 1, minHeight: 0, gap: space.s3 },
});
