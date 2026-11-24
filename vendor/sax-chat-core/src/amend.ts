import { issueDateRule } from './draft-extra.ts';
import { splitVat } from './fill.ts';

/**
 * 수정세금계산서(ADR-058). PC 카드, 폰 카드, 엔진 입력이 같은 계산을 쓴다.
 * 사유는 사장님이 카드에서 고른다(결정 2). 이 모듈은 고른 사유와 고친 값으로 나갈 장과 막을 일을 계산할 뿐 사유를 권하지 않는다.
 */
export type AmendWhat = 'wrong_entry' | 'duplicate' | 'local_lc' | 'amount_changed' | 'deal_cancelled' | 'returned';

/** 카드의 두 묶음(홈택스 사유 화면과 같은 순서). 위: 처음부터 틀린 것, 아래: 발급한 뒤에 달라진 것. */
export const AMEND_GROUPS: readonly (readonly AmendWhat[])[] = [
  ['wrong_entry', 'duplicate', 'local_lc'],
  ['amount_changed', 'deal_cancelled', 'returned'],
];
export const AMEND_WHATS: readonly AmendWhat[] = AMEND_GROUPS.flat();

export function isAmendWhat(v: unknown): v is AmendWhat {
  return typeof v === 'string' && (AMEND_WHATS as readonly string[]).includes(v);
}

/** 카드에 보이는 쉬운 말. 회계 말은 쓰지 않는다. */
export const AMEND_LABEL: Readonly<Record<AmendWhat, string>> = {
  wrong_entry: '잘못 적었어요',
  duplicate: '두 번 발급했어요',
  local_lc: '내국신용장이 나왔어요',
  amount_changed: '금액이 바뀌었어요',
  deal_cancelled: '거래가 취소됐어요',
  returned: '물건을 돌려받았어요',
};

/** 홈택스 수정발급 사유 이름. 플레이북이 고를 때만 쓰고 화면에는 내지 않는다. */
export const AMEND_HOMETAX: Readonly<Record<AmendWhat, string>> = {
  wrong_entry: '기재사항 착오 정정 등',
  duplicate: '착오에 의한 이중발급 등',
  local_lc: '내국신용장 등 사후 개설',
  amount_changed: '공급가액의 변동',
  deal_cancelled: '계약의 해제',
  returned: '환입',
};

/** 작성일자: original = 당초 작성일자, event = 사유가 생긴 날(카드에서 고친다). 잘못 적음은 새 계산서의 작성일을 고칠 수 있다. */
export const AMEND_DATE: Readonly<Record<AmendWhat, 'original' | 'event' | 'edit'>> = {
  wrong_entry: 'edit',
  duplicate: 'original',
  local_lc: 'original',
  amount_changed: 'event',
  deal_cancelled: 'event',
  returned: 'event',
};

/** 1차에 여는 사유. 내국신용장은 2차(결정 1)이고 그 전까지 "아직 못 해요"로 답한다. */
export const AMEND_READY: Readonly<Record<AmendWhat, boolean>> = {
  wrong_entry: true, duplicate: true, local_lc: false, amount_changed: true, deal_cancelled: true, returned: true,
};

/** 전부 취소하는 사유(한 원본에 한 번, 차단 키 full_cancel). */
export const AMEND_FULL_CANCEL: ReadonlySet<AmendWhat> = new Set(['duplicate', 'deal_cancelled']);

/** 원본 승인번호 하나에 한 번만 되는 사유의 차단 키. 금액 바뀜, 반품은 여러 번 된다(null). */
export function amendBlockKey(what: AmendWhat): 'full_cancel' | 'replace' | null {
  if (AMEND_FULL_CANCEL.has(what)) return 'full_cancel';
  return what === 'wrong_entry' ? 'replace' : null;
}

export interface AmendAmounts {
  supply: number;
  tax: number;
}

