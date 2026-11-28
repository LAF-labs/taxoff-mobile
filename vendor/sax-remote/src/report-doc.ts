/**
 * 월 리포트 PDF 한 벌(ADR-068 결정 11). 화면을 찍지 않고 리포트 값으로 직접 그린다. 모양은 PC 리포트 화면의 카드 그대로다(밝은 색).
 * PC(Electron printToPDF)와 폰(WKWebView createPDF)이 같은 함수를 쓴다. 그래서 두 PDF는 같은 모양이다.
 * 계좌는 은행과 끝 4자리만, 입금자 이름과 통장 표시 원문은 받지도 그리지도 않는다.
 * 순수 함수다(DOM, 네트워크 없음). 스크립트를 넣지 않는다.
 */

/** 한 줄 값. null이면 그 자료를 받지 못했다(확인 못 함) */
export type DocAmount = number | null;

export interface ReportDocLine {
  label: string;
  amount: DocAmount;
  partial?: boolean;
  /** 구성 카드에 붙는 건수 */
  count?: number;
  /** 값이 없을 때 대신 쓰는 글("12월 16일쯤 들어와요") */
  note?: string;
}

export interface ReportDocRank {
  name: string;
  count: number;
  amount: number;
  share?: number;
}

export interface ReportDocPartners {
  rows: ReportDocRank[];
  /** n = 묶인 거래처 수 */
  rest: (ReportDocRank & { n: number }) | null;
  total: number;
  count: number;
}

export interface ReportDoc {
  bizName: string;
  bizNo: string | null;
  /** 기간 글("2026년 11월", "2026년 9월부터 11월") */
  period: string;
  /** 만든 시각 글("2026년 11월 24일 20:52") */
  made: string;
  /** 자료가 어디까지인지("11월 24일까지"). null이면 그 줄을 쓰지 않는다 */
  bankTo: string | null;
  hometaxTo: string | null;
  sales: ReportDocLine[];
  salesTotal: ReportDocLine;
  purchase: ReportDocLine[];
  purchaseTotal: ReportDocLine;
  bank: { in: number; out: number; net: number };
  /** 달마다(오래된 달이 앞). on = 고른 기간 안 */
  months: Array<{ label: string; on: boolean; sales: DocAmount; purchase: DocAmount; in: number; out: number }>;
  /** 순위. null이면 이 기간 순위를 받지 못했다(폰 사본은 마지막 달에서 끝나는 기간만 싣는다). 그 묶음을 그리지 않는다 */
  partnersSale: ReportDocPartners | null;
  partnersPurchase: ReportDocPartners | null;
  itemsSale: ReportDocRank[] | null;
  bankOut: Array<{ label: string; amount: number }>;
  bankIn: Array<{ label: string; amount: number }>;
  balances: Array<{ label: string; amount: number | null }>;
  balanceDay: string | null;
  /** 화면과 같은 글: "지난달보다 3% 늘었어요". 없으면 쓰지 않는다 */
  salesTrend?: string | null;
  purchaseTrend?: string | null;
  /** 요약 카드 아래 줄(앞 기간 합계, 평균). 화면과 같은 이름과 값 */
  salesRows?: ReportDocLine[];
  purchaseRows?: ReportDocLine[];
  vat?: ReportDocVat | null;
  receivable?: { received: number; waiting: number; late: number; lateCount: number } | null;
  /** 달마다 카드 제목 아래 한 줄("11월 매출은 563만원, 지난달보다 10% 많아요") */
  headline?: string | null;
  /** 왜 늘었을까(줄었을까): 앞 기간보다 많이 바뀐 거래처와 품목 */
  why?: { title: string; rows: Array<{ label: string; delta: number }> } | null;
  /** 계좌를 하나라도 이었나. false면 통장 카드에 연결 안내만 쓴다 */
  bankLinked?: boolean;
  /** 자료 카드 줄 */
  sources?: Array<{ state: 'ok' | 'wait' | 'none'; text: string }>;
}

export interface ReportDocVat {
  /** "부가세 2기" */
  title: string;
  /** "1월 25일까지" */
  deadline: string;
  sale: DocAmount;
  purchase: DocAmount;
}

