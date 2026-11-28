/**
 * 종이 세금계산서와 계산서 사진에서 읽은 글자 상자(OcrBox)로 칸을 채운다. 폰(iOS Vision)과 PC(macOS Vision, Windows OCR, 앱 안 tesseract)가 같은 규칙을 쓴다(ADR-073).
 * 상자 좌표는 그림 크기에 대한 0~1 비율이다(왼쪽 위가 0). 결과는 후보다: 사장님이 확인한 값만 장부에 들어가고, 보낼 때는 checkPaperInvoice를 다시 거친다.
 */
import { bizNoValid as validBizNo } from './transfer.ts';

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;
  /** 글자 읽기가 한 줄(관찰)로 낸 낱말끼리 같은 값. 값을 이을 때 띄어 쓴다(macOS Vision 낱말 상자, Windows OCR 줄) */
  group?: number;
}

export type InvoiceKind = 'tax_invoice' | 'invoice';
export type PaperDirection = 'sales' | 'purchase';

export interface PaperPartyDraft {
  bizNo: string | null;
  name: string | null;
  ceo: string | null;
  address: string | null;
}

export interface PaperItemDraft {
  month: number | null;
  day: number | null;
  name: string;
  spec: string | null;
  qty: number | null;
  unitPrice: number | null;
  supply: number;
  vat: number | null;
}

export interface PaperInvoiceDraft {
  docKind: InvoiceKind;
  direction: PaperDirection | null;
  writtenOn: string | null;
  approvalNo: string | null;
  bookNo: string | null;
  serialNo: string | null;
  supplier: PaperPartyDraft;
  buyer: PaperPartyDraft;
  supplyAmount: number | null;
  vatAmount: number | null;
  total: number | null;
  items: PaperItemDraft[];
  receiptOrClaim: 'receipt' | 'claim' | null;
  fieldConfidence: Record<string, number>;
}

export type PaperCopyOf = 'supplier' | 'buyer' | null;

export interface PaperRead {
  invoice: PaperInvoiceDraft;
  copyOf: PaperCopyOf;
  electronicCopy: boolean;
}

const nfkc = (s: string) => s.normalize('NFKC');
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

/** 낱말 상자. 한 관찰 상자에서 나눈 낱말은 group이 같다(그 사이는 글자 읽기가 띄어 쓴 자리다) */
type WordBox = OcrBox;

interface Row {
  y: number;
  boxes: WordBox[];
  text: string;
}

/** 글자 폭 어림(한글 한 자 = 1) */
const charWidth = (c: string) => (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff]/.test(c) ? 1 : /[,.:;'`|]/.test(c) ? 0.3 : /[()[\]\-–]/.test(c) ? 0.4 : /\s/.test(c) ? 0.5 : 0.6);

/**
 * 여러 낱말이 한 상자로 온 것을 낱말 상자로 나눈다. macOS와 iOS Vision은 줄 하나나 표의 이웃 칸 몇 개를 한 관찰로 낸다
 * ("2026 10 28 300,000 30,000", "123-99-45678 등록번호 456-99-12345"). 칸 규칙은 낱말 상자(tesseract, Windows OCR)를 보고 짰으니
 * 나눠야 금액 칸이 붙지 않고 오른쪽 사업자번호를 잃지 않는다. 자리는 글자 폭 어림으로 나눈다.
 */
function splitWords(boxes: OcrBox[]): WordBox[] {
  const out: WordBox[] = [];
  boxes.forEach((b, i) => {
    const group = b.group ?? 1_000_000 + i;
    const text = nfkc(b.text).trim();
    const words = [...text.matchAll(/\S+/g)];
    if (words.length <= 1) {
      out.push({ ...b, text });
      return;
    }
    const at: number[] = [0];
    for (const c of text) at.push(at[at.length - 1]! + charWidth(c));
    const unit = b.w / at[at.length - 1]!;
    const pos = (i: number) => at[[...text.slice(0, i)].length]!;
    for (const m of words) {
      const x0 = pos(m.index);
      out.push({ text: m[0], x: b.x + x0 * unit, y: b.y, w: (pos(m.index + m[0].length) - x0) * unit, h: b.h, ...(b.conf !== undefined ? { conf: b.conf } : {}), group });
    }
  });
  return out;
}

export function toRows(boxes: OcrBox[]): Row[] {
  const bs = splitWords(boxes.filter((b) => b.text.trim()));
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
    r.boxes = joinSplitLabels(r.boxes.sort((a, b) => a.x - b.x));
    r.text = r.boxes.map((b) => b.text).join(' ');
  }
  return rows.sort((a, b) => a.y - b.y);
}