/** 고칠 대상(당초분). 장부나 사본에서 읽은 값이다. 승인번호는 모델에 가지 않는다. */
export interface AmendOriginal {
  approvalNo: string;
  /** 작성일자 YYYY-MM-DD */
  issueDate: string;
  /** 발급한 날 YYYY-MM-DD. 모르면 작성일자로 본다. */
  issuedOn?: string | null;
  counterpartBizNo: string;
  counterpartName: string;
  item: string;
  supply: number;
  tax: number;
  /** 이 원본에 이미 나간 금액 바뀜, 반품 수정분의 합(음수일 수 있다). */
  adjusted?: AmendAmounts | null;
  /** 이미 전부 취소됨(두 번 발급, 거래 취소가 확정됨). */
  cancelled?: boolean;
  /** 이미 잘못 적음으로 다시 발급됨(새 계산서가 대상이 된다). */
  replaced?: boolean;
}

/** 카드에서 고친 값. 금액은 "고친 뒤"의 값이다(차액과 부호는 앱이 계산한다, 대표 지시 2026-11-24). */
export interface AmendValues {
  issueDate: string;
  supply: number;
  tax: number;
  item: string;
  counterpartBizNo: string;
}

export type AmendSheetKind = 'cancel' | 'new' | 'change';
/** 홈택스로 나가는 한 장. 금액은 부호가 붙은 값이다. */
export interface AmendSheet {
  kind: AmendSheetKind;
  issueDate: string;
  supply: number;
  tax: number;
  total: number;
}

/** 막는 것(발급하기가 켜지지 않는다). */
export type AmendBlock =
  | 'not_yet'
  | 'already_cancelled'
  | 'already_replaced'
  | 'no_change'
  | 'nothing_left'
  | 'not_less'
  | 'same_amount'
  | 'date_before_original'
  | 'date_future'
  | 'date_after_issued'
  | 'bad_amount'
  | 'bad_bizno'
  | 'bad_item';

/** 알려 주기만 하는 것(막지 않는다). 카드의 주의 면은 하나라 첫째만 보인다. */
export type AmendNote = 'increase_is_new' | 'deadline';

export interface AmendPlan {
  what: AmendWhat;
  /** 고치기 전 값(지금 남은 값). 카드 윗줄 "기존". */
  before: AmendAmounts & { total: number };
  /** 고친 뒤 값. 카드 아랫줄. */
  after: AmendAmounts & { total: number };
  sheets: AmendSheet[];
  /** readback 13칸이 가리키는 장(잘못 적음이면 새 계산서, 나머지는 하나뿐인 장). */
  main: AmendSheet;
  blocks: AmendBlock[];
  notes: AmendNote[];
  /** 완료 카드 고정 문장(당초 작성일자를 쓰는 사유이고 당초분 신고 기한이 지났다). */
  vatFiled: boolean;
  ready: boolean;
}

const BIZNO = /^\d{10}$/;
const MAX = 1e12;
const intOk = (n: number, min: number) => Number.isSafeInteger(n) && n >= min && n <= MAX;

/** 지금 남은 값 = 원본 + 이미 나간 수정분. */
export function amendCurrent(o: AmendOriginal): AmendAmounts & { total: number } {
  const supply = o.supply + (o.adjusted?.supply ?? 0);
  const tax = o.tax + (o.adjusted?.tax ?? 0);
  return { supply, tax, total: supply + tax };
}

