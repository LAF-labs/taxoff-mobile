import { AMEND_LABEL, isAmendWhat, type AmendWhat } from '../vendor/sax-chat-core/src/amend.ts';
import { CTX, approveMessage as wireApproveMessage, encodeCbor, fromB64, fromHex, jcs, sha256Hash, toHex, utf8 } from '../vendor/sax-remote/src/index.ts';

export interface GateField {
  key: string;
  value: string;
}

export interface CardHashInputs {
  readbackHash: string;
  packageDigest: string;
  authorizes: string[];
  intentId: string;
}

export interface PhoneGate {
  reqId: string;
  fields: GateField[];
  cardHashInputs: CardHashInputs;
  actionHash: string;
  challenge: string;
  exp: number;
}

export const GATE_TTL_MS = 120_000;
export const ARM_DELAY_MS = 800;
const URGENT_MS = 20_000;
export const DAILY_LIMIT = 5;

const sha256hex = (b: Uint8Array) => toHex(sha256Hash(b));
const hashBytes = (h: string) => {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('bad_hash');
  return fromHex(h);
};

export function cardHash(fields: readonly GateField[]): string {
  return sha256hex(encodeCbor(fields.map((f) => [f.key, f.value])));
}

export function readbackHash(values: Readonly<Record<string, string>>): string {
  return sha256hex(utf8(jcs(values)));
}

export function actionHash(card: string, i: CardHashInputs): string {
  return sha256hex(
    encodeCbor({ cardHash: hashBytes(card), readbackHash: hashBytes(i.readbackHash), authorizes: i.authorizes, packageDigest: hashBytes(i.packageDigest), intentId: i.intentId }),
  );
}

export function gateMatches(g: Pick<PhoneGate, 'fields' | 'cardHashInputs' | 'actionHash'>): boolean {
  try {
    return actionHash(cardHash(g.fields), g.cardHashInputs) === g.actionHash;
  } catch {
    return false;
  }
}

export const READBACK_KEYS = [
  'supplierBizNo', 'supplierName', 'counterpartBizNo', 'counterpartName', 'counterpartEmail',
  'itemName', 'itemCount', 'supplyAmount', 'taxAmount', 'totalAmount', 'issueDate', 'remark', 'receiptType',
] as const;

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  counterpartName: '상호',
  counterpartBizNo: '사업자번호',
  counterpartEmail: '받는 이메일',
  supplyAmount: '공급가액',
  taxAmount: '세액',
  totalAmount: '합계',
  itemName: '품목',
  itemCount: '수량',
  issueDate: '작성일자',
  receiptType: '영수/청구',
  remark: '비고',
  supplierName: '상호',
  supplierBizNo: '사업자번호',
};

const RESERVED_KEYS = ['$first.bizNo', '$first.email', '$dup.businessKey', '$dup.priorNotCommitted', '$dup.otherDevice', '$amend.what', '$amend.original'] as const;
const DUP_LINE: Readonly<Record<string, string>> = {
  '$dup.businessKey': '같은 건을 이미 발급했어요',
  '$dup.priorNotCommitted': '같은 건을 전에 시도했는데 발급되지 않았어요',
  '$dup.otherDevice': '다른 기기에서 같은 건을 작성하고 있어요',
};

export const AMOUNT_KEYS = new Set(['supplyAmount', 'taxAmount', 'totalAmount']);

export const SHEET_GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: '금액', keys: ['supplyAmount', 'taxAmount', 'totalAmount'] },
  { title: '받는 곳', keys: ['counterpartName', 'counterpartBizNo', 'counterpartEmail'] },
  { title: '내용', keys: ['itemName', 'itemCount', 'issueDate', 'receiptType', 'remark'] },
  { title: '보내는 곳', keys: ['supplierName', 'supplierBizNo'] },
];

const isTrue = (v: string | undefined) => v !== undefined && v !== 'false' && v !== '';