const WHOLE_LABEL = /^(사업자등록번호|등록번호|상호법인명|상호|법인명|성명대표자|대표자성명|성명|대표자|사업장주소|업태|종목|공급받는자|공급자|합계금액|공급가액|세액|품목|작성일자|작성)$/;

/**
 * 글자마다 상자가 따로 온 칸 이름을 한 상자로 붙인다. PC 앱 안 읽기(tesseract)는 표 칸의 "상호(법인명)"을 "상", "호", "(", "법", "인", "명)"처럼 글자마다 낸다.
 * 붙인 글이 칸 이름과 똑같을 때만 붙이고(가장 긴 것), 사이가 글자 높이의 1.5배보다 벌어지면 붙이지 않는다. 값 칸의 글자는 건드리지 않는다.
 */
function joinSplitLabels(boxes: WordBox[]): WordBox[] {
  const out: WordBox[] = [];
  for (let i = 0; i < boxes.length; ) {
    let best = 0;
    let text = boxes[i]!.text;
    for (let j = i + 1; j < Math.min(boxes.length, i + 8); j++) {
      const prev = boxes[j - 1]!;
      const b = boxes[j]!;
      if (b.x - (prev.x + prev.w) > Math.max(prev.h, b.h) * 1.5) break;
      text += b.text;
      if (WHOLE_LABEL.test(key(text))) best = j;
    }
    if (!best) {
      out.push(boxes[i]!);
      i++;
      continue;
    }
    const run = boxes.slice(i, best + 1);
    const x = Math.min(...run.map((b) => b.x));
    const y = Math.min(...run.map((b) => b.y));
    out.push({ text: run.map((b) => b.text).join(''), x, y, w: Math.max(...run.map((b) => b.x + b.w)) - x, h: Math.max(...run.map((b) => b.y + b.h)) - y });
    i = best + 1;
  }
  return out;
}

/** 지운 표 선이 남아 글자로 읽힌 것("|", "_", "[") */
const LINE_DEBRIS = /^[|_[\]ᅵ¦]+$/;

export function linesToBoxes(lines: string[]): OcrBox[] {
  const n = Math.max(lines.length, 1);
  return lines.map((text, i) => ({ text, x: 0, y: i / n, w: 1, h: 0.8 / n }));
}