/** 사유를 고른 직후의 값. 금액은 지금 값(바꿀 것만 고친다), 취소 사유는 0, 날은 사유가 정한다. */
export function amendStart(o: AmendOriginal, what: AmendWhat, today: string, said?: Partial<AmendValues>): AmendValues {
  const cur = what === 'wrong_entry' ? { supply: o.supply, tax: o.tax } : amendCurrent(o);
  const zero = AMEND_FULL_CANCEL.has(what);
  const dateRule = AMEND_DATE[what];
  const base: AmendValues = {
    issueDate: dateRule === 'event' ? today : o.issueDate,
    supply: zero ? 0 : cur.supply,
    tax: zero ? 0 : cur.tax,
    item: o.item,
    counterpartBizNo: o.counterpartBizNo,
  };
  const out = { ...base };
  if (!said) return out;
  if (dateRule !== 'original' && said.issueDate) out.issueDate = said.issueDate;
  if (zero || what === 'duplicate') return out;
  if (said.supply !== undefined && intOk(said.supply, 0)) {
    out.supply = said.supply;
    out.tax = said.tax !== undefined && intOk(said.tax, 0) ? said.tax : Math.floor(said.supply / 10);
  }
  if (what === 'wrong_entry') {
    if (said.item) out.item = said.item;
    if (said.counterpartBizNo && BIZNO.test(said.counterpartBizNo)) out.counterpartBizNo = said.counterpartBizNo;
  }
  return out;
}

/**
 * 금액 세 칸은 서로 따라 바뀐다(캔버스 승인 2026-11-24): 공급가액을 고치면 부가세(10%, 원 미만 버림)와 합계가,
 * 부가세만 고치면 공급가액은 그대로 두고 합계만, 합계를 고치면 합계에 맞는 공급가액과 부가세가 바뀐다.
 */
export function amendEditAmount(v: AmendValues, field: 'supply' | 'tax' | 'total', value: number): AmendValues {
  if (!intOk(value, 0)) return v;
  if (field === 'supply') return { ...v, supply: value, tax: Math.floor(value / 10) };
  if (field === 'tax') return { ...v, tax: value };
  if (value === 0) return { ...v, supply: 0, tax: 0 };
  const s = splitVat(value, 'included');
  return { ...v, supply: s.supply, tax: s.tax };
}

