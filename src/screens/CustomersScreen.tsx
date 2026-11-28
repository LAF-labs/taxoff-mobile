import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { BackHandler, Pressable, TextInput, View } from 'react-native';
import { byName, byRecent, findCustomer, searchCustomers, type Customer } from '../book';
import { validBizNo } from '../capture/parser';
import { useCustomers } from '../customers';
import { counterpartyOf, dayLabel } from '../net/pcCopy';
import type { Counterparty } from '../issue';
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { BigInput, FormField, SearchField } from '../ui/form';
import { Glyph } from '../ui/glyph';
import { Button, Empty, Group, Notice, Row, Screen, T, TextButton, success, won } from '../ui/kit';
import { masked } from '../ui/mask';
import { PickRows, Sheet } from '../ui/sheet';
import type { HomeRoute } from './HomeScreen';

/**
 * 거래처(2026-11-24 대표 승인 캔버스 "폰 거래처 화면 시안"). PC 장부가 원본이고, 폰에서 넣고 고친 것은 PC로 보낸다(tex ADR-066).
 * 목록(찾기, 최근 발급순이나 가나다순) → 자세히 → 수정. 추가는 높이 고정 시트에서 등록번호, 상호 두 단계.
 */
export interface CustomersPreview {
  view?: 'list' | 'detail' | 'edit';
  id?: string;
  query?: string;
  add?: { step: 'number' | 'name'; bizNo?: string; name?: string };
}

type Place = { at: 'list' } | { at: 'detail'; id: string; bizNo: string } | { at: 'edit'; id: string; bizNo: string };
type AddStart = { bizNo?: string; name?: string };

const RECENT = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (v: string) => v.replace(/\D/g, '');

export function CustomersScreen({ go, onIssue, preview }: { go: (to: HomeRoute) => void; onIssue: (cp: Counterparty) => void; preview?: CustomersPreview }) {
  const s = useSession();
  const q = useQueue();
  const customers = useCustomers();
  const [view, setView] = useState<Place>(() => {
    const c = preview?.id ? customers.list.find((x) => x.id === preview.id) : undefined;
    return c && preview?.view && preview.view !== 'list' ? { at: preview.view, id: c.id, bizNo: c.bizNo } : { at: 'list' };
  });
  const [add, setAdd] = useState<AddStart | null>(preview?.add ? { bizNo: preview.add.bizNo, name: preview.add.name } : null);
  const open = (c: Customer) => setView({ at: 'detail', id: c.id, bizNo: c.bizNo });
  // 화면 ID는 PC가 받으면 바뀐다(new-… → PC ID). 못 찾으면 등록번호로 다시 찾는다.
  const current = view.at === 'list' ? null : (customers.list.find((c) => c.id === view.id) ?? findCustomer(customers.list, view.bizNo));

  // 등록증 찍기로 넣은 거래처는 돌아오면 자세히로 연다.
  useEffect(() => {
    if (!q.pickId) return;
    const c = customers.list.find((x) => x.id === q.pickId);
    if (!c) return;
    q.clearPick();
    setAdd(null);
    open(c);
  }, [q.pickId, customers.list]);

  useEffect(() => {
    if (view.at === 'list') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setView(view.at === 'edit' ? { ...view, at: 'detail' } : { at: 'list' });
      return true;
    });
    return () => sub.remove();
  }, [view]);

  const sheet = add && (
    <AddSheet
      start={add}
      list={customers.list}
      preview={preview?.add}
      onClose={() => setAdd(null)}
      onOpen={(c) => {
        setAdd(null);
        open(c);
      }}
      onCapture={() => {
        setAdd(null);
        go('bizreg');
      }}
      onAdd={async (f) => {
        const id = await customers.add(f);
        if (!id) return false;
        setAdd(null);
        setView({ at: 'detail', id, bizNo: masked('bizNo', f.bizNo) });
        return true;
      }}
    />
  );

  if (view.at !== 'list' && current) {
    if (view.at === 'edit') {
      return (
        <EditView
          c={current}
          onBack={() => setView({ ...view, at: 'detail' })}
          onSave={async (f) => {
            const id = await customers.edit(current, f);
            if (!id) return false;
            setView({ at: 'detail', id, bizNo: current.bizNo });
            return true;
          }}
        />
      );
    }
    return (
      <DetailView
        c={current}
        issued={(s.data.pcCopy?.issued ?? []).filter((r) => !!current.ref && r.ref === current.ref)}
        canEdit={customers.paired}
        onBack={() => setView({ at: 'list' })}
        onEdit={() => setView({ ...view, at: 'edit' })}
        onIssue={() => onIssue(counterpartyOf(current))}
      />
    );
  }

  if (!customers.paired && customers.list.length === 0) {
    return (
      <Screen title="거래처" shell scroll={false} testID="customers">
        <Empty testID="customers-unpaired" title="먼저 이 폰을 PC와 연결해 주세요" action={<Button label="PC 연결하기" onPress={() => go('pair')} testID="customers-pair" />} />
      </Screen>
    );
  }
  if (customers.list.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <Screen title="거래처" shell scroll={false} testID="customers">
          <Empty testID="customers-empty" title="아직 거래처가 없어요" action={<Button label="거래처 추가" onPress={() => setAdd({})} testID="customers-add" />} />
        </Screen>
        {sheet}
      </View>
    );
  }
  return <ListView list={customers.list} query={preview?.query} onOpen={open} onAdd={setAdd} sheet={sheet} />;
}