export interface ReportDocFonts {
  /** woff2 base64. 없으면 시스템 글꼴(폰) */
  regular: string;
  bold: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => Math.round(n).toLocaleString('en-US').replace(/^-/, '−');
const WON_UNITS: Array<[number, string]> = [[1e12, '조'], [1e8, '억'], [1e4, '만']];
/** 화면과 같은 큰 금액 표기: 886억 5,627만 3,113원 */
export function bigWon(n: number): string {
  let rest = Math.abs(Math.round(n));
  const parts: string[] = [];
  for (const [u, name] of WON_UNITS) {
    const q = Math.floor(rest / u);
    if (q) parts.push(`${q.toLocaleString('en-US')}${name}`);
    rest -= q * u;
  }
  if (rest || !parts.length) parts.push(rest.toLocaleString('en-US'));
  return `${n < 0 ? '−' : ''}${parts.join(' ')}원`;
}
const won = (n: DocAmount) => (n === null ? '확인 못 함' : bigWon(n));
const pct = (s: number) => `${Math.round(s * 100)}%`;
const shortWon = (v: number) => {
  const a = Math.abs(v);
  const [u, name] = a >= 1e12 ? [1e12, '조'] : a >= 1e8 ? [1e8, '억'] : [1e4, '만'];
  const n = v / (u as number);
  return `${(Math.abs(n) >= 100 || name === '만' ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US')}${name}원`;
};

/** PC 화면 밝은 색 토큰(sovereign-ax/design-system/tokens.json light) */
const C = {
  canvas: '#FCFCFC', card: '#F3F4F5', sunken: '#E9EAEB', ink: '#111112', ink2: '#4B4D4F', ink3: '#686A6E', ink4: '#A1A4A8', attention: '#8A5A0B',
  sale: ['#0064D4', '#8DB8EC', '#B8D3F3'], buy: ['#E5484D', '#F3A3A5', '#F8C8C9'],
};
type Tone = 'sale' | 'buy';
const tone = (t: Tone, i: number) => C[t][Math.min(i, 2)]!;
/** 구성 도넛(화면과 같은 순서): 위 세 거래처는 진한 색, 가운데(color-mix 50%), 흐린 색. 그 밖에 거래처와 계산서 없는 몫은 회색 */
const WHERE: Record<Tone, string[]> = { sale: ['#0064D4', '#468EE0', '#8DB8EC', C.ink4, C.ink3], buy: ['#E5484D', '#EC7679', '#F3A3A5', C.ink4, C.ink3] };

const STYLE = `@page{size:A4;margin:12mm 0 12mm}
@page:first{margin-top:0}
*{box-sizing:border-box}
html,body{margin:0;background:${C.canvas};color:${C.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"SAX Report",-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;word-break:keep-all}
.page{width:210mm;padding:36px 28px 0;display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:20px;line-height:28px;font-weight:700}
.top{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:4px}
.top .p{font-size:13px;line-height:20px;font-weight:700;color:${C.ink2}}
.meta{color:${C.ink3};text-align:right}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{background:${C.card};border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;break-inside:avoid}
.hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
.hd h2{margin:0;font-size:12px;line-height:18px;font-weight:700}
.hd .side{color:${C.ink2}}
.strong{font-size:14px;line-height:20px;font-weight:700}
.nw{white-space:nowrap}
.sub{color:${C.ink2}}
.total .sub,.total .strong{white-space:nowrap}
.total{display:flex;justify-content:space-between;align-items:center;gap:8px}
.total>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.meter{height:6px;border-radius:3px;background:${C.sunken};overflow:hidden}
.meter>i{display:block;height:100%;border-radius:3px}
dl{margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:6px}
dt{color:${C.ink3};display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
dd{margin:0;text-align:right;font-weight:600;white-space:nowrap}
dd.u{color:${C.attention};font-weight:400}
dd.later{color:${C.ink2};font-weight:400}
dt.t,dd.t{color:${C.ink};font-weight:700}
.dot{width:8px;height:8px;border-radius:2px;flex:none}
.legend{display:flex;gap:12px;color:${C.ink2}}
.legend span{display:flex;align-items:center;gap:6px}
.mix{display:grid;grid-template-columns:96px 1fr;gap:16px;align-items:center}
.ranks{display:flex;flex-direction:column;gap:8px}
.rank{display:grid;grid-template-columns:minmax(0,1fr) auto 34px;column-gap:8px;row-gap:4px;align-items:center}
.rank .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank .v{font-weight:600;white-space:nowrap}
.rank .p{color:${C.ink3};text-align:right}
.rank .meter{grid-column:1/-1}
.stack{display:flex;height:10px;border-radius:5px;overflow:hidden;background:${C.sunken}}
.stack>i{display:block;height:100%}
.bank{display:flex;flex-direction:column;gap:8px}
.brow{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:center}
.brow .v{font-weight:600;white-space:nowrap}
.src{display:flex;flex-direction:column;gap:6px}
.src span{display:flex;align-items:center;gap:6px}
.src .wait{color:${C.attention}}
.src .none{color:${C.ink3}}
.hl{display:flex;flex-direction:column;gap:2px}
.hl b{font-size:12px;line-height:18px}
.tbl{display:grid;column-gap:4px}
.trow{display:contents}
.trow>span{padding:4px 0;border-top:1px solid ${C.sunken};text-align:center;font-size:9px;line-height:14px;color:${C.ink2};white-space:nowrap}
.trow>span.on{color:${C.ink};font-weight:700}
.trow>.k{display:flex;align-items:center;gap:4px;text-align:left}
.why{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.why>div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:${C.canvas}}
.why .k{color:${C.ink2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.why .v{font-weight:700}
.foot{margin-top:4px;break-inside:avoid;display:flex;justify-content:space-between;color:${C.ink3};padding-top:4px}`;

const card = (title: string, body: string, side = '') => `<section class="card"><div class="hd"><h2>${title.startsWith('<') ? title : esc(title)}</h2>${side}</div>${body}</section>`;
const dot = (color: string) => `<i class="dot" style="background:${color}"></i>`;
const meter = (share: number, color: string) => `<div class="meter"><i style="width:${Math.max(0, Math.min(100, Math.round(share * 100)))}%;background:${color}"></i></div>`;

function spark(values: DocAmount[], t: Tone): string {
  const vs = values.map((v) => v ?? 0);
  if (vs.length < 2) return '';
  const max = Math.max(1, ...vs);
  const pts = vs.map((v, i) => [3 + (i * 50) / (vs.length - 1), 26 - (v / max) * 22] as const);
  const [lx, ly] = pts.at(-1)!;
  return `<svg width="56" height="30" viewBox="0 0 56 30" aria-hidden="true"><polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${tone(t, 0)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${tone(t, 0)}"/></svg>`;
}

function totalCard(title: string, t: Tone, total: ReportDocLine, trend: string | null | undefined, series: DocAmount[], rows: ReportDocLine[] = []): string {
  const kv = rows.length ? `<dl>${rows.map((r) => `<dt>${esc(r.label)}</dt><dd${r.amount === null ? ' class="u"' : ''}>${r.amount === null && r.note ? esc(r.note) : won(r.amount)}</dd>`).join('')}</dl>` : '';
  return card(title, `<div class="total"><div><span class="strong">${won(total.amount)}</span>${trend ? `<span class="sub">${esc(trend)}</span>` : ''}</div></div>${kv}`, spark(series, t));
}

function vatCard(v: ReportDocVat): string {
  const due = v.sale !== null && v.purchase !== null ? v.sale - v.purchase : null;
  const head = due !== null ? `<span class="nw">${bigWon(due)}</span> 낼 것 같아요` : v.sale !== null ? `매출 부가세 <span class="nw">${bigWon(v.sale)}</span>` : '확인 못 함';
  const fill = v.sale && due !== null ? Math.max(0, due) / v.sale : 0;
  const row = (k: string, a: DocAmount) => `<dt>${k}</dt><dd${a === null ? ' class="u"' : ''}>${won(a)}</dd>`;
  return card(v.title, `<span class="strong">${head}</span>${meter(fill, tone('sale', 0))}<dl>${row('매출 부가세', v.sale)}${row('매입 부가세', v.purchase)}</dl>`, `<span class="side">${esc(v.deadline)}</span>`);
}

function niceStep(max: number): number {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return Math.max(10_000, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
}

function chart(d: ReportDoc): string {
  const ms = d.months;
  const most = Math.max(1, ...ms.flatMap((m) => [m.sales ?? 0, m.purchase ?? 0]));
  const step = niceStep(most);
  const topV = step * Math.ceil(most / step);
  const W = 738 - 32;
  const AX = 46;
  const H = 168;
  const top = 18;
  const base = top + H;
  const col = (W - AX) / Math.max(1, ms.length);
  const bw = ms.length > 8 ? 12 : 20;
  const y = (v: number) => base - (v / topV) * H;
  const h = (v: DocAmount) => (v ? Math.max(2, (v / topV) * H) : 0);
  // 이번 기간의 남은 달(값 없음) 앞, 마지막으로 값이 있는 달을 굵게
  const known = ms.map((m) => m.sales !== null || m.purchase !== null);
  const cur = known.lastIndexOf(true) >= 0 ? known.lastIndexOf(true) : ms.length - 1;
  const ticks = Array.from({ length: Math.round(topV / step) + 1 }, (_, i) => i * step);
  const grid = ticks
    .map((v) => `<line x1="${AX}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.sunken}" stroke-width="1"/><text x="${AX - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="${C.ink3}">${v ? esc(shortWon(v).replace(/원$/, '')) : '0'}</text>`)
    .join('');
  const bars = ms
    .map((m, i) => {
      const on = i === cur;
      const cx = AX + col * i + col / 2;
      const op = m.on ? '' : ' opacity="0.45"';
      const hs = h(m.sales);
      const hb = h(m.purchase);
      return `<g><g${op}><rect x="${(cx - bw - 2).toFixed(1)}" y="${(base - hs).toFixed(1)}" width="${bw}" height="${hs.toFixed(1)}" rx="3" fill="${tone('sale', 0)}"/><rect x="${(cx + 2).toFixed(1)}" y="${(base - hb).toFixed(1)}" width="${bw}" height="${hb.toFixed(1)}" rx="3" fill="${tone('buy', 0)}"/></g>`
        + `<text x="${cx.toFixed(1)}" y="${base + 16}" text-anchor="middle" font-size="10" fill="${on ? C.ink : m.on ? C.ink2 : C.ink3}"${on ? ' font-weight="700"' : ''}>${esc(m.label)}</text>`
        + (m.sales ? `<text x="${cx.toFixed(1)}" y="${(base - Math.max(hs, hb) - 5).toFixed(1)}" text-anchor="middle" font-size="9"${on ? ' font-weight="700"' : ''} fill="${on ? C.ink : m.on ? C.ink2 : C.ink3}">${esc(shortWon(m.sales))}</text>` : '')
        + '</g>';
    })
    .join('');
  const legend = `<span class="legend"><span>${dot(tone('sale', 0))}매출</span><span>${dot(tone('buy', 0))}매입</span></span>`;
  const cell = (v: DocAmount) => (v === null ? '-' : esc(shortWon(v).replace(/원$/, '')));
  const trow = (sw: string, label: string, vals: DocAmount[]) =>
    `<div class="trow"><span class="k">${sw}${label}</span>${vals.map((v, i) => `<span${i === cur ? ' class="on"' : ''}>${cell(v)}</span>`).join('')}</div>`;
  const table = `<div class="tbl" style="grid-template-columns:${AX - 6}px repeat(${ms.length},minmax(0,1fr))">${trow(dot(tone('sale', 0)), '매출', ms.map((m) => m.sales))}${trow(dot(tone('buy', 0)), '매입', ms.map((m) => m.purchase))}</div>`;
  const title = d.headline ? `<span class="hl"><span>달마다</span><b>${esc(d.headline)}</b></span>` : '달마다';
  return card(title, `<svg width="100%" viewBox="0 0 ${W} ${base + 24}" role="img" aria-label="달마다 매출과 매입">${grid}${bars}</svg>${table}`, legend);
}

function ring(parts: DocAmount[], t: Tone, color: (i: number) => string = (i) => tone(t, i)): string {
  const total = parts.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0);
  const R = 36;
  const L = 2 * Math.PI * R;
  let at = 0;
  const arcs = total
    ? parts
        .map((v, i) => {
          const len = (Math.max(0, v ?? 0) / total) * L;
          const el = `<circle cx="48" cy="48" r="${R}" fill="none" stroke="${color(i)}" stroke-width="14" stroke-dasharray="${len.toFixed(1)} ${L.toFixed(1)}" stroke-dashoffset="${(-at).toFixed(1)}" transform="rotate(-90 48 48)"/>`;
          at += len;
          return el;
        })
        .join('')
    : '';
  return `<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="${R}" fill="none" stroke="${C.sunken}" stroke-width="14"/>${arcs}</svg>`;
}

/** 매출은 어디서, 매입은 어디로: 거래처 위 셋, 그 밖에, 계산서가 없는 몫(2026-11-28 대표: 어디인지가 궁금하다) */
function whereCard(title: string, t: Tone, partners: ReportDocPartners | null, rows: ReportDocLine[], otherLabel: string): string {
  const top = partners?.rows.slice(0, 3) ?? [];
  const folded = partners?.rows.slice(3) ?? [];
  const restN = folded.length + (partners?.rest?.n ?? 0);
  const restAmount = folded.reduce((a, x) => a + x.amount, 0) + (partners?.rest?.amount ?? 0);
  const other = rows.filter((l) => l.label !== '세금계산서').reduce((a, l) => a + Math.max(0, l.amount ?? 0), 0);
  const parts: Array<[string, number, number]> = [
    ...top.map((x, i): [string, number, number] => [x.name, x.amount, i]),
    ...(restAmount > 0 ? [[`그 밖에 ${num(restN)}곳`, restAmount, 3] as [string, number, number]] : []),
    ...(other > 0 ? [[otherLabel, other, 4] as [string, number, number]] : []),
  ].filter(([, v]) => v > 0);
  if (!parts.length) return '';
  const sum = parts.reduce((a, [, v]) => a + v, 0);
  const kv = parts.map(([label, v, c]) => `<dt>${dot(WHERE[t][c]!)}${esc(`${label} ${pct(v / sum)}`)}</dt><dd>${bigWon(v)}</dd>`).join('');
  return card(title, `<div class="mix">${ring(parts.map(([, v]) => v), t, (i) => WHERE[t][parts[i]![2]]!)}<dl>${kv}</dl></div>`);
}

function rankCard(title: string, t: Tone, r: ReportDocPartners | ReportDocRank[] | null, empty: string, label: (x: ReportDocRank) => string): string {
  if (!r) return '';
  const list = Array.isArray(r) ? r : r.rows;
  const total = Array.isArray(r) ? r.reduce((a, x) => a + x.amount, 0) : r.total;
  const share = (x: ReportDocRank) => x.share ?? (total ? x.amount / total : 0);
  const row = (x: ReportDocRank) => `<div class="rank"><span class="n">${esc(label(x))}</span><span class="v">${bigWon(x.amount)}</span><span class="p">${pct(share(x))}</span>${meter(share(x), tone(t, 0))}</div>`;
  const rest = !Array.isArray(r) && r.rest ? `<div class="rank"><span class="n">${esc(r.rest.name)}</span><span class="v">${bigWon(r.rest.amount)}</span><span class="p">${pct(share(r.rest))}</span>${meter(share(r.rest), tone(t, 1))}</div>` : '';
  return card(title, list.length ? `<div class="ranks">${list.slice(0, 5).map(row).join('')}${rest}</div>` : `<span class="sub">${esc(empty)}</span>`);
}

function receivableCard(r: NonNullable<ReportDoc['receivable']>): string {
  const all = r.received + r.waiting + r.late;
  const w = (v: number) => (all ? Math.round((v / all) * 100) : 0);
  const stack = `<div class="stack"><i style="width:${w(r.received)}%;background:${tone('sale', 0)}"></i><i style="width:${w(r.waiting)}%;background:${tone('sale', 1)}"></i><i style="width:${w(r.late)}%;background:${C.attention}"></i></div>`;
  const late = r.lateCount ? `<dt>${dot(C.attention)}기한 지남 ${num(r.lateCount)}건</dt><dd class="u">${bigWon(r.late)}</dd>` : '';
  return card('받을 돈', `${stack}<dl><dt>${dot(tone('sale', 0))}받은 돈</dt><dd>${bigWon(r.received)}</dd><dt>${dot(tone('sale', 1))}기다리는 돈</dt><dd>${bigWon(r.waiting)}</dd>${late}</dl>`);
}

function bankCard(d: ReportDoc): string {
  if (d.bankLinked === false) return card('통장', '<span class="sub">계좌를 연결하면 들어온 돈과 나간 돈이 보여요</span>');
  const most = Math.max(1, d.bank.in, d.bank.out);
  const bar = (label: string, list: Array<{ label: string; amount: number }>, total: number, t: Tone) => {
    const segs = list.map((x, i) => `<i style="width:${total ? Math.round((x.amount / total) * 100) : 0}%;background:${tone(t, i)}"></i>`).join('');
    return `<div class="brow"><span>${label}</span><div><div class="stack" style="width:${Math.round((total / most) * 100)}%">${segs}</div></div><span class="v">${bigWon(total)}</span></div>`;
  };
  const legend = (list: Array<{ label: string; amount: number }>, t: Tone) => list.map((x, i) => `<dt>${dot(tone(t, i))}${esc(x.label)}</dt><dd>${bigWon(x.amount)}</dd>`).join('');
  const balTotal = d.balances.length && d.balances.every((b) => b.amount !== null) ? d.balances.reduce((s, b) => s + (b.amount ?? 0), 0) : null;
  const bal = d.balances.length ? `<dt>계좌 잔액 ${num(d.balances.length)}곳${d.balanceDay ? ` ${esc(d.balanceDay)}` : ''}</dt><dd${balTotal === null ? ' class="u"' : ''}>${won(balTotal)}</dd>` : '';
  return card(
    '통장',
    `<div class="bank">${bar('들어온 돈', d.bankIn, d.bank.in, 'sale')}${bar('나간 돈', d.bankOut, d.bank.out, 'buy')}</div><dl>${legend(d.bankIn, 'sale')}${legend(d.bankOut, 'buy')}<dt class="t">남은 돈</dt><dd class="t">${bigWon(d.bank.net)}</dd>${bal}</dl>`,
  );
}

function sourceCard(rows: NonNullable<ReportDoc['sources']>): string {
  const mark = { ok: '✓', wait: '◷', none: '–' };
  return card('자료', `<div class="src">${rows.map((r) => `<span class="${r.state}">${mark[r.state]} ${esc(r.text)}</span>`).join('')}</div>`);
}

export function reportDocHtml(d: ReportDoc, opts: { fonts?: ReportDocFonts } = {}): string {
  const faces = opts.fonts
    ? `@font-face{font-family:"SAX Report";font-weight:400;src:url(data:font/woff2;base64,${opts.fonts.regular}) format("woff2")}@font-face{font-family:"SAX Report";font-weight:700;src:url(data:font/woff2;base64,${opts.fonts.bold}) format("woff2")}`
    : '';
  const meta = [d.bizNo ? `사업자등록번호 ${d.bizNo}` : null, `${d.made} 만듦`, !d.sources && d.bankTo ? `계좌 ${d.bankTo}` : null, !d.sources && d.hometaxTo ? `홈택스 자료 ${d.hometaxTo}` : null].filter((x): x is string => !!x);
  const third = d.vat
    ? vatCard(d.vat)
    : card('통장', `<dl><dt>들어온 돈</dt><dd>${bigWon(d.bank.in)}</dd><dt>나간 돈</dt><dd>${bigWon(d.bank.out)}</dd><dt class="t">남은 돈</dt><dd class="t">${bigWon(d.bank.net)}</dd></dl>`);
  const pairs = [
    `<div class="g2">${rankCard('많이 판 품목', 'sale', d.itemsSale, '이 기간 품목이 없어요', (x) => `${x.name} ${num(x.count)}건`)}${d.receivable ? receivableCard(d.receivable) : ''}</div>`,
    `<div class="g2">${bankCard(d)}${d.sources ? sourceCard(d.sources) : ''}</div>`,
  ];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(`${d.bizName} 리포트 ${d.period}`)}</title><style>${faces}${STYLE}</style></head><body><div class="page">
<div class="top"><div><h1>${esc(d.bizName)} 리포트</h1><div class="p">${esc(d.period)}</div></div><div class="meta">${meta.map((x) => `<div>${esc(x)}</div>`).join('')}</div></div>
<div class="g3">${totalCard('매출', 'sale', d.salesTotal, d.salesTrend, d.months.map((m) => m.sales), d.salesRows)}${totalCard('매입', 'buy', d.purchaseTotal, d.purchaseTrend, d.months.map((m) => m.purchase), d.purchaseRows)}${third}</div>
${chart(d)}
${d.why ? card(d.why.title, `<div class="why">${d.why.rows.map((x) => `<div><span class="k">${esc(x.label)}</span><span class="v">${x.delta > 0 ? '+' : '−'}${esc(shortWon(Math.abs(x.delta)))}</span></div>`).join('')}</div>`) : ''}
<div class="g2">${whereCard('매출은 어디서', 'sale', d.partnersSale, d.sales, '카드와 현금 손님')}${whereCard('매입은 어디로', 'buy', d.partnersPurchase, d.purchase, '카드, 영수증, 급여')}</div>
${pairs.join('\n')}
<div class="foot"><span>택스오프</span><span>${esc(d.period)}</span></div>
</div></body></html>`;
}
