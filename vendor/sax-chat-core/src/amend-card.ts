import {
  AMEND_DATE,
  AMEND_FULL_CANCEL,
  AMEND_GROUPS,
  AMEND_GROUP_LABEL,
  AMEND_HINT,
  AMEND_LABEL,
  amendCurrent,
  amendEditAmount,
  amendNotice,
  amendPlan,
  amendStart,
  amendTitle,
  isAmendWhat,
  type AmendOriginal,
  type AmendPlan,
  type AmendValues,
  type AmendWhat,
} from './amend.ts';
import { won } from './fill.ts';

/**
 * 수정세금계산서 카드(ADR-058 결정 5)의 상태와 계산. PC(shell)와 폰이 같은 카드 상태를 쓴다. 카드 모양은 승인된 캔버스 "수정세금계산서 화면" PC 1~3이다.
 * 계산은 전부 chat-core amend.ts를 쓴다(엔진 startAmend와 같은 식). 이 모듈은 고른 계산서, 고른 사유, 고친 값을 들고 있다가 화면에 보일 값을 낸다.
 */

/** 말에서 읽은 수정 값. delta면 금액은 줄인 만큼(깎아 줌, 반품)이고, 아니면 고친 뒤의 값이다. */
export interface AmendSaid {
  issueDate?: string;
  supply?: number;
  tax?: number;
  item?: string;
  delta?: boolean;
}

/** 줄인 만큼을 말한 것(깎아 줌, 반품). "300만원으로 깎아 줬어"처럼 바뀐 뒤 값을 말하면 아니다. PC와 폰 대화가 같이 쓴다. */
const AMEND_DELTA_SAID = /깎|할인|덜\s*받|빼\s*줬|반품|돌려\s*받|환불/u;
const AMEND_AFTER_SAID = /(?:으로|로)\s*(?:깎|할인|줄|내리|낮추|바꾸|바뀌|바뀜|고쳐|정정|수정)/u;
export const amendSaidDelta = (text: string): boolean => AMEND_DELTA_SAID.test(text) && !AMEND_AFTER_SAID.test(text);

export interface AmendSource extends AmendOriginal {
  counterpartyId: string;
}

export interface AmendCard {
  originals: AmendSource[];
  pick: number | null;
  what: AmendWhat | null;
  values: AmendValues | null;
  /** 대화에서 읽은 값(사유를 고르면 미리 채운다). */
  said: AmendSaid;
  today: string;
  view: AmendView;
}

export type AmendField = 'issueDate' | 'counterpartBizNo' | 'item' | 'supply' | 'tax' | 'total';

export interface AmendView {
  title: string;
  /** 제목 앞 아이콘: pencil(고치기) 또는 cancel(전부 취소) */
  icon: 'pencil' | 'cancel';
  stage: 'which' | 'what' | 'values';
  which: Array<{ date: string; item: string; total: number }>;
  original: { date: string; total: number } | null;
  groups: Array<Array<{ what: AmendWhat; label: string; hint: string }>>;
  /** groups와 같은 순서의 묶음 이름 */
  groupLabels: readonly string[];
  label: string | null;
  /** 값 줄(사유를 고른 뒤). edit이 false면 글자로만 보인다. */
  rows: Array<{ field: 'issueDate' | 'counterpartBizNo' | 'item'; label: string; value: string; edit: boolean }>;
  amounts: Array<{ field: 'supply' | 'tax' | 'total'; label: string; before: number; after: number }> | null;
  notice: string | null;
  ready: boolean;
}

const MAX_ORIGINALS = 5;

const nameOf = (os: readonly AmendSource[]) => {
  const names = [...new Set(os.map((o) => o.counterpartName))];
  return names.length === 1 ? names[0]! : '';
};
const titleOf = (name: string, what: AmendWhat | null) => amendTitle(name, what).trim();

/** 사유를 고른 뒤 묻는 값(홈택스에서 사람이 넣는 것만, ADR-058 결정 5 표). */
const ASKS: Readonly<Record<AmendWhat, { rows: Array<'issueDate' | 'counterpartBizNo' | 'item'>; amounts: boolean }>> = {
  wrong_entry: { rows: ['issueDate', 'counterpartBizNo', 'item'], amounts: true },
  duplicate: { rows: ['issueDate'], amounts: false },
  local_lc: { rows: [], amounts: false },
  amount_changed: { rows: ['issueDate'], amounts: true },
  deal_cancelled: { rows: ['issueDate'], amounts: false },
  returned: { rows: ['issueDate'], amounts: true },
};
const ROW_LABEL = { issueDate: '작성일', counterpartBizNo: '거래처 번호', item: '품목' } as const;
const AMOUNT_LABEL = { supply: '공급가액', tax: '부가세', total: '합계' } as const;

