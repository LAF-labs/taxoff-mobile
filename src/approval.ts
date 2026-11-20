// 폰 승인(P-03, ADR-046 결정 1·4·6, D03 §3, D08 §6·§6.1): gate.request를 받아 앱 내장 사전으로 그리고,
// 표시한 값으로 cardHash·actionHash를 다시 계산해 맞을 때만 승인 단추를 켠다. 한 시트에 비가역 하나, 묶음 승인 없음.
// 해시 식은 엔진 poc/packages/engine/src/gate.ts와 같다(시험 벡터 test/fixtures/gate-vectors.json은 그 코드로 만들었다):
//   cardHash     = SHA-256(CBOR([[key, value], …]))            fields 배열 전체(키·값·순서)
//   readbackHash = SHA-256(JCS{readback key: value})
//   actionHash   = SHA-256(CBOR{cardHash, readbackHash, authorizes[], packageDigest, intentId})  해시는 바이트열로
import { CTX, approveMessage as wireApproveMessage, encodeCbor, fromB64, fromHex, jcs, sha256Hash, toHex, utf8 } from '../vendor/sax-remote/src/index.ts';

/** remote-envelope gate.request의 fields 한 칸(와이어 이름 key·value). */
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

/** gate.request 본문 중 폰이 쓰는 부분(remote-envelope v1 schema). */
export interface PhoneGate {
  reqId: string;
  fields: GateField[];
  cardHashInputs: CardHashInputs;
  actionHash: string;
  /** 32바이트 base64 */
  challenge: string;
  /** 응답 마감(ms, epoch). PC는 120초로 낸다. */
  exp: number;
}

export const GATE_TTL_MS = 120_000;
/** 시트가 뜬 뒤 누름을 받지 않는 시간(무장 지연). PC 승인 카드 600ms보다 조금 길게. */
export const ARM_DELAY_MS = 800;
/** 남은 시간을 강조하는 구간 */
const URGENT_MS = 20_000;
/** policy.remote.irreversiblePerDay 기본값(정책은 더 엄격하게만 바꾼다) */
export const DAILY_LIMIT = 5;

// ---- 해시 ----

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

/** 받은 fields·cardHashInputs로 다시 계산한 actionHash가 PC가 보낸 값과 같은지. 계산이 던지면(모양이 틀리면) 맞지 않는 것으로 본다. */
export function gateMatches(g: Pick<PhoneGate, 'fields' | 'cardHashInputs' | 'actionHash'>): boolean {
  try {
    return actionHash(cardHash(g.fields), g.cardHashInputs) === g.actionHash;
  } catch {
    return false;
  }
}

// ---- 앱 내장 라벨 사전 ----

/** readback 칸(엔진 READBACK_KEYS와 같은 순서). 이 순서가 게이트 fields 앞 13칸이다. */
export const READBACK_KEYS = [
  'supplierBizNo', 'supplierName', 'counterpartBizNo', 'counterpartName', 'counterpartEmail',
  'itemName', 'itemCount', 'supplyAmount', 'taxAmount', 'totalAmount', 'issueDate', 'remark', 'receiptType',
] as const;

/** fieldKey → 한국어 라벨. 여기 없는 키가 오면 승인하지 않는다(PC가 보낸 글자를 라벨로 쓰지 않는다). */
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
  receiptType: '영수·청구',
  remark: '비고',
  supplierName: '상호',
  supplierBizNo: '사업자번호',
};

/** 예약 키(엔진만 만든다). $first.*는 멈춤, $dup.*는 확인해야 하는 경고 한 줄. */
const RESERVED_KEYS = ['$first.bizNo', '$first.email', '$dup.businessKey', '$dup.priorNotCommitted', '$dup.otherDevice'] as const;
const DUP_LINE: Readonly<Record<string, string>> = {
  '$dup.businessKey': '같은 건을 이미 발급했어요',
  '$dup.priorNotCommitted': '같은 건을 전에 시도했는데 발급되지 않았어요',
  '$dup.otherDevice': '다른 기기에서 같은 건을 작성하고 있어요',
};

export const AMOUNT_KEYS = new Set(['supplyAmount', 'taxAmount', 'totalAmount']);

/** 화면에 보일 묶음과 순서(금액이 먼저, PC 승인 카드와 같다). 되읽은 값 전체를 보인다(비어 있는 비고만 뺀다). */
export const SHEET_GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: '금액', keys: ['supplyAmount', 'taxAmount', 'totalAmount'] },
  { title: '받는 곳', keys: ['counterpartName', 'counterpartBizNo', 'counterpartEmail'] },
  { title: '내용', keys: ['itemName', 'itemCount', 'issueDate', 'receiptType', 'remark'] },
  { title: '보내는 곳', keys: ['supplierName', 'supplierBizNo'] },
];