export function dupDetail(v: string): string | undefined {
  const m = /^[a-z_]+;(\d{4})?;(\d{1,2}):(\d{2})$/.exec(v) ?? /^[a-z_]+;(\d{4})$/.exec(v);
  if (!m) return undefined;
  const parts: string[] = [];
  if (m[1]) parts.push(`승인번호 끝 ${m[1]}`);
  if (m[2] && m[3]) {
    const h = Number(m[2]);
    parts.push(`${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m[3]}`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

interface GateReading {
  unknown: string[];
  values: Record<string, string>;
  first: boolean;
  dups: Array<{ key: string; line: string; detail?: string }>;
  /** 수정세금계산서(ADR-058) 승인이면 사장님이 고른 사유의 말과 원래 계산서 승인번호 */
  amend: { what: AmendWhat; label: string; original: string } | null;
}

export function readGate(g: Pick<PhoneGate, 'fields'>): GateReading {
  const values: Record<string, string> = {};
  const unknown: string[] = [];
  for (const f of g.fields) {
    const known = Object.hasOwn(FIELD_LABELS, f.key) || (RESERVED_KEYS as readonly string[]).includes(f.key);
    if (!known || Object.hasOwn(values, f.key)) unknown.push(f.key);
    values[f.key] = f.value;
  }
  const dups = Object.keys(DUP_LINE)
    .filter((k) => isTrue(values[k]))
    .map((k) => ({ key: k, line: DUP_LINE[k]!, detail: dupDetail(values[k]!) }));
  const what = values['$amend.what'];
  if (what !== undefined && !isAmendWhat(what)) unknown.push('$amend.what');
  const amend = what !== undefined && isAmendWhat(what) ? { what, label: AMEND_LABEL[what], original: values['$amend.original'] ?? '' } : null;
  return { unknown, values, first: isTrue(values['$first.bizNo']) || isTrue(values['$first.email']), dups, amend };
}

export function showValue(key: string, v: string): string {
  // 수정세금계산서의 금액은 부호가 있다(줄이거나 취소하는 장은 −)
  if (AMOUNT_KEYS.has(key) && /^-?\d{1,15}$/.test(v)) return `${v.startsWith('-') ? '−' : ''}${Math.abs(Number(v)).toLocaleString('ko-KR')}원`;
  return v;
}

export type AttestState = 'hw' | 'ios_se' | 'ios_app_attest' | 'none';

export type SheetStop =
  | 'mismatch'
  | 'unknown'
  | 'noKey'
  | 'iosDenied'
  | 'first'
  | 'limit';

type SheetState =
  | { kind: 'stopped'; stop: SheetStop }
  | { kind: 'expired' }
  | { kind: 'inDoubt' }
  | { kind: 'open'; armed: boolean; leftMs: number; urgent: boolean; needsAck: boolean };

export interface SheetContext {
  now: number;
  openedAt: number;
  attest: AttestState;
  iosAllowed: boolean;
  usedToday: number;
  dailyLimit?: number;
  acked: ReadonlySet<string>;
  inDoubt?: boolean;
}

export function sheetState(g: PhoneGate, c: SheetContext): SheetState {
  if (c.inDoubt) return { kind: 'inDoubt' };
  if (!gateMatches(g)) return { kind: 'stopped', stop: 'mismatch' };
  const r = readGate(g);
  if (r.unknown.length > 0) return { kind: 'stopped', stop: 'unknown' };
  if (c.attest === 'none') return { kind: 'stopped', stop: 'noKey' };
  if ((c.attest === 'ios_app_attest' || c.attest === 'ios_se') && !c.iosAllowed) return { kind: 'stopped', stop: 'iosDenied' };
  if (r.first) return { kind: 'stopped', stop: 'first' };
  if (c.usedToday >= (c.dailyLimit ?? DAILY_LIMIT)) return { kind: 'stopped', stop: 'limit' };
  const leftMs = g.exp - c.now;
  if (leftMs <= 0) return { kind: 'expired' };
  return {
    kind: 'open',
    armed: c.now - c.openedAt >= ARM_DELAY_MS,
    leftMs,
    urgent: leftMs <= URGENT_MS,
    needsAck: r.dups.some((d) => !c.acked.has(d.key)),
  };
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function approveMessage(pairId: string, reqId: string, challenge: string, action: string, decision: 'approve' | 'deny'): Uint8Array {
  return wireApproveMessage({ pairId, reqId, challenge: fromB64(challenge), actionHash: action, decision });
}
export const APPROVE_CTX = CTX.approve;

export function buildGate(d: {
  readback: Readonly<Record<(typeof READBACK_KEYS)[number], string>>;
  reserved: GateField[];
  packageDigest: string;
  authorizes: string[];
  intentId: string;
  reqId: string;
  challenge: string;
  exp: number;
}): PhoneGate {
  const fields: GateField[] = [...READBACK_KEYS.map((k) => ({ key: k, value: d.readback[k] })), ...d.reserved];
  const cardHashInputs = { readbackHash: readbackHash(Object.fromEntries(READBACK_KEYS.map((k) => [k, d.readback[k]]))), packageDigest: d.packageDigest, authorizes: d.authorizes, intentId: d.intentId };
  return { reqId: d.reqId, fields, cardHashInputs, actionHash: actionHash(cardHash(fields), cardHashInputs), challenge: d.challenge, exp: d.exp };
}