const nextMonth10 = (date: string) => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, '0')}-10`;
};

/** 고른 사유와 값으로 나갈 장, 막을 것, 알릴 것을 계산한다. */
export function amendPlan(o: AmendOriginal, what: AmendWhat, v: AmendValues, today: string): AmendPlan {
  const orig = { supply: o.supply, tax: o.tax, total: o.supply + o.tax };
  const cur = amendCurrent(o);
  // 잘못 적음과 두 번 발급은 홈택스가 당초분 전액을 음수로 채운다(앞선 수정분은 따로 남는다).
  const before = what === 'wrong_entry' || what === 'duplicate' ? orig : cur;
  const after = { supply: v.supply, tax: v.tax, total: v.supply + v.tax };
  const blocks: AmendBlock[] = [];
  const notes: AmendNote[] = [];
  const add = (b: AmendBlock) => void (blocks.includes(b) || blocks.push(b));
  if (!AMEND_READY[what]) add('not_yet');
  if (o.cancelled) add('already_cancelled');
  if (o.replaced) add('already_replaced');
  if (!intOk(v.supply, 0) || !intOk(v.tax, 0)) add('bad_amount');

  const date = AMEND_DATE[what] === 'original' ? o.issueDate : v.issueDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) add('date_future');
  if (AMEND_DATE[what] === 'event') {
    if (date < o.issueDate) add('date_before_original');
    if (date > today) add('date_future');
  }

  let sheets: AmendSheet[];
  const neg = (a: AmendAmounts, d: string): AmendSheet => ({ kind: 'cancel', issueDate: d, supply: -a.supply, tax: -a.tax, total: -(a.supply + a.tax) });
  switch (what) {
    case 'wrong_entry': {
      const issued = o.issuedOn ?? o.issueDate;
      if (v.issueDate > issued) add('date_after_issued');
      if (v.issueDate > today) add('date_future');
      if (!BIZNO.test(v.counterpartBizNo)) add('bad_bizno');
      if (!v.item.trim()) add('bad_item');
      if (v.supply <= 0) add('bad_amount');
      const same = v.issueDate === o.issueDate && v.counterpartBizNo === o.counterpartBizNo && v.item.trim() === o.item.trim() && v.supply === o.supply && v.tax === o.tax;
      if (same) add('no_change');
      sheets = [neg(orig, o.issueDate), { kind: 'new', issueDate: v.issueDate, ...after }];
      break;
    }
    case 'duplicate':
      sheets = [neg(orig, o.issueDate)];
      break;
    case 'deal_cancelled':
      sheets = [neg(cur, date)];
      if (cur.total <= 0) add('nothing_left');
      break;
    case 'amount_changed':
    case 'returned': {
      const d = { supply: after.supply - cur.supply, tax: after.tax - cur.tax };
      sheets = [{ kind: 'change', issueDate: date, ...d, total: d.supply + d.tax }];
      if (after.supply < 0 || after.tax < 0) add('nothing_left');
      if (what === 'returned' && (d.supply > 0 || d.supply + d.tax >= 0)) add('not_less');
      if (what === 'amount_changed' && d.supply === 0 && d.tax === 0) add('same_amount');
      if (what === 'amount_changed' && d.supply + d.tax > 0) notes.push('increase_is_new');
      break;
    }
    case 'local_lc':
      sheets = [];
      break;
  }
  if (AMEND_DATE[what] === 'event' && /^\d{4}-\d{2}-\d{2}$/.test(date) && today > nextMonth10(date)) notes.push('deadline');
  const vatFiled = AMEND_DATE[what] !== 'event' && issueDateRule(o.issueDate, today) === 'past_period';
  const main = sheets.find((s) => s.kind !== 'cancel') ?? sheets[0] ?? { kind: 'cancel' as const, issueDate: date, supply: 0, tax: 0, total: 0 };
  return { what, before, after, sheets, main, blocks, notes, vatFiled, ready: blocks.length === 0 };
}

/** 막는 것, 알리는 것의 문장. 사실만 말하고 사유를 권하지 않는다(결정 5). 카드에는 한 면만 보인다. */
export const AMEND_TEXT: Readonly<Record<AmendBlock | AmendNote | 'vat_filed', string | null>> = {
  not_yet: '내국신용장 수정은 아직 못 해요.',
  already_cancelled: '이미 취소한 계산서예요.',
  already_replaced: '이미 고쳐서 다시 발급한 계산서예요.',
  no_change: null,
  nothing_left: '남은 금액보다 많아요.',
  not_less: '돌려받은 만큼 금액을 줄여 주세요.',
  same_amount: null,
  date_before_original: '원래 작성일보다 앞선 날은 안 돼요.',
  date_future: '오늘 뒤의 날은 안 돼요.',
  date_after_issued: '발급한 날보다 뒤로는 고칠 수 없어요.',
  bad_amount: '금액을 다시 확인해 주세요.',
  bad_bizno: '거래처 번호 10자리를 확인해 주세요.',
  bad_item: '품목을 적어 주세요.',
  increase_is_new: '더 판 것이면 새 계산서로 발급해요.',
  deadline: '발급 기한이 지났을 수 있어요. 세무사에게 확인해 보세요.',
  vat_filed: '이미 신고한 부가세가 있다면 세무사에게 알려 주세요.',
};

/** 카드에 보일 주의 문장 하나(막는 것이 먼저). 없으면 null. */
export function amendNotice(p: AmendPlan): string | null {
  for (const b of p.blocks) if (AMEND_TEXT[b]) return AMEND_TEXT[b];
  for (const n of p.notes) if (AMEND_TEXT[n]) return AMEND_TEXT[n];
  return null;
}

/** 카드 제목. 전부 취소 사유는 "취소", 나머지는 "고치기". */
export function amendTitle(counterpartName: string, what: AmendWhat | null): string {
  return what && AMEND_FULL_CANCEL.has(what) ? `${counterpartName} 세금계산서 취소` : `${counterpartName} 세금계산서 고치기`;
}
