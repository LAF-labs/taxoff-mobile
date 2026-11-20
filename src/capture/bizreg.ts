// 사업자등록증 읽기(기획 v2 PR 7): 기기 안 OCR 줄 → 상호·등록번호·대표자·사업장 주소·업태·종목 후보와 확신(0~1).
// 값은 후보일 뿐이고 사장님이 확인한다. 라벨 글자 사이 띄어쓰기("상 호", "대 표 자")와 법인 서식("법인명(단체명)")을 받는다.
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
  /** 글자를 거의 못 읽었다(흐리거나 어둡거나 등록증이 아님) */
  poor: boolean;
}

/** 이 값보다 낮으면 "확인해 주세요" */
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
/** 라벨 뒤 값: "상 호 : 가나식자재" → "가나식자재" (라벨 글자 수만큼 띄어쓰기 없는 글자를 건너뛴다) */
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
    // "사업의 종류 : 업태 … 종목 …" 서식은 앞 라벨을 떼고 업태부터 읽는다
    if (squash(line).startsWith('사업의종류')) line = after(line, '사업의종류');
    const sq = squash(line);
    for (const { key, re } of LABELS) {
      const m = re.exec(sq);
      if (!m || fields[key]) continue;
      let v = after(line, m[0]);
      if (key === 'bizType') {
        // "업태 도매 및 소매업 종목 식자재"처럼 한 줄에 둘이 오는 서식
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
        // 주소는 다음 줄로 이어지기도 한다(라벨이 없는 줄이면 붙인다)
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
  // 라벨 없이 번호만 보이는 경우
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