type Sort = 'recent' | 'name';
const SORTS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: 'recent', label: '최근 발급순' },
  { value: 'name', label: '가나다순' },
];
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const firstSound = (s: string) => {
  const c = s.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)]! : (s[0] ?? '').toUpperCase();
};

function ListView({ list, query: q0 = '', onOpen, onAdd, sheet }: { list: Customer[]; query?: string; onOpen: (c: Customer) => void; onAdd: (a: AddStart) => void; sheet: ReactNode }) {
  const p = usePalette();
  const [query, setQuery] = useState(q0);
  const [sort, setSort] = useState<Sort>('recent');
  const [picking, setPicking] = useState(false);
  const found = useMemo(() => searchCustomers(list, query), [list, query]);
  const t = query.trim();
  const groups = useMemo(() => {
    if (sort === 'recent') return [{ label: `${list.length}곳`, items: byRecent(list) }];
    const out: Array<{ label: string; items: Customer[] }> = [];
    for (const c of byName(list)) {
      const g = firstSound(c.name);
      if (out.at(-1)?.label !== g) out.push({ label: g, items: [] });
      out.at(-1)!.items.push(c);
    }
    return out;
  }, [list, sort]);
  const row = (c: Customer, key: string, mark?: string) => (
    <Row
      key={key}
      label={c.name}
      sub={c.bizNo || undefined}
      mark={mark}
      value={c.state ? <T c="attention">{c.state === 'paused' ? '휴업' : '폐업'}</T> : c.last ? dayLabel(c.last.day) : undefined}
      onPress={() => onOpen(c)}
      testID={`customer-${key}`}
    />
  );
  const startAdd = () => {
    const isNo = /^[\d\s-]+$/.test(t);
    onAdd(isNo ? { bizNo: masked('bizNo', t) } : { name: t });
  };
  return (
    <View style={{ flex: 1 }}>
    <Screen title="거래처" shell gap={space.s2} testID="customers" cta={!t ? <Button label="거래처 추가" onPress={() => onAdd({})} testID="customers-add" /> : undefined}>
      <View style={{ flexDirection: 'row', gap: space.s2, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SearchField value={query} onChange={setQuery} placeholder="상호, 번호, 대표자로 찾기" label="거래처 찾기" testID="customers-search" />
        </View>
        {!t && <TextButton label={SORTS.find((o) => o.value === sort)!.label} onPress={() => setPicking(true)} testID="customers-sort" />}
      </View>
      {t ? (
        found.length ? (
          <>
            <Section label={`${found.length}곳`} />
            <Group testID="customers-found">{found.map((c) => row(c, `found-${c.id}`, t))}</Group>
          </>
        ) : (
          <>
            <Section label="찾는 거래처가 없어요" />
            <Group>
              <Row label={`${t} 추가`} icon={<Glyph kind="plus" color={p.ink2} />} onPress={startAdd} testID="customers-add-query" />
            </Group>
          </>
        )
      ) : (
        groups.map((g) => (
          <View key={g.label} style={{ gap: space.s2 }}>
            <Section label={g.label} />
            <Group testID="customers-all">{g.items.map((c) => row(c, c.id))}</Group>
          </View>
        ))
      )}
    </Screen>
    {sheet}
    {picking && (
      <Sheet title="정렬" height="fit" onClose={() => setPicking(false)} testID="customers-sort-sheet">
        <PickRows<Sort> groups={[{ items: SORTS }]} value={sort} onPick={(v) => (setSort(v), setPicking(false))} testID="customers-sort-rows" />
      </Sheet>
    )}
    </View>
  );
}

function Section({ label }: { label: string }) {
  return (
    <View style={{ paddingTop: space.s2, paddingBottom: space.s1, paddingHorizontal: space.s1 }}>
      <T v="label" c="ink3">
        {label}
      </T>
    </View>
  );
}

function DetailView({
  c, issued, canEdit, onBack, onEdit, onIssue,
}: { c: Customer; issued: Array<{ day: string; total: number | null }>; canEdit: boolean; onBack: () => void; onEdit: () => void; onIssue: () => void }) {
  const p = usePalette();
  const [more, setMore] = useState(false);
  const shown = more ? issued : issued.slice(0, RECENT);
  return (
    <Screen
      onBack={onBack}
      backLabel="거래처로 돌아가기"
      backText="거래처"
      right={canEdit ? <TextButton label="수정" onPress={onEdit} testID="customer-edit" /> : undefined}
      gap={space.s2}
      testID="customer-detail"
      cta={<Button label="세금계산서 발급" onPress={onIssue} testID="customer-issue" />}
    >
      <View style={{ paddingHorizontal: space.s1, paddingTop: space.s1, paddingBottom: space.s2 }}>
        <T v="heading" role="header" testID="customer-name">
          {c.name}
        </T>
      </View>
      {c.state && c.stateOn && (
        <View style={{ marginBottom: space.s2 }}>
          <Notice icon testID="customer-closed">
            {`${dayLabel(c.stateOn)}에 ${c.state === 'paused' ? '휴업' : '폐업'}한 곳으로 조회돼요`}
          </Notice>
        </View>
      )}
      <Group testID="customer-rows">
        {c.bizNo ? (
          <Row
            label="등록번호"
            value={c.bizNo}
            a11y={`등록번호 ${c.bizNo}`}
            accessory={
              <Pressable onPress={() => void Clipboard.setStringAsync(digits(c.bizNo)).then(success)} hitSlop={6} accessibilityRole="button" accessibilityLabel="등록번호 복사" style={{ width: 32, height: 32, marginRight: -space.s2, alignItems: 'center', justifyContent: 'center' }} testID="customer-copy">
                <Glyph kind="copy" color={p.ink3} />
              </Pressable>
            }
          />
        ) : null}
        {c.rep ? <Row label="대표자" value={c.rep} /> : null}
        {c.emailHint ? <Row label="받는 이메일" value={c.emailHint} /> : null}
        {c.item ? <Row label="품목" value={c.item} /> : null}
      </Group>
      {issued.length > 0 && (
        <>
          <View style={{ paddingTop: space.s4 - space.s2, paddingBottom: space.s1, paddingHorizontal: space.s1 }}>
            <T v="label" c="ink3">
              최근 발급
            </T>
          </View>
          <Group testID="customer-issued">
            {shown.map((r, i) => (
              <Row key={`${r.day}-${i}`} label={dayLabel(r.day)} value={r.total === null ? undefined : won(r.total)} valueInk="ink" />
            ))}
            {!more && issued.length > RECENT ? <Row label="모두 보기" value={`${issued.length}장`} onPress={() => setMore(true)} testID="customer-issued-all" /> : null}
          </Group>
        </>
      )}
    </Screen>
  );
}

function EditView({ c, onBack, onSave }: { c: Customer; onBack: () => void; onSave: (f: { name: string; rep: string; email: string; item: string }) => Promise<boolean> }) {
  const [name, setName] = useState(c.name);
  const [rep, setRep] = useState(c.rep ?? '');
  const [email, setEmail] = useState('');
  const [item, setItem] = useState(c.item ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const badEmail = email.trim() !== '' && !EMAIL.test(email.trim());
  const ready = name.trim().length > 0 && !badEmail;
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ name, rep, email, item });
    setBusy(false);
    if (!ok) setFailed(true);
  };
  return (
    <Screen
      title="수정"
      onBack={onBack}
      backLabel="수정 그만두기"
      backText={c.name}
      gap={space.s4}
      testID="customer-form"
      cta={<Button label="저장" onPress={() => void save()} disabled={!ready} busy={busy} testID="customer-save" />}
    >
      {failed && <Notice testID="customer-save-failed">폰에 저장하지 못했어요. 다시 눌러 주세요</Notice>}
      <FormField label="상호" value={name} onChange={setName} maxLength={60} autoCapitalize="words" testID="cf-name" />
      {c.bizNo ? <FormField label="등록번호" value={c.bizNo} locked testID="cf-bizNo" /> : null}
      <FormField label="대표자" value={rep} onChange={setRep} maxLength={30} testID="cf-rep" />
      <FormField label="받는 이메일" value={email} onChange={(v) => setEmail(masked('email', v))} placeholder={c.emailHint ?? '세금계산서를 받을 메일'} keyboardType="email-address" maxLength={100} testID="cf-email" />
      {badEmail && (
        <T v="sub" c="attention" testID="cf-email-bad">
          메일 주소가 맞지 않아요
        </T>
      )}
      <FormField label="품목" value={item} onChange={setItem} maxLength={60} returnKeyType="done" testID="cf-item" />
    </Screen>
  );
}