export const bizNoText = (v: string) => (/^\d{10}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v);
export const mdText = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : d);

export function amendCardOriginal(card: Pick<AmendCard, 'originals' | 'pick'>): AmendSource | null {
  if (card.pick !== null) return card.originals[card.pick] ?? null;
  return card.originals.length === 1 ? card.originals[0]! : null;
}

export function amendCardPlan(card: AmendCard): AmendPlan | null {
  const o = amendCardOriginal(card);
  return o && card.what && card.values ? amendPlan(o, card.what, card.values, card.today) : null;
}

function viewOf(card: Omit<AmendCard, 'view'>): AmendView {
  const o = amendCardOriginal(card);
  const what = o ? card.what : null;
  const name = o ? o.counterpartName : nameOf(card.originals);
  const plan = o && what && card.values ? amendPlan(o, what, card.values, card.today) : null;
  const v = card.values;
  const ask = what ? ASKS[what] : null;
  return {
    title: titleOf(name, what),
    icon: what && AMEND_FULL_CANCEL.has(what) ? 'cancel' : 'pencil',
    stage: !o ? 'which' : !what ? 'what' : 'values',
    which: o ? [] : card.originals.map((x) => ({ date: x.issueDate, item: x.item, total: x.supply + x.tax })),
    original: o ? { date: o.issueDate, total: o.supply + o.tax } : null,
    groups: AMEND_GROUPS.map((g) => g.map((w) => ({ what: w, label: AMEND_LABEL[w], hint: AMEND_HINT[w] }))),
    groupLabels: AMEND_GROUP_LABEL,
    label: what ? AMEND_LABEL[what] : null,
    rows:
      ask && v && o
        ? ask.rows.map((f) => ({
            field: f,
            label: ROW_LABEL[f],
            value: f === 'issueDate' ? mdText(AMEND_DATE[what!] === 'original' ? o.issueDate : v.issueDate) : f === 'counterpartBizNo' ? bizNoText(v.counterpartBizNo) : v.item,
            edit: f !== 'issueDate' || AMEND_DATE[what!] !== 'original',
          }))
        : [],
    amounts:
      ask?.amounts && plan
        ? (['supply', 'tax', 'total'] as const).map((f) => ({ field: f, label: AMOUNT_LABEL[f], before: plan.before[f], after: plan.after[f] }))
        : null,
    notice: plan ? amendNotice(plan) : null,
    ready: !!plan?.ready,
  };
}

const withView = (c: Omit<AmendCard, 'view'>): AmendCard => ({ ...c, view: viewOf(c) });

/** 대화에서 찾은 당초분(최신이 앞)으로 카드를 만든다. 사유는 비워 둔다(결정 2: 사장님이 카드에서 고른다). */
export function amendCardNew(originals: readonly AmendSource[], said: AmendSaid, today: string): AmendCard {
  const os = originals.slice(0, MAX_ORIGINALS);
  if (!os.length) throw new Error('amend.not_amendable');
  return withView({ originals: os, pick: os.length === 1 ? 0 : null, what: null, values: null, said, today });
}

/**
 * 말에서 읽은 값을 고른 사유에 맞춘다. 줄인 만큼을 말했으면(깎아 줌, 반품) 금액 바뀜과 반품은 지금 남은 값에서 빼 "고친 뒤" 값으로 바꾸고,
 * 다른 사유는 금액을 미리 채우지 않는다(줄인 만큼은 고친 뒤 값이 아니다).
 */
function saidFor(o: AmendSource, what: AmendWhat, said: AmendSaid): Partial<AmendValues> {
  const { delta, ...v } = said;
  if (!delta || v.supply === undefined) return v;
  const { supply, tax, ...rest } = v;
  if (what !== 'amount_changed' && what !== 'returned') return rest;
  const cur = amendCurrent(o);
  const after = { supply: cur.supply - supply, tax: cur.tax - (tax ?? Math.floor(supply / 10)) };
  return after.supply >= 0 && after.tax >= 0 ? { ...rest, ...after } : rest;
}

/** 폰이 보낸 수정(사유와 고친 뒤 값)을 그대로 카드에 둔다(ADR-058 결정 8). 막는 것은 카드 계산과 엔진이 다시 본다. */
export function amendCardWith(card: AmendCard, what: AmendWhat, values: AmendValues, today: string = card.today): AmendCard {
  if (!amendCardOriginal(card)) throw new Error('bad_pick');
  return withView({ originals: card.originals, pick: card.pick, what, values: { ...values }, said: card.said, today });
}

