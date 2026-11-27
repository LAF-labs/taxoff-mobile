import { isBizNo } from './book.ts';
import { encodeEnvelope, makeEnvelope, type CmdRunBody, type EnvelopeCtx, type PhoneCopyBody } from './envelope.ts';
import { MAX_INNER } from './frame.ts';

export const ISSUE_PLAYBOOK = 'hometax.invoice.issue';

/**
 * 받는 곳은 PC 거래처 ID(counterpartyRef) 하나, 또는 폰에서 추가해 아직 ID를 모르는 거래처의 등록번호와 상호(newCounterparty) 하나다(ADR-066).
 * PC는 newCounterparty의 등록번호로 장부를 찾고, 없으면 먼저 추가한다.
 */
export interface PhoneIssueRequest {
  counterpartyRef?: string;
  newCounterparty?: { bizNo: string; name: string };
  supply: number;
  tax: number;
  item: string;
  day: string;
}

const REF = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_WON = 100_000_000_000;

/** 입력이 맞지 않으면 이유 코드(로컬 UI용). */
export function checkIssueRequest(r: PhoneIssueRequest): 'ref' | 'supply' | 'tax' | 'item' | 'day' | null {
  const n = r.newCounterparty;
  if ((r.counterpartyRef === undefined) === (n === undefined)) return 'ref';
  if (r.counterpartyRef !== undefined && !REF.test(r.counterpartyRef)) return 'ref';
  if (n && (!isBizNo(n.bizNo) || n.name.trim().length < 1 || n.name.trim().length > 60)) return 'ref';
  if (!Number.isSafeInteger(r.supply) || r.supply <= 0 || r.supply > MAX_WON) return 'supply';
  if (!Number.isSafeInteger(r.tax) || r.tax < 0 || r.tax > MAX_WON) return 'tax';
  const item = r.item.trim();
  if (item.length < 1 || item.length > 60) return 'item';
  if (!DAY.test(r.day)) return 'day';
  return null;
}

/** hometax.invoice.issue 입력(플레이북 inputs: counterpart·amounts·items·issueDay). email은 넣지 않는다. */
export function issueInputs(r: PhoneIssueRequest): Record<string, unknown> {
  const bad = checkIssueRequest(r);
  if (bad) throw new Error(`issue: bad ${bad}`);
  const item = r.item.trim();
  return {
    counterpart: r.newCounterparty ? { bizNo: r.newCounterparty.bizNo, name: r.newCounterparty.name.trim() } : { counterpartyRef: r.counterpartyRef },
    amounts: { supply: r.supply, tax: r.tax },
    items: [{ name: item, supply: r.supply, tax: r.tax }],
    issueDay: r.day,
  };
}

export function issueCmd(cmdId: string, r: PhoneIssueRequest): CmdRunBody {
  return { cmdId, playbookId: ISSUE_PLAYBOOK, inputs: issueInputs(r) };
}

/** 수정세금계산서 플레이북(ADR-058). */
export const AMEND_PLAYBOOK = 'hometax.invoice.amend';
export const AMEND_WHATS = ['wrong_entry', 'duplicate', 'local_lc', 'amount_changed', 'deal_cancelled', 'returned'] as const;

/**
 * 폰에서 고른 수정 한 건(ADR-058 결정 8). original은 사본의 당초분 승인번호, what은 사장님이 카드에서 고른 사유,
 * values는 카드에서 고친 "고친 뒤"의 값이다. 차액, 부호, 나갈 장은 PC 엔진이 같은 식(chat-core amendPlan)으로 다시 계산한다.
 */
export interface PhoneAmendRequest {
  original: string;
  what: (typeof AMEND_WHATS)[number];
  values: { issueDate: string; supply: number; tax: number; item: string; counterpartBizNo: string };
}