const won = (s: string): number | null => {
  const t = nfkc(s).replace(/[\s원₩\\]/g, '');
  if (!/^-?(\d{1,3}([,.]\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/[,.]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_000 ? n : null;
};

/** 줄의 금액. x는 왼쪽 끝, r은 오른쪽 끝(표의 금액은 칸 오른쪽에 붙어 찍힌다) */
function amountsOf(row: Row): { n: number; x: number; r: number }[] {
  const out: { n: number; x: number; r: number }[] = [];
  let run: WordBox[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const n = won(run.map((b) => b.text).join(''));
      const last = run[run.length - 1]!;
      if (n !== null) out.push({ n, x: run[0]!.x, r: last.x + last.w });
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
      if (n !== null) out.push({ n, x: b.x, r: b.x + b.w });
    }
  }
  flush();
  return out;
}

/**
 * 머리 줄 칸 이름(공급가액, 세액 / 합계금액, 현금, …) 가운데 값이 든 칸. 금액은 칸 오른쪽에 붙어 찍히고 칸 이름은 가운데라,
 * 값의 오른쪽 끝보다 왼쪽에서 시작하는 칸 이름 가운데 가장 오른쪽 것이다. 작성 년 월 일처럼 첫 칸 이름보다 왼쪽에서 끝나는 값은 어느 칸도 아니다
 */
function columnOf(heads: WordBox[], right: number): string | null {
  let best: WordBox | null = null;
  for (const h of heads) if (h.x <= right && (!best || h.x > best.x)) best = h;
  return best ? key(best.text) : null;
}

/**
 * 세로로 찍힌 "공급자", "공급받는자" 칸 이름을 뺀다. Vision은 글자마다 상자를 내서, 빼지 않으면 같은 높이 줄의 값 끝에 "급", "는"이 붙는다.
 * 같은 세로줄에 쌓인 한 글자 상자가 공급받는자 글자를 차례대로 셋 넘게 이루면 칸 이름이다. 받는자 쪽은 공급받는자 칸이 시작하는 자리다
 */
function verticalSideLabels(boxes: OcrBox[]): { rest: OcrBox[]; buyerX: number | null } {
  const singles = boxes.map((b, i) => ({ b, i, t: nfkc(b.text).trim(), cx: b.x + b.w / 2 })).filter((o) => /^[공급받는자]$/.test(o.t));
  const used = new Set<number>();
  let buyerX: number | null = null;
  for (const s of singles) {
    if (used.has(s.i)) continue;
    const col = singles.filter((o) => !used.has(o.i) && Math.abs(o.cx - s.cx) <= Math.max(o.b.w, s.b.w)).sort((a, b) => a.b.y - b.b.y);
    const run = [col[0]!];
    for (const o of col.slice(1)) if (o.b.y - (run[run.length - 1]!.b.y + run[run.length - 1]!.b.h) <= o.b.h * 2.5) run.push(o);
    const word = run.map((o) => o.t).join('');
    if (word.length < 3 || !/^공?급?받?는?자?$/.test(word)) continue;
    for (const o of run) used.add(o.i);
    if (/[받는]/.test(word)) buyerX = Math.min(buyerX ?? 1, ...run.map((o) => o.b.x));
  }
  return { rest: used.size ? boxes.filter((_, i) => !used.has(i)) : boxes, buyerX };
}

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

const tidyPartyValue = (s: string): string | null => {
  const t = nfkc(s).replace(/\p{Cc}/gu, '').replace(/^[\s:：|]+|[\s:：|]+$/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 1 || /^\d+$/.test(t) || ANY_LABEL.test(key(t))) return null;
  return t;
};

const LABEL_HEAD = /^(사업자등록번호|등록번호|사업자번호|상호법인명|상호|법인명|성명대표자|대표자성명|성명|대표자|사업장주소|사업장|주소|업태|종목)/;
const LABEL_HEAD_RAW = /^[\s(]*(사업자\s*등록\s*번호|등\s*록\s*번\s*호|사업자\s*번호|상\s*호\s*\(?\s*법\s*인\s*명\s*\)?|상\s*호|법\s*인\s*명|성\s*명\s*\(?\s*대\s*표\s*자\s*\)?|대\s*표\s*자(\s*성\s*명)?|성\s*명|사\s*업\s*장\s*주\s*소|사\s*업\s*장|주\s*소|업\s*태|종\s*목)[\s):：]*/;

/**
 * 칸 이름의 괄호 꼬리를 잘못 읽은 것("상호" 다음의 "(범인명)", "(대표지)"). 괄호로 싸였고, 법인명, 대표자, 성명 가운데 하나와 두 글자 넘게 같다.
 * 상호 값으로 잡지 않는다. "(주)"처럼 한 글자는 꼬리로 보지 않는다
 */
const LABEL_TAILS = ['법인명', '대표자', '성명'];
function labelTail(s: string): boolean {
  const raw = nfkc(s).trim();
  if (!/^[(（]/.test(raw) && !/[)）]$/.test(raw)) return false;
  const t = key(raw);
  return t.length >= 2 && t.length <= 4 && LABEL_TAILS.some((w) => [...w].filter((c) => t.includes(c)).length >= 2);
}

function valueRight(row: Row, label: WordBox, maxX: number): string | null {
  if (key(label.text).replace(LABEL_HEAD, '').length >= 1) {
    const m = nfkc(label.text).match(LABEL_HEAD_RAW);
    const rest = m ? nfkc(label.text).slice(m[0].length).trim() : '';
    // 칸 이름에 붙어 온 괄호 꼬리("상호(범인영)")는 값이 아니다
    if (rest && !labelTail(rest) && !/^[(（][^()（）]{1,5}[)）]$/.test(rest)) return rest;
  }
  const parts: WordBox[] = [];
  for (const b of row.boxes) {
    if (b.x <= label.x + label.w * 0.5 || b.x >= maxX || LINE_DEBRIS.test(b.text)) continue;
    if (ANY_LABEL.test(key(b.text))) break;
    if (!parts.length && labelTail(b.text)) continue;
    parts.push(b);
  }
  // 한 관찰에서 나눈 낱말은 읽은 대로 띄운다. 글자마다 따로 온 상자("대", "한", "식자재")는 띄우지 않고 붙이고, 글자 높이의 절반보다 벌어졌으면 띄운다
  const gap = (a: WordBox, b: WordBox) => (a.group !== undefined && a.group === b.group) || b.x - (a.x + a.w) > Math.max(b.h, a.h) * 0.5;
  return parts.length ? parts.map((b, i) => (i && gap(parts[i - 1]!, b) ? ' ' : '') + b.text).join('') : null;
}

interface Side {
  minX: number;
  maxX: number;
}

function readParty(rows: Row[], side: Side, headerEnd: number): { party: PaperPartyDraft; conf: Record<string, number> } {
  const party: PaperPartyDraft = { bizNo: null, name: null, ceo: null, address: null };
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
          const t = tidyPartyValue(v);
          if (t) {
            party[field] = t.slice(0, field === 'address' ? 120 : 60);
            conf[field] = 0.8;
          }
        }
      }
    }
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