const AMOUNT_WHATS: ReadonlySet<AmendWhat> = new Set(['wrong_entry', 'amount_changed', 'returned']);
/**
 * 사유를 (다시) 고른다. 새 사유의 기본값을 채우되, 앞 사유에서 사장님이 고친 날짜와 금액은 새 사유에도 그 칸이 있으면 그대로 둔다
 * (대표 2026-11-24: 사유를 잘못 골랐을 수 있으니 고른 뒤에도 바꿀 수 있어야 한다).
 */
function rewhat(o: AmendSource, card: Pick<AmendCard, 'what' | 'values' | 'said'>, what: AmendWhat, today: string): AmendValues {
  const fresh = amendStart(o, what, today, saidFor(o, what, card.said));
  const prevWhat = card.what;
  const prev = card.values;
  if (!prevWhat || !prev || prevWhat === what) return fresh;
  const was = amendStart(o, prevWhat, today, saidFor(o, prevWhat, card.said));
  const out = { ...fresh };
  if (prev.issueDate !== was.issueDate && AMEND_DATE[what] !== 'original') out.issueDate = prev.issueDate;
  if ((prev.supply !== was.supply || prev.tax !== was.tax) && AMOUNT_WHATS.has(prevWhat) && AMOUNT_WHATS.has(what)) {
    out.supply = prev.supply;
    out.tax = prev.tax;
  }
  return out;
}

/** 날이 바뀌었을 수 있을 때(준비 직전) 오늘만 새로 정해 다시 계산한다. 고친 값은 그대로다. */
export function amendCardToday(card: AmendCard, today: string): AmendCard {
  return withView({ originals: card.originals, pick: card.pick, what: card.what, values: card.values, said: card.said, today });
}

export type AmendPatch =
  | { pick: number }
  | { what: string }
  | { repick: true }
  | { field: AmendField; value: string | number };

/** 카드에서 누른 것 하나를 반영한다. 값이 맞지 않으면 bad_* 오류를 던지고 카드는 그대로다. */
export function amendCardUpdate(card: AmendCard, p: AmendPatch, today: string = card.today): AmendCard {
  const base = { originals: card.originals, pick: card.pick, what: card.what, values: card.values, said: card.said, today };
  if ('pick' in p) {
    if (!Number.isInteger(p.pick) || p.pick < 0 || p.pick >= card.originals.length) throw new Error('bad_pick');
    return withView({ ...base, pick: p.pick, what: null, values: null });
  }
  if ('repick' in p) return withView({ ...base, what: null, values: null });
  const o = amendCardOriginal(card);
  if (!o) throw new Error('bad_pick');
  if ('what' in p) {
    if (!isAmendWhat(p.what)) throw new Error('bad_what');
    return withView({ ...base, what: p.what, values: rewhat(o, card, p.what, today) });
  }
  if (!card.what || !card.values) throw new Error('bad_what');
  const v = card.values;
  const f = p.field;
  if (f === 'supply' || f === 'tax' || f === 'total') {
    const n = typeof p.value === 'number' ? p.value : NaN;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('bad_amount');
    return withView({ ...base, values: amendEditAmount(v, f, n) });
  }
  const s = String(p.value ?? '').trim();
  if (f === 'issueDate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || AMEND_DATE[card.what] === 'original') throw new Error('bad_issue_date');
    return withView({ ...base, values: { ...v, issueDate: s } });
  }
  if (card.what !== 'wrong_entry') throw new Error('bad_field');
  if (f === 'counterpartBizNo') {
    const d = s.replace(/\D/g, '');
    if (!/^\d{10}$/.test(d)) throw new Error('bad_bizno');
    return withView({ ...base, values: { ...v, counterpartBizNo: d } });
  }
  if (!s || s.length > 100) throw new Error('item_required');
  return withView({ ...base, values: { ...v, item: s } });
}

/** 발급 기록의 수정 상태 한 마디(ADR-058 결정 7): 취소됨, 고침, "550,000원 줄임". 금액 바뀜과 반품은 합친 차액이다. */
export function amendStateText(a: { cancelled: boolean; replaced: boolean; adjusted: { supply: number; tax: number } } | null | undefined): string | null {
  if (!a) return null;
  if (a.cancelled) return '취소됨';
  if (a.replaced) return '고침';
  const t = a.adjusted.supply + a.adjusted.tax;
  return t < 0 ? `${won(-t)} 줄임` : t > 0 ? `${won(t)} 늘림` : null;
}