const APPROVAL = /^\d{8}-\d{8}-\d{8}$/;
export function checkAmendRequest(r: PhoneAmendRequest): 'original' | 'what' | 'values' | null {
  if (typeof r?.original !== 'string' || !APPROVAL.test(r.original)) return 'original';
  if (!(AMEND_WHATS as readonly string[]).includes(r.what)) return 'what';
  const v = r.values;
  const keys = v && typeof v === 'object' ? Object.keys(v).sort().join() : '';
  if (keys !== 'counterpartBizNo,issueDate,item,supply,tax') return 'values';
  if (!DAY.test(v.issueDate) || !Number.isSafeInteger(v.supply) || v.supply < 0 || v.supply > MAX_WON || !Number.isSafeInteger(v.tax) || v.tax < 0 || v.tax > MAX_WON) return 'values';
  if (typeof v.item !== 'string' || v.item.trim().length > 100 || typeof v.counterpartBizNo !== 'string' || !/^\d{10}$/.test(v.counterpartBizNo)) return 'values';
  return null;
}

export function amendCmd(cmdId: string, r: PhoneAmendRequest): CmdRunBody {
  const bad = checkAmendRequest(r);
  if (bad) throw new Error(`amend: bad ${bad}`);
  return { cmdId, playbookId: AMEND_PLAYBOOK, inputs: { amend: { original: r.original, what: r.what, values: { ...r.values, item: r.values.item.trim() } } } };
}

/** cmd.run inputs → 수정 요청. 모양이 다르면 null. */
export function parseAmendInputs(inputs: unknown): PhoneAmendRequest | null {
  const o = inputs as { amend?: unknown } | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).join() !== 'amend') return null;
  const a = o.amend as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== 'original,values,what') return null;
  const r = a as unknown as PhoneAmendRequest;
  return checkAmendRequest(r) ? null : r;
}

/**
 * phone.copy가 한 프레임(MAX_INNER)에 들어가도록 오래된 발급 기록부터 덜고, 그래도 넘치면 발급 기록을 모두 빼고 거래처 목록을 뒤(오래 안 쓴 쪽)에서부터 줄인다.
 * 줄인 거래처 개수를 함께 돌려준다. 거래처를 모두 빼도 안 들어가면 null.
 */
export function fitPhoneCopy(body: PhoneCopyBody, ctx: EnvelopeCtx): { body: PhoneCopyBody; dropped: number } | null {
  const size = (b: PhoneCopyBody): number => {
    try {
      return encodeEnvelope(makeEnvelope('phone.copy', b, ctx)).length;
    } catch (e) {
      if (e instanceof Error && e.message.includes('too large')) return MAX_INNER + 1;
      throw e;
    }
  };
  const fits = (b: PhoneCopyBody) => size(b) <= MAX_INNER;
  const longest = (n: number, ok: (k: number) => boolean): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const all = body.counterparties.slice(0, 100);
  const full = { ...body, counterparties: all };
  if (fits(full)) return { body: full, dropped: body.counterparties.length - all.length };
  const { issued, report, ...rest } = full;
  // 넘치면 지난 발급 줄, 그다음 월 리포트, 마지막에 거래처 순으로 덜어낸다(v1.16)
  const withReport = report ? { ...rest, report } : rest;
  if (issued?.length && fits({ ...withReport, counterparties: all, issued: [] })) {
    const keep = longest(issued.length, (k) => fits({ ...withReport, issued: issued.slice(0, k) }));
    return { body: { ...withReport, issued: issued.slice(0, keep) }, dropped: body.counterparties.length - all.length };
  }
  if (issued?.length && fits({ ...rest, counterparties: all, issued: [] })) {
    const keep = longest(issued.length, (k) => fits({ ...rest, issued: issued.slice(0, k) }));
    return { body: { ...rest, issued: issued.slice(0, keep) }, dropped: body.counterparties.length - all.length };
  }
  if (report && fits(rest)) return { body: rest, dropped: body.counterparties.length - all.length };
  if (!fits({ ...rest, counterparties: [] })) return null;
  const keep = longest(all.length, (k) => fits({ ...rest, counterparties: all.slice(0, k) }));
  return { body: { ...rest, counterparties: all.slice(0, keep) }, dropped: body.counterparties.length - keep };
}
