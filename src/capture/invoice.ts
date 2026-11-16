// 종이 세금계산서·계산서 규칙 파서. 폰 OCR 글자 상자(위치 포함) → 서식 칸 값 후보 + 칸마다 확신.
// 모델을 부르지 않는다(ADR-032 결정 11·ADR-034 결정 9). 값은 사장님 확인을 거친 후보이고, PC가 원본 사진과 함께 정본으로 다시 본다.
// 순수 함수(React Native 의존 없음) — node --test로 시험한다.
//
// 서식(부가가치세법 시행규칙 별지 제14호·제15호, 종이 세금계산서·계산서)의 모양을 기대한다:
//   머리: 세금계산서 / 계산서, (공급자 보관용 | 공급받는자 보관용), 책번호 권·호, 일련번호
//   왼쪽 공급자 · 오른쪽 공급받는자: 등록번호, 상호(법인명), 성명(대표자), 사업장 주소, 업태, 종목
//   작성 년 월 일 · 공급가액 · 세액 · 비고 (공급가액·세액이 자리마다 한 칸인 옛 서식도 있다)
//   품목 줄: 월 일 품목 규격 수량 단가 공급가액 세액 비고
//   바닥: 합계금액 · 현금 · 수표 · 어음 · 외상미수금 · 이 금액을 영수/청구 함
// 칸 위치로 읽고, 숫자는 검산(공급가액 × 10% ≈ 세액, 합계 = 공급가액 + 세액, 사업자번호 검증 숫자)으로 고른다.
import { validBizNo } from './parser.ts';

export interface OcrBox {
  text: string;
  /** 0~1, 위·왼쪽이 0 */
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;
}

export type InvoiceKind = 'tax_invoice' | 'invoice';
export type Direction = 'sales' | 'purchase';

export interface Party {
  bizNo: string | null;
  name: string | null;
  ceo: string | null;
  address: string | null;
}

export interface InvoiceItem {
  month: number | null;
  day: number | null;
  name: string;
  spec: string | null;
  qty: number | null;
  unitPrice: number | null;
  supply: number;
  vat: number | null;
}

/** 릴레이 스레드와 합의한 paperInvoice 모양(receipt.v2). 폰은 사장님이 확인한 값만 보낸다. */
export interface PaperInvoice {
  docKind: InvoiceKind;
  direction: Direction | null;
  writtenOn: string | null;
  approvalNo: string | null;
  bookNo: string | null;
  serialNo: string | null;
  supplier: Party;
  buyer: Party;
  supplyAmount: number | null;
  vatAmount: number | null;
  total: number | null;
  items: InvoiceItem[];
  receiptOrClaim: 'receipt' | 'claim' | null;
  /** 칸 이름 → 0~1. 사장님이 고친 칸은 1 */
  fieldConfidence: Record<string, number>;
}

/** 어느 보관용을 찍었는지(사장님이 받은 쪽이면 매입) */
export type CopyOf = 'supplier' | 'buyer' | null;

export interface InvoiceRead {
  invoice: PaperInvoice;
  copyOf: CopyOf;
  /** 홈택스에서 뽑은 전자세금계산서 출력물(승인번호가 있다). PC가 홈택스에서 이미 가져온다 */
  electronicCopy: boolean;
}

// ── 글자 다듬기 ──
const nfkc = (s: string) => s.normalize('NFKC');
/** 라벨 비교용: 공백·괄호·가운뎃점을 지운다 */
const key = (s: string) => nfkc(s).replace(/[\s()（）·.:：]/g, '');

const LABELS: Record<string, RegExp> = {
  bizNo: /^(등록번호|사업자등록번호|사업자번호)/,
  name: /^(상호|법인명|상호법인명)/,
  ceo: /^(성명|대표자|대표자성명|성명대표자)/,
  address: /^(사업장주소|사업장|주소)/,
  type: /^(업태)/,
  item: /^(종목)/,
};
const ANY_LABEL = /^(등록번호|사업자등록번호|상호|법인명|성명|대표자|사업장주소|사업장|주소|업태|종목|공급자|공급받는자|공급받는|받는자|종사업장번호|종사업장|이메일|전자우편)/;

