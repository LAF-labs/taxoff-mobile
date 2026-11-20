import { validBizNo } from './parser.ts';

export interface BizRegFields {
  name: string;
  bizNo: string;
  ceo: string;
  address: string;
  bizType: string;
  item: string;
}
export type BizRegKey = keyof BizRegFields;

interface BizRegRead {
  fields: BizRegFields;
  conf: Record<BizRegKey, number>;
  poor: boolean;
}

export const UNSURE_BELOW = 0.6;

const LABELS: Array<{ key: BizRegKey; re: RegExp }> = [
  { key: 'bizNo', re: /^(등록번호|사업자등록번호)/ },
  { key: 'name', re: /^(상호|법인명\(단체명\)|법인명)/ },
  { key: 'ceo', re: /^(대표자|성명)/ },
  { key: 'address', re: /^(사업장소재지|사업장주소|소재지)/ },
  { key: 'bizType', re: /^업태/ },
  { key: 'item', re: /^종목/ },
];
const ANY_LABEL = /^(등록번호|사업자등록번호|상호|법인명|대표자|성명|생년월일|개업연월일|법인등록번호|사업장소재지|사업장주소|소재지|본점소재지|사업의종류|업태|종목|발급사유|공동사업자|사업자단위과세|전자세금계산서|\d{4}년)/;

const squash = (s: string) => s.replace(/\s+/g, '');
function after(line: string, label: string): string {
  let i = 0;
  let n = 0;
  while (i < line.length && n < label.length) {
    if (!/\s/.test(line[i]!)) n++;
    i++;
  }
  return line.slice(i).replace(/^\s*[:：]?\s*/, '').trim();
}

export function formatBizNo(d: string): string {
  const x = d.replace(/\D/g, '').slice(0, 10);
  return [x.slice(0, 3), x.slice(3, 5), x.slice(5)].filter(Boolean).join('-');
}

export function parseBizReg(lines: string[]): BizRegRead {
  const fields: BizRegFields = { name: '', bizNo: '', ceo: '', address: '', bizType: '', item: '' };
  const conf: Record<BizRegKey, number> = { name: 0, bizNo: 0, ceo: 0, address: 0, bizType: 0, item: 0 };
  const ls = lines.map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < ls.length; i++) {
    let line = ls[i]!;
    if (squash(line).startsWith('사업의종류')) line = after(line, '사업의종류');
    const sq = squash(line);
    for (const { key, re } of LABELS) {
      const m = re.exec(sq);
      if (!m || fields[key]) continue;
      let v = after(line, m[0]);
      if (key === 'bizType') {
        const j = v.search(/종\s*목/);
        if (j >= 0) {
          const rest = after(v.slice(j), '종목');
          v = v.slice(0, j).trim();
          if (rest && !fields.item) {
            fields.item = rest;
            conf.item = 0.85;
          }
        }
      }
      if (key === 'bizNo') {
        const d = (/(\d{3})\s*-?\s*(\d{2})\s*-?\s*(\d{5})/.exec(v) ?? []).slice(1).join('');
        fields.bizNo = d ? formatBizNo(d) : '';
        conf.bizNo = d ? (validBizNo(d) ? 0.95 : 0.4) : 0;
      } else if (key === 'address') {
        const next = ls[i + 1];
        const cont = next && !ANY_LABEL.test(squash(next)) ? ` ${next.trim()}` : '';
        fields.address = (v + cont).trim();
        conf.address = v ? (cont ? 0.7 : 0.85) : 0;
      } else {
        fields[key] = v;
        conf[key] = v ? 0.85 : 0;
      }
      break;
    }
  }
  if (!fields.bizNo) {
    for (const l of ls) {
      const m = /(?<!\d)(\d{3})-(\d{2})-(\d{5})(?!\d)/.exec(l);
      if (m) {
        const d = m.slice(1).join('');
        fields.bizNo = formatBizNo(d);
        conf.bizNo = validBizNo(d) ? 0.7 : 0.4;
        break;
      }
    }
  }
  const chars = ls.join('').replace(/\s/g, '').length;
  return { fields, conf, poor: chars < 20 || (!fields.name && !fields.bizNo) };
}