export function parsePaperInvoice(boxes: OcrBox[], today = new Date()): PaperRead | null {
  const side = verticalSideLabels(boxes);
  const rows = toRows(side.rest);
  if (!rows.length) return null;
  const all = rows.map((r) => key(r.text)).join('\n');
  const kind: InvoiceKind | null = /세금계산서/.test(all) ? 'tax_invoice' : /계산서/.test(all) ? 'invoice' : null;
  if (!kind) return null;
  const fc: Record<string, number> = {};

  const copyOf: PaperCopyOf = /공급받는자보관용/.test(all) ? 'buyer' : /공급자보관용/.test(all) ? 'supplier' : null;
  const direction: PaperDirection | null = copyOf === 'buyer' ? 'purchase' : copyOf === 'supplier' ? 'sales' : null;
  if (direction) fc.direction = 0.85;

  const appr = nfkc(rows.map((r) => r.text).join(' ')).match(/(?<!\d)(\d{8})\s*-\s*(\d{8})\s*-\s*(\d{8})(?!\d)/);
  const approvalNo = appr ? `${appr[1]}-${appr[2]}-${appr[3]}` : null;

  const book = all.match(/책번호(\d{1,4})권(\d{1,4})호/);
  const serial = all.match(/일련번호[^\d\n]{0,2}(\d{1,10})/);

  const regLabels = rows.flatMap((r) => r.boxes.filter((b) => LABELS.bizNo!.test(key(b.text))));
  const bizBoxes = rows.flatMap((r) => r.boxes.filter((b) => bizIn(b.text)));
  let mid = 0.5;
  const firstRow = regLabels[0] ? rows.find((r) => r.boxes.includes(regLabels[0]!)) : null;
  const pairLabel = firstRow?.boxes.filter((b) => LABELS.bizNo!.test(key(b.text)))[1];
  if (side.buyerX !== null) mid = Math.min(side.buyerX, pairLabel?.x ?? 1) - 0.005;
  else if (pairLabel) mid = pairLabel.x - 0.01;
  else {
    const row = rows.find((r) => r.boxes.filter((b) => bizIn(b.text)).length >= 2);
    const two = row?.boxes.filter((b) => bizIn(b.text));
    if (two && two.length >= 2) mid = (two[0]!.x + two[0]!.w + two[1]!.x) / 2;
    else {
      const recv = rows.flatMap((r) => r.boxes).find((b) => /^공급받는/.test(key(b.text)));
      if (recv) mid = recv.x - 0.005;
    }
  }

  const sumHead = rows.findIndex((r) => /작성|공급가액/.test(key(r.text)) && !/등록번호/.test(key(r.text)));
  const headerEnd = sumHead >= 0 ? rows[sumHead]!.y - 0.001 : 1;
  const sp = readParty(rows, { minX: 0, maxX: mid }, headerEnd);
  const bp = readParty(rows, { minX: mid, maxX: 1.01 }, headerEnd);
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

  const itemHead = rows.findIndex((r) => /품목/.test(key(r.text)));
  const totalRowIdx = rows.findIndex((r, i) => i > Math.max(itemHead, sumHead) && /합계금액|영수|청구/.test(key(r.text)));
  const summaryRows = rows.slice(Math.max(0, sumHead), itemHead > sumHead ? itemHead : Math.max(0, sumHead) + 3);
  let supplyAmount: number | null = null;
  let vatAmount: number | null = null;
  const pairIn = (ns: number[], sum?: number): [number, number] | null => {
    let best: [number, number] | null = null;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (vatFits(ns[i]!, ns[j]!) && (sum === undefined || ns[i]! + ns[j]! === sum) && (!best || ns[i]! > best[0])) best = [ns[i]!, ns[j]!];
    return best;
  };
  // 작성 줄 금액에서 작성 년 월 일(2026, 10, 15)로 읽은 수는 왼쪽부터 하나씩 뺀다. 금액으로 보지 않는다
  const dateParts = writtenOn ? [Number(writtenOn.slice(0, 4)), Number(writtenOn.slice(5, 7)), Number(writtenOn.slice(8, 10))] : [];
  const sumAmounts = summaryRows.map((r) => {
    const left = [...dateParts];
    return amountsOf(r)
      .sort((p, q) => p.x - q.x)
      .filter((a) => {
        if (!left.length || !(a.n === left[0] || (left.length === 3 && a.n === left[0]! % 100))) return true;
        left.shift();
        return false;
      });
  });
  // 1. 한 줄에서 10%가 맞는 두 금액(세금계산서) 2. 머리 줄 칸 이름(공급가액, 세액) 아래 값 3. 계산서는 남은 가장 큰 금액
  if (kind === 'tax_invoice') {
    // 사진이 기울면 같은 줄의 공급가액과 세액이 두 줄로 갈린다. 줄마다 본 뒤 작성 줄들을 함께 본다
    for (const r of [...sumAmounts, sumAmounts.flat()]) {
      const p = pairIn(r.map((a) => a.n));
      if (p) {
        [supplyAmount, vatAmount] = p;
        fc.supplyAmount = 0.9;
        fc.vatAmount = 0.9;
        break;
      }
    }
  }
  const sumHeads = sumHead >= 0 ? rows[sumHead]!.boxes.filter((b) => /^(작성일자|작성|공급가액|세액|비고)$/.test(key(b.text))) : [];
  if (supplyAmount === null && sumHeads.some((h) => key(h.text) === '공급가액')) {
    const inCol = (name: string) => sumAmounts.flat().find((a) => columnOf(sumHeads, a.r) === name)?.n;
    const s = inCol('공급가액');
    const v = kind === 'tax_invoice' ? inCol('세액') : undefined;
    if (s !== undefined) {
      supplyAmount = s;
      fc.supplyAmount = 0.8;
    }
    if (v !== undefined) {
      vatAmount = v;
      fc.vatAmount = 0.6;
    }
  }
  if (supplyAmount === null && kind === 'invoice') {
    const ns = sumAmounts.flat().map((a) => a.n).filter((n) => n > 0);
    if (ns.length) {
      supplyAmount = Math.max(...ns);
      fc.supplyAmount = 0.7;
    }
  }

  // 합계금액: 머리 줄(합계금액, 현금, 수표, 어음, 외상미수금) 아래 합계금액 칸의 값. "이 금액을 영수 함"이 두 줄 사이에 끼면 그 아래다
  const totalRow = totalRowIdx >= 0 ? rows[totalRowIdx]! : rows.find((r) => /합계금액/.test(key(r.text)));
  const totalAt = totalRow ? rows.indexOf(totalRow) : -1;
  const totalHeads = totalRow ? totalRow.boxes.filter((b) => /^(합계금액|현금|수표|어음|외상미수금)$/.test(key(b.text))) : [];
  const below = totalRow ? [0, 1, 2].flatMap((k) => (rows[totalAt + k] ? amountsOf(rows[totalAt + k]!) : [])) : [];
  const printed = totalHeads.some((h) => key(h.text) === '합계금액') ? (below.find((a) => columnOf(totalHeads, a.r) === '합계금액')?.n ?? null) : null;
  const belowNums = below.map((a) => a.n);
  // 세금계산서의 세액을 못 읽었으면 공급가액만으로 합계를 짓지 않는다
  const want = supplyAmount !== null && (vatAmount !== null || kind === 'invoice') ? supplyAmount + (vatAmount ?? 0) : null;
  let total: number | null = null;
  const boost = () => {
    fc.supplyAmount = Math.max(fc.supplyAmount ?? 0, 0.9);
    if (vatAmount !== null) fc.vatAmount = Math.max(fc.vatAmount ?? 0, 0.9);
  };
  if (printed !== null) {
    total = printed;
    fc.total = 0.85;
    if (want === printed) {
      fc.total = 0.95;
      boost();
    } else if (kind === 'tax_invoice' && supplyAmount !== null && vatAmount === null && vatFits(supplyAmount, printed - supplyAmount)) {
      // 세액 칸을 못 읽었으면 합계에서 공급가액을 뺀 값이 10%에 맞을 때만 세액으로 둔다
      vatAmount = printed - supplyAmount;
      fc.vatAmount = 0.7;
    } else if (kind === 'tax_invoice' && supplyAmount === null) {
      const p = pairIn(rows.flatMap((r) => amountsOf(r).map((a) => a.n)), printed);
      if (p) {
        [supplyAmount, vatAmount] = p;
        fc.supplyAmount = 0.7;
        fc.vatAmount = 0.7;
      }
    } else if (want !== null) {
      // 공급가액 + 세액과 찍힌 합계가 다르면 고치지 않고 둘 다 낮은 확신으로 둔다(검산이 사장님께 알린다)
      fc.total = 0.6;
      fc.supplyAmount = Math.min(fc.supplyAmount ?? 0.6, 0.6);
      if (vatAmount !== null) fc.vatAmount = Math.min(fc.vatAmount ?? 0.6, 0.6);
    }
  } else {
    const hit = belowNums.find((n) => n === want);
    const fit = kind === 'tax_invoice' && supplyAmount !== null && vatAmount === null ? belowNums.find((n) => vatFits(supplyAmount!, n - supplyAmount!)) : undefined;
    if (hit !== undefined) {
      total = hit;
      fc.total = 0.95;
      boost();
    } else if (fit !== undefined) {
      total = fit;
      vatAmount = fit - supplyAmount!;
      fc.total = 0.8;
      fc.vatAmount = 0.7;
    } else if (want !== null) {
      total = want;
      fc.total = 0.7;
    } else if (belowNums.length) {
      total = Math.max(...belowNums);
      fc.total = 0.6;
    }
  }
  if (supplyAmount === null && kind === 'tax_invoice' && total === null) {
    const p = pairIn(rows.flatMap((r) => amountsOf(r).map((a) => a.n)));
    if (p) {
      [supplyAmount, vatAmount] = p;
      fc.supplyAmount = 0.6;
      fc.vatAmount = 0.6;
      total = p[0] + p[1];
      fc.total = 0.6;
    }
  }
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

  const items: PaperItemDraft[] = [];
  if (itemHead >= 0) {
    const end = totalRowIdx > itemHead ? totalRowIdx : rows.length;
    for (const r of rows.slice(itemHead + 1, end)) {
      if (items.length >= 20) break;
      // 품목 칸 글은 한 관찰에서 나눈 낱말("원두 1kg")이면 다시 붙인다
      const names: string[] = [];
      let prev: WordBox | null = null;
      for (const b of r.boxes) {
        const t = b.text;
        const isName = /[가-힣A-Za-z]/.test(t) && !ANY_LABEL.test(key(t)) && !/합계|영수|청구|현금|수표|어음|외상/.test(key(t));
        if (isName && prev && prev.group !== undefined && prev.group === b.group) names[names.length - 1] += ` ${t}`;
        else if (isName) names.push(t);
        prev = isName ? b : null;
      }
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

export function looksLikeInvoice(lines: string[]): InvoiceKind | null {
  const k = lines.map(key).join('\n');
  if (/세금계산서/.test(k)) return 'tax_invoice';
  if (/(?<!세금)계산서/.test(k) && /공급(받는)?자/.test(k)) return 'invoice';
  return null;
}

export type PaperDraftIssue =
  | { field: 'total'; code: 'sum_mismatch'; expected: number }
  | { field: 'vatAmount'; code: 'vat_not_10pct' }
  | { field: 'supplier.bizNo' | 'buyer.bizNo'; code: 'biz_invalid' }
  | { field: 'buyer.bizNo'; code: 'same_party' }
  | { field: 'writtenOn'; code: 'day_invalid' }
  | { field: 'direction'; code: 'direction_required' }
  | { field: 'supplyAmount' | 'total'; code: 'amount_required' }
  | { field: 'writtenOn' | 'supplier.bizNo' | 'buyer.bizNo' | 'supplier.name' | 'buyer.name'; code: 'required' };

export function checkPaperDraft(inv: PaperInvoiceDraft, today = new Date()): PaperDraftIssue[] {
  const out: PaperDraftIssue[] = [];
  if (!inv.direction) out.push({ field: 'direction', code: 'direction_required' });
  if (!inv.writtenOn) out.push({ field: 'writtenOn', code: 'required' });
  for (const side of ['supplier', 'buyer'] as const) {
    if (!inv[side].bizNo) out.push({ field: `${side}.bizNo`, code: 'required' });
    if (!inv[side].name) out.push({ field: `${side}.name`, code: 'required' });
  }
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