interface Row {
  y: number;
  boxes: OcrBox[];
  text: string;
}

/** 같은 높이의 상자를 한 줄로 묶고 왼쪽부터 늘어놓는다. 줄 간격 기준은 상자 높이의 중앙값. */
export function toRows(boxes: OcrBox[]): Row[] {
  const bs = boxes.filter((b) => b.text.trim()).map((b) => ({ ...b, text: nfkc(b.text).trim() }));
  if (!bs.length) return [];
  const hs = bs.map((b) => b.h).sort((a, b) => a - b);
  const tol = Math.max(0.004, (hs[Math.floor(hs.length / 2)] ?? 0.01) * 0.55);
  const sorted = [...bs].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Row[] = [];
  for (const b of sorted) {
    const cy = b.y + b.h / 2;
    const r = rows.find((r) => Math.abs(r.y - cy) <= tol);
    if (r) {
      r.boxes.push(b);
      r.y = (r.y * (r.boxes.length - 1) + cy) / r.boxes.length;
    } else rows.push({ y: cy, boxes: [b], text: '' });
  }
  for (const r of rows) {
    r.boxes.sort((a, b) => a.x - b.x);
    r.text = r.boxes.map((b) => b.text).join(' ');
  }
  return rows.sort((a, b) => a.y - b.y);
}

/** 줄 목록만 있는 OCR(옛 빌드·다른 엔진)을 상자로 바꾼다: 한 줄 = 전폭 상자 하나. */
export function linesToBoxes(lines: string[]): OcrBox[] {
  const n = Math.max(lines.length, 1);
  return lines.map((text, i) => ({ text, x: 0, y: i / n, w: 1, h: 0.8 / n }));
}