const isTrue = (v: string | undefined) => v !== undefined && v !== 'false' && v !== '';

/**
 * $dup.* 값에서 둘째 줄을 뽑는다. 엔진은 지금 'committed'처럼 상태만 넣으므로 보통 없다.
 * 값이 "committed;1234;10:20"처럼 승인번호 끝 4자리·시각을 함께 실어 오면 "승인번호 끝 1234 · 오전 10:20"으로 보인다
 * (값은 cardHash에 들어간 글자 그대로에서만 뽑는다. 이 모양은 엔진과 맞춰야 한다).
 */
export function dupDetail(v: string): string | undefined {
  const m = /^[a-z_]+;(\d{4})?;(\d{1,2}):(\d{2})$/.exec(v) ?? /^[a-z_]+;(\d{4})$/.exec(v);
  if (!m) return undefined;
  const parts: string[] = [];
  if (m[1]) parts.push(`승인번호 끝 ${m[1]}`);
  if (m[2] && m[3]) {
    const h = Number(m[2]);
    parts.push(`${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m[3]}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

interface GateReading {
  /** 사전에 없는 키 */
  unknown: string[];
  values: Record<string, string>;
  /** 처음 거래하는 곳(사업자번호) 또는 처음 보내는 이메일 */
  first: boolean;
  /** 확인해야 하는 같은 건 경고(키, 한 줄, 둘째 줄 = 승인번호 끝 4자리 · 시각, 값이 알려 줄 때만) */
  dups: Array<{ key: string; line: string; detail?: string }>;
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
  return { unknown, values, first: isTrue(values['$first.bizNo']) || isTrue(values['$first.email']), dups };
}

/** 금액 칸 표시: 숫자만 오면 천 단위 쉼표 + 원(띄우지 않는다). 그 밖은 받은 그대로. */
export function showValue(key: string, v: string): string {
  if (AMOUNT_KEYS.has(key) && /^\d{1,15}$/.test(v)) return `${Number(v).toLocaleString('ko-KR')}원`;
  return v;
}

// ---- 시트 상태 ----

/**
 * hw: 하드웨어 키 생성 증명됨(Android StrongBox 등) · ios_se: iPhone Secure Enclave 키를 PC가 받음(증명 없음, ADR-052)
 * ios_app_attest: 앱 무결성만(iPhone) · none: 승인 기기로 못 씀
 */
export type AttestState = 'hw' | 'ios_se' | 'ios_app_attest' | 'none';

export type SheetStop =
  /** PC가 보낸 값으로 다시 계산한 해시가 맞지 않음 */
  | 'mismatch'
  /** 앱 사전에 없는 항목 */
  | 'unknown'
  | 'noKey'
  /** iPhone 승인 기기를 받지 않는 설정(ADR-046 결정 4 기각 쪽) */
  | 'iosDenied'
  | 'first'
  | 'limit';

type SheetState =
  | { kind: 'stopped'; stop: SheetStop }
  | { kind: 'expired' }
  /** 승인했지만 결과를 모른다. 어떤 단추도 다시 발급하지 않는다. */
  | { kind: 'inDoubt' }
  | { kind: 'open'; armed: boolean; leftMs: number; urgent: boolean; needsAck: boolean };

export interface SheetContext {
  now: number;
  openedAt: number;
  attest: AttestState;
  /** iPhone(ios_app_attest)을 승인 기기로 받는지. ADR-046 결정 4 채택(tex #403)으로 기본 true, false는 정책으로 막은 경우 */
  iosAllowed: boolean;
  usedToday: number;
  dailyLimit?: number;
  /** 확인한 $dup 키 */
  acked: ReadonlySet<string>;
  inDoubt?: boolean;
}

/** 우선순위: 결과 모름 > 해시 > 모르는 항목 > 키 > 처음 거래처 > 한도 > 만료 > 열림. */
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

/** 1:58 */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- 응답 ----

/**
 * gate.response 서명 대상(컨텍스트 제외): CBOR([pairId, reqId, challenge(32B), actionHash(32B), decision]).
 * PC 검증기와 같은 함수(@sax/remote approveMessage, ADR-052 결정 4)다. 키는 SAX-approve-v1 ‖ 이 바이트를 SHA-256으로 해시해 서명한다.
 */
export function approveMessage(pairId: string, reqId: string, challenge: string, action: string, decision: 'approve' | 'deny'): Uint8Array {
  return wireApproveMessage({ pairId, reqId, challenge: fromB64(challenge), actionHash: action, decision });
}
export const APPROVE_CTX = CTX.approve;

/** 엔진 buildGateRequest와 같은 식으로 게이트를 만든다(갤러리·가짜 저장소·시험용). */
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