function AddSheet({
  start, list, preview, onClose, onOpen, onCapture, onAdd,
}: {
  start: AddStart; list: Customer[]; preview?: CustomersPreview['add']; onClose: () => void; onOpen: (c: Customer) => void; onCapture: () => void;
  onAdd: (f: { bizNo: string; name: string }) => Promise<boolean>;
}) {
  const p = usePalette();
  const [step, setStep] = useState<'number' | 'name'>(preview?.step ?? 'number');
  const [bizNo, setBizNo] = useState(start.bizNo ?? '');
  const [name, setName] = useState(start.name ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (preview) return;
    const t = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [step]);
  const d = digits(bizNo);
  const full = d.length === 10;
  const same = full ? findCustomer(list, bizNo) : null;
  const wrong = full && !validBizNo(d);
  const bad = wrong ? '번호가 맞지 않아요. 다시 봐 주세요' : same ? `${ro(same.name)} 이미 있어요` : null;
  const submit = async () => {
    setBusy(true);
    const ok = await onAdd({ bizNo, name });
    setBusy(false);
    if (!ok) setFailed(true);
  };
  if (step === 'number') {
    return (
      <Sheet
        title="거래처 추가"
        step="1/2"
        onClose={onClose}
        preview={!!preview}
        testID="customer-add"
        footer={
          same ? (
            <Button label={`${same.name} 열기`} onPress={() => onOpen(same)} testID="customer-add-open" />
          ) : (
            <Button label="다음" onPress={() => setStep('name')} disabled={!full || wrong} testID="customer-add-next" />
          )
        }
      >
        <BigInput
          ref={input}
          label="등록번호"
          value={bizNo}
          onChange={(v) => setBizNo(masked('bizNo', v))}
          placeholder="000-00-00000"
          pad
          maxLength={12}
          bad={bad}
          onSubmit={() => full && !wrong && !same && setStep('name')}
          testID="customer-add-bizNo"
        />
        <Group>
          <Row label="등록증 찍기" icon={<Glyph kind="camera" color={p.ink2} />} onPress={onCapture} testID="customer-add-capture" />
        </Group>
      </Sheet>
    );
  }
  return (
    <Sheet
      title="거래처 추가"
      step="2/2"
      onBack={() => setStep('number')}
      onClose={onClose}
      preview={!!preview}
      testID="customer-add"
      footer={<Button label="추가" onPress={() => void submit()} disabled={!name.trim()} busy={busy} testID="customer-add-save" />}
    >
      <BigInput ref={input} label="상호" value={name} onChange={setName} placeholder="예: 동네마트" maxLength={60} onSubmit={() => name.trim() && void submit()} bad={failed ? '폰에 저장하지 못했어요. 다시 눌러 주세요' : null} testID="customer-add-name" />
    </Sheet>
  );
}

/** '대한테크로', '가나식자재로', '한울로', '동산으로': 받침이 있으면(ㄹ 받침은 빼고) '으로'. */
function ro(word: string): string {
  const c = word.trim().slice(-1).charCodeAt(0);
  const fin = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  return word + (fin !== 0 && fin !== 8 ? '으로' : '로');
}