// ── 숫자 ──
const won = (s: string): number | null => {
  const t = nfkc(s).replace(/[\s원₩\\]/g, '');
  if (!/^-?(\d{1,3}([,.]\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/[,.]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_000 ? n : null;
};

/**
 * 한 줄의 금액 토큰. 자리마다 한 칸인 옛 서식(백·십·억·천…)은 붙어 있는 한 자리 숫자 칸을 이어 붙인다.
 * 날짜·사업자번호·승인번호 꼴은 뺀다.
 */
function amountsOf(row: Row): { n: number; x: number }[] {
  const out: { n: number; x: number }[] = [];
  let run: OcrBox[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const n = won(run.map((b) => b.text).join(''));
      if (n !== null) out.push({ n, x: run[0]!.x });
    }
    run = [];
  };
  for (const b of row.boxes) {
    const t = b.text.replace(/\s/g, '');
    if (/^\d$/.test(t)) {
      const prev = run[run.length - 1];
      if (prev && b.x - (prev.x + prev.w) > Math.max(prev.w, b.w) * 3) flush();
      run.push(b);
      continue;
    }
    flush();
    const clean = t.replace(/\d{8}-\d{8}-\d{8}/g, ' ').replace(/\d{3}-\d{2}-\d{5}/g, ' ').replace(/(19|20)\d{2}[-./년]\d{1,2}[-./월]\d{1,2}일?/g, ' ');
    for (const m of clean.matchAll(/-?\d{1,3}(?:,\d{3})+|-?\d{2,12}/g)) {
      const n = won(m[0]);
      if (n !== null) out.push({ n, x: b.x });
    }
  }
  flush();
  return out;
}

/** 세액이 공급가액의 10%로 맞는가(원 단위 버림·반올림·올림 어느 쪽이든) */
export const vatFits = (supply: number, vat: number) => supply > 0 && Math.abs(vat - supply / 10) <= 1;

function fmtBiz(d: string) {
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}
function bizIn(s: string): string | null {
  for (const m of nfkc(s).matchAll(/(?<!\d)(\d{3})\s*[-–]?\s*(\d{2})\s*[-–]?\s*(\d{5})(?!\d)/g)) {
    const d = `${m[1]}${m[2]}${m[3]}`;
    if (validBizNo(d)) return fmtBiz(d);
  }
  return null;
}

function validDay(y: number, m: number, d: number, today: Date): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (dt.getTime() > t + 86_400_000 || dt.getTime() < t - 6 * 366 * 86_400_000) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const tidyName = (s: string): string | null => {
  const t = nfkc(s).replace(/\p{Cc}/gu, '').replace(/^[\s:：|]+|[\s:：|]+$/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 1 || /^\d+$/.test(t) || ANY_LABEL.test(key(t))) return null;
  return t.slice(0, 60);
};

// ── 칸 읽기 ──
/** 라벨 상자 오른쪽(같은 줄, 다음 라벨 전까지)의 글자. 라벨과 값이 한 상자면 라벨을 떼고 남은 글자. */
const LABEL_HEAD = /^(사업자등록번호|등록번호|사업자번호|상호법인명|상호|법인명|성명대표자|대표자성명|성명|대표자|사업장주소|사업장|주소|업태|종목)/;
const LABEL_HEAD_RAW = /^[\s(]*(사업자\s*등록\s*번호|등\s*록\s*번\s*호|사업자\s*번호|상\s*호\s*\(?\s*법\s*인\s*명\s*\)?|상\s*호|법\s*인\s*명|성\s*명\s*\(?\s*대\s*표\s*자\s*\)?|대\s*표\s*자(\s*성\s*명)?|성\s*명|사\s*업\s*장\s*주\s*소|사\s*업\s*장|주\s*소|업\s*태|종\s*목)[\s):：]*/;

function valueRight(row: Row, label: OcrBox, maxX: number): string | null {
  // 라벨과 값이 한 상자("상호 가나상사")면 라벨을 떼고 남은 글자
  if (key(label.text).replace(LABEL_HEAD, '').length >= 1) {
    const m = nfkc(label.text).match(LABEL_HEAD_RAW);
    const rest = m ? nfkc(label.text).slice(m[0].length).trim() : '';
    if (rest) return rest;
  }
  const parts: string[] = [];
  for (const b of row.boxes) {
    if (b.x <= label.x + label.w * 0.5 || b.x >= maxX) continue;
    if (ANY_LABEL.test(key(b.text))) break;
    parts.push(b.text);
  }
  return parts.length ? parts.join(' ') : null;
}

interface Side {
  minX: number;
  maxX: number;
}

function readParty(rows: Row[], side: Side, headerEnd: number): { party: Party; conf: Record<string, number> } {
  const party: Party = { bizNo: null, name: null, ceo: null, address: null };
  const conf: Record<string, number> = {};
  for (const r of rows) {
    if (r.y > headerEnd) break;
    const inSide = r.boxes.filter((b) => b.x + b.w / 2 >= side.minX && b.x + b.w / 2 < side.maxX);
    const sub: Row = { ...r, boxes: inSide };
    for (const b of inSide) {
      const k = key(b.text);
      for (const [field, re] of [['bizNo', LABELS.bizNo], ['name', LABELS.name], ['ceo', LABELS.ceo], ['address', LABELS.address]] as const) {
        if (!re!.test(k) || party[field]) continue;
        const v = valueRight(sub, b, side.maxX);
        if (!v) continue;
        if (field === 'bizNo') {
          const n = bizIn(v);
          if (n) {
            party.bizNo = n;
            conf.bizNo = 0.95;
          }
        } else {
          const t = tidyName(v);
          if (t) {
            party[field] = field === 'address' ? t.slice(0, 120) : t;
            conf[field] = 0.8;
          }
        }
      }
    }
    // 라벨 없이 사업자번호만 보이면(라벨 칸이 세로로 합쳐진 서식) 그 쪽의 첫 번호
    if (!party.bizNo) {
      for (const b of inSide) {
        const n = bizIn(b.text);
        if (n) {
          party.bizNo = n;
          conf.bizNo = 0.7;
          break;
        }
      }
    }
  }
  return { party, conf };
}

export function parsePaperInvoice(boxes: OcrBox[], today = new Date()): InvoiceRead | null {
  const rows = toRows(boxes);
  if (!rows.length) return null;
  const all = rows.map((r) => key(r.text)).join('\n');
  const kind: InvoiceKind | null = /세금계산서/.test(all) ? 'tax_invoice' : /계산서/.test(all) ? 'invoice' : null;
  if (!kind) return null;
  const fc: Record<string, number> = {};

  // 보관용 → 방향 후보. 공급받는자 보관용이면 사장님이 받은 것(매입)
  const copyOf: CopyOf = /공급받는자보관용/.test(all) ? 'buyer' : /공급자보관용/.test(all) ? 'supplier' : null;
  const direction: Direction | null = copyOf === 'buyer' ? 'purchase' : copyOf === 'supplier' ? 'sales' : null;
  if (direction) fc.direction = 0.85;

  // 승인번호(홈택스 출력물): 8-8-8 숫자, 또는 24자리
  const appr = nfkc(rows.map((r) => r.text).join(' ')).match(/(?<!\d)(\d{8})\s*-\s*(\d{8})\s*-\s*(\d{8})(?!\d)/);
  const approvalNo = appr ? `${appr[1]}-${appr[2]}-${appr[3]}` : null;

  // 책번호 ○권 ○호, 일련번호
  const book = all.match(/책번호(\d{1,4})권(\d{1,4})호/);
  const serial = all.match(/일련번호[^\d\n]{0,2}(\d{1,10})/);

  // 공급자·공급받는자 경계: 두 번째 '등록번호' 라벨의 x, 없으면 두 번째 사업자번호의 x, 그것도 없으면 가운데
  const regLabels = rows.flatMap((r) => r.boxes.filter((b) => LABELS.bizNo!.test(key(b.text))));
  const bizBoxes = rows.flatMap((r) => r.boxes.filter((b) => bizIn(b.text)));
  let mid = 0.5;
  const firstRow = regLabels[0] ? rows.find((r) => r.boxes.includes(regLabels[0]!)) : null;
  const pairLabel = firstRow?.boxes.filter((b) => LABELS.bizNo!.test(key(b.text)))[1];
  if (pairLabel) mid = pairLabel.x - 0.01;
  else {
    const row = rows.find((r) => r.boxes.filter((b) => bizIn(b.text)).length >= 2);
    const two = row?.boxes.filter((b) => bizIn(b.text));
    if (two && two.length >= 2) mid = (two[0]!.x + two[0]!.w + two[1]!.x) / 2;
    else {
      const recv = rows.flatMap((r) => r.boxes).find((b) => /^공급받는/.test(key(b.text)));
      if (recv) mid = recv.x - 0.005;
    }
  }

  // 머리 영역 끝: '작성' 또는 '공급가액' 라벨이 있는 첫 줄
  const sumHead = rows.findIndex((r) => /작성|공급가액/.test(key(r.text)) && !/등록번호/.test(key(r.text)));
  const headerEnd = sumHead >= 0 ? rows[sumHead]!.y - 0.001 : 1;
  const sp = readParty(rows, { minX: 0, maxX: mid }, headerEnd);
  const bp = readParty(rows, { minX: mid, maxX: 1.01 }, headerEnd);
  // 칸 위치로 못 나눴으면 문서 순서대로 첫 번째·두 번째 번호
  if (!sp.party.bizNo || !bp.party.bizNo || sp.party.bizNo === bp.party.bizNo) {
    const seen = [...new Set(bizBoxes.map((b) => bizIn(b.text)!))];
    if (seen.length >= 2) {
      sp.party.bizNo = seen[0]!;
      bp.party.bizNo = seen[1]!;
      sp.conf.bizNo = Math.min(sp.conf.bizNo ?? 0.6, 0.6);
      bp.conf.bizNo = Math.min(bp.conf.bizNo ?? 0.6, 0.6);
    }
  }
  for (const [k, v] of Object.entries(sp.conf)) fc[`supplier.${k}`] = v;
  for (const [k, v] of Object.entries(bp.conf)) fc[`buyer.${k}`] = v;

  // 작성일자: 날짜 꼴, 없으면 '작성' 줄 아래(또는 그 줄)의 연·월·일 칸
  let writtenOn: string | null = null;
  const fullRe = /(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/;
  const scanFrom = Math.max(0, sumHead);
  for (const r of rows.slice(scanFrom, scanFrom + 4)) {
    const m = fullRe.exec(nfkc(r.text));
    if (m) writtenOn = validDay(+m[1]!, +m[2]!, +m[3]!, today);
    if (!writtenOn) {
      const nums = r.boxes.flatMap((b) => nfkc(b.text).trim().split(/\s+/)).filter((t) => /^\d{1,4}$/.test(t));
      const yi = nums.findIndex((t) => /^20\d{2}$/.test(t) || /^\d{2}$/.test(t));
      if (yi >= 0 && nums.length >= yi + 3) {
        const yy = nums[yi]!.length === 2 ? 2000 + +nums[yi]! : +nums[yi]!;
        writtenOn = validDay(yy, +nums[yi + 1]!, +nums[yi + 2]!, today);
      }
    }
    if (writtenOn) break;
  }
  if (!writtenOn) for (const r of rows) {
    const m = fullRe.exec(nfkc(r.text));
    const v = m ? validDay(+m[1]!, +m[2]!, +m[3]!, today) : null;
    if (v) {
      writtenOn = v;
      break;
    }
  }
  if (writtenOn) fc.writtenOn = sumHead >= 0 ? 0.85 : 0.6;

  // 공급가액·세액: 머리 아래 첫 금액 줄에서 10% 검산이 맞는 쌍. 없으면 문서 전체에서 가장 큰 맞는 쌍.
  const itemHead = rows.findIndex((r) => /품목/.test(key(r.text)));
  const totalRowIdx = rows.findIndex((r, i) => i > Math.max(itemHead, sumHead) && /합계금액|영수|청구/.test(key(r.text)));
  const summaryRows = rows.slice(Math.max(0, sumHead), itemHead > sumHead ? itemHead : Math.max(0, sumHead) + 3);
  let supplyAmount: number | null = null;
  let vatAmount: number | null = null;
  const pairIn = (ns: number[]): [number, number] | null => {
    let best: [number, number] | null = null;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (vatFits(ns[i]!, ns[j]!) && (!best || ns[i]! > best[0])) best = [ns[i]!, ns[j]!];
    return best;
  };
  for (const r of summaryRows) {
    const p = pairIn(amountsOf(r).map((a) => a.n));
    if (p) {
      [supplyAmount, vatAmount] = p;
      fc.supplyAmount = 0.9;
      fc.vatAmount = 0.9;
      break;
    }
  }
  if (supplyAmount === null && kind === 'tax_invoice') {
    const p = pairIn(rows.flatMap((r) => amountsOf(r).map((a) => a.n)));
    if (p) {
      [supplyAmount, vatAmount] = p;
      fc.supplyAmount = 0.6;
      fc.vatAmount = 0.6;
    }
  }

  // 합계금액
  let total: number | null = null;
  const totalRow = totalRowIdx >= 0 ? rows[totalRowIdx]! : rows.find((r) => /합계금액/.test(key(r.text)));
  const totalNums = totalRow ? amountsOf(totalRow).map((a) => a.n) : [];
  const nextNums = totalRow ? amountsOf(rows[rows.indexOf(totalRow) + 1] ?? { y: 0, boxes: [], text: '' }).map((a) => a.n) : [];
  const want = supplyAmount !== null ? supplyAmount + (vatAmount ?? 0) : null;
  const hit = [...totalNums, ...nextNums].find((n) => n === want);
  if (hit !== undefined) {
    total = hit;
    fc.total = 0.95;
    fc.supplyAmount = Math.max(fc.supplyAmount ?? 0, 0.9);
    if (vatAmount !== null) fc.vatAmount = Math.max(fc.vatAmount ?? 0, 0.9);
  } else if (want !== null) {
    total = want;
    fc.total = 0.7;
  } else if (totalNums.length || nextNums.length) {
    total = Math.max(...totalNums, ...nextNums);
    fc.total = 0.6;
  }
  // 계산서(면세): 세액 칸이 없다. 합계만 읽혔으면 공급가액 = 합계
  if (kind === 'invoice') {
    if (supplyAmount === null && total !== null) {
      supplyAmount = total;
      fc.supplyAmount = fc.total ?? 0.6;
    }
    vatAmount = 0;
    fc.vatAmount = 1;
    if (supplyAmount !== null && total === null) {
      total = supplyAmount;
      fc.total = fc.supplyAmount ?? 0.6;
    }
  }

  // 품목 줄: '품목' 머리 아래 ~ 합계 줄 위. 이름이 있고 금액이 있는 줄만
  const items: InvoiceItem[] = [];
  if (itemHead >= 0) {
    const end = totalRowIdx > itemHead ? totalRowIdx : rows.length;
    for (const r of rows.slice(itemHead + 1, end)) {
      if (items.length >= 20) break;
      const text = r.boxes.map((b) => b.text);
      const names = text.filter((t) => /[가-힣A-Za-z]/.test(t) && !ANY_LABEL.test(key(t)) && !/합계|영수|청구|현금|수표|어음|외상/.test(key(t)));
      const nums = amountsOf(r).map((a) => a.n);
      if (!names.length || !nums.length) continue;
      const lead = r.boxes.slice(0, 3).map((b) => nfkc(b.text).trim()).filter((t) => /^\d{1,2}$/.test(t)).map(Number);
      const money = nums.filter((n) => !(lead.includes(n) && n <= 31));
      let supply = money[money.length - 1] ?? 0;
      let vat: number | null = null;
      if (money.length >= 2 && vatFits(money[money.length - 2]!, money[money.length - 1]!)) {
        supply = money[money.length - 2]!;
        vat = money[money.length - 1]!;
      }
      if (kind === 'invoice') vat = null;
      if (!supply) continue;
      const rest = money.slice(0, vat === null ? -1 : -2);
      let qty: number | null = null;
      let unitPrice: number | null = null;
      for (let i = 0; i + 1 < rest.length; i++) if (rest[i]! * rest[i + 1]! === supply) [qty, unitPrice] = [rest[i]!, rest[i + 1]!];
      items.push({
        month: lead.length >= 2 && lead[0]! <= 12 ? lead[0]! : null,
        day: lead.length >= 2 && lead[1]! <= 31 ? lead[1]! : null,
        name: names[0]!.slice(0, 60),
        spec: names[1]?.slice(0, 30) ?? null,
        qty,
        unitPrice,
        supply,
        vat,
      });
    }
  }

  const bottom = rows.slice(Math.max(0, totalRowIdx)).map((r) => key(r.text)).join('');
  const hasR = /영수/.test(bottom);
  const hasC = /청구/.test(bottom);
  const receiptOrClaim = hasR !== hasC ? (hasR ? 'receipt' : 'claim') : null;
  if (receiptOrClaim) fc.receiptOrClaim = 0.5;

  return {
    copyOf,
    electronicCopy: approvalNo !== null,
    invoice: {
      docKind: kind,
      direction,
      writtenOn,
      approvalNo,
      bookNo: book ? `${book[1]}권 ${book[2]}호` : null,
      serialNo: serial ? serial[1]! : null,
      supplier: sp.party,
      buyer: bp.party,
      supplyAmount,
      vatAmount,
      total,
      items,
      receiptOrClaim,
      fieldConfidence: fc,
    },
  };
}

/** 서식 이름만 보고 세금계산서·계산서인지(촬영 뒤 영수증/세금계산서 화면을 고를 때) */
export function looksLikeInvoice(lines: string[]): InvoiceKind | null {
  const k = lines.map(key).join('\n');
  if (/세금계산서/.test(k)) return 'tax_invoice';
  if (/(?<!세금)계산서/.test(k) && /공급(받는)?자/.test(k)) return 'invoice';
  return null;
}

// ── 확인 화면 검산 ──
export type InvoiceIssue =
  | { field: 'total'; code: 'sum_mismatch'; expected: number }
  | { field: 'vatAmount'; code: 'vat_not_10pct' }
  | { field: 'supplier.bizNo' | 'buyer.bizNo'; code: 'biz_invalid' }
  | { field: 'buyer.bizNo'; code: 'same_party' }
  | { field: 'writtenOn'; code: 'day_invalid' }
  | { field: 'direction'; code: 'direction_required' }
  | { field: 'supplyAmount' | 'total'; code: 'amount_required' };

export function checkInvoice(inv: PaperInvoice, today = new Date()): InvoiceIssue[] {
  const out: InvoiceIssue[] = [];
  if (!inv.direction) out.push({ field: 'direction', code: 'direction_required' });
  if (inv.supplyAmount === null) out.push({ field: 'supplyAmount', code: 'amount_required' });
  if (inv.total === null) out.push({ field: 'total', code: 'amount_required' });
  if (inv.supplyAmount !== null && inv.total !== null) {
    const expected = inv.supplyAmount + (inv.vatAmount ?? 0);
    if (expected !== inv.total) out.push({ field: 'total', code: 'sum_mismatch', expected });
  }
  if (inv.docKind === 'tax_invoice' && inv.supplyAmount !== null && inv.vatAmount !== null && inv.vatAmount !== 0 && !vatFits(inv.supplyAmount, inv.vatAmount)) out.push({ field: 'vatAmount', code: 'vat_not_10pct' });
  for (const side of ['supplier', 'buyer'] as const) {
    const b = inv[side].bizNo;
    if (b && !validBizNo(b.replace(/\D/g, ''))) out.push({ field: `${side}.bizNo`, code: 'biz_invalid' });
  }
  if (inv.supplier.bizNo && inv.supplier.bizNo === inv.buyer.bizNo) out.push({ field: 'buyer.bizNo', code: 'same_party' });
  if (inv.writtenOn) {
    const [y, m, d] = inv.writtenOn.split('-').map(Number) as [number, number, number];
    if (!validDay(y, m, d, today)) out.push({ field: 'writtenOn', code: 'day_invalid' });
  }
  return out;
}

/** 검산 문구(칸 아래에 남긴다). 영세율(세액 0)은 막지 않는다 */
export function issueText(i: InvoiceIssue): string {
  switch (i.code) {
    case 'sum_mismatch':
      return `공급가액과 세액을 더하면 ${i.expected.toLocaleString('ko-KR')}원이에요. 합계를 확인해 주세요.`;
    case 'vat_not_10pct':
      return '세액이 공급가액의 10%와 달라요. 종이에 적힌 대로면 그대로 두세요.';
    case 'biz_invalid':
      return '등록번호가 맞지 않아요. 한 자리씩 확인해 주세요.';
    case 'same_party':
      return '공급자와 공급받는자 등록번호가 같아요.';
    case 'day_invalid':
      return '작성일자가 맞지 않아요.';
    case 'direction_required':
      return '받은 것인지 발급한 것인지 골라 주세요.';
    case 'amount_required':
      return '금액을 적어 주세요.';
  }
}

/** 막는 문제(보내기 전에 꼭 고칠 것). 세액 10% 불일치는 알리기만 한다(영세율·종이에 적힌 값 그대로 보낼 수 있다) */
export const blocking = (i: InvoiceIssue) => i.code !== 'vat_not_10pct';

/**
 * receipt.v1 candidates(합의 전 PC도 읽는 4칸)로 줄인다. 상대 쪽(매입이면 공급자, 매출이면 공급받는자)을 상호·번호로.
 * receipt.v2를 아는 PC에는 paperInvoice 전체를 함께 보낸다(@sax/remote 동기화 뒤).
 */
export function toV1Candidates(inv: PaperInvoice): { amount?: number; issuedOn?: string; merchant?: string; merchantBizNo?: string } {
  const other = inv.direction === 'sales' ? inv.buyer : inv.supplier;
  const c: { amount?: number; issuedOn?: string; merchant?: string; merchantBizNo?: string } = {};
  if (inv.total !== null && inv.total > 0) c.amount = inv.total;
  if (inv.writtenOn) c.issuedOn = inv.writtenOn;
  if (other.name) c.merchant = other.name.slice(0, 80);
  if (other.bizNo) c.merchantBizNo = other.bizNo;
  return c;
}
