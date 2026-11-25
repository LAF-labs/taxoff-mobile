/**
 * 월 리포트 PDF 한 벌(ADR-068 결정 11). 화면을 찍지 않고 리포트 값으로 직접 그린다.
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
}

export interface ReportDocRank {
  name: string;
  count: number;
  amount: number;
  share?: number;
}

export interface ReportDocPartners {
  rows: ReportDocRank[];
  rest: ReportDocRank | null;
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
}

export interface ReportDocFonts {
  /** woff2 base64. 없으면 시스템 글꼴(폰) */
  regular: string;
  bold: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => Math.round(n).toLocaleString('en-US').replace(/^-/, '−');
const won = (n: DocAmount) => (n === null ? '확인 못 함' : `${num(n)}원`);
const pct = (s: number | undefined) => (s === undefined ? '' : `${Math.round(s * 100)}%`);

const STYLE = `@page{size:A4;margin:14mm 0 14mm}
@page:first{margin-top:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#111112;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"SAX Report",-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:11px;line-height:16px}
.page{width:210mm;padding:40px 52px 0;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:20px;line-height:28px;font-weight:700}
h2{margin:0 0 6px;font-size:12px;line-height:18px;font-weight:700;break-after:avoid}
.top{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:12px;border-bottom:1px solid #111112}
.top .p{font-size:14px;line-height:20px;font-weight:600}
.meta div{display:flex;gap:12px;justify-content:flex-end}
.meta .k{color:#686A6E}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
section{break-inside:avoid}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
td,th{padding:2px 0;text-align:right;font-weight:400}
th{color:#686A6E;border-bottom:1px solid #D5D7DA}
td:first-child,th:first-child{text-align:left}
td.l,th.l{text-align:left;padding-left:16px}
tr.t td{font-weight:700;border-top:1px solid #D5D7DA}
tr.on td{font-weight:700}
tr.out td{color:#686A6E}
td.u{color:#8A5A0B}
.bars{width:150px;text-align:left;padding-left:12px}
.bars span{display:block;line-height:8px}
.bar{display:inline-block;height:6px;border-radius:1px;background:#4B4D4F;vertical-align:middle}
.bar.b{background:#A1A4A8}
/* 바닥 줄은 내용 끝에 한 번. 두 쪽이 넘으면 둘째 쪽부터 위아래 여백(@page)이 붙는다 */
.foot{margin-top:8px;break-inside:avoid;display:flex;justify-content:space-between;color:#686A6E;border-top:1px solid #D5D7DA;padding-top:8px}`;

const amountCell = (a: DocAmount, partial?: boolean) => `<td${a === null || partial ? ' class="u"' : ''}>${won(a)}</td>`;
const lines = (title: string, rows: ReportDocLine[], total: ReportDocLine) =>
  `<section><h2>${esc(title)}</h2><table>${rows.map((r) => `<tr><td>${esc(r.label)}</td>${amountCell(r.amount, r.partial)}</tr>`).join('')}<tr class="t"><td>${esc(total.label)}</td>${amountCell(total.amount, total.partial)}</tr></table></section>`;

function rankTable(title: string, r: ReportDocPartners | null): string {
  if (!r) return '';
  if (!r.rows.length) return `<section><h2>${esc(title)}</h2><table><tr><td>없음</td></tr></table></section>`;
  const row = (x: ReportDocRank) => `<tr><td>${esc(x.name)}</td><td>${num(x.count)}건</td><td>${won(x.amount)}</td><td>${pct(x.share)}</td></tr>`;
  return `<section><h2>${esc(title)}</h2><table><tr><th>거래처</th><th>건수</th><th>금액</th><th>비율</th></tr>${r.rows.map(row).join('')}${r.rest ? row(r.rest) : ''}<tr class="t"><td>합계</td><td>${num(r.count)}건</td><td>${won(r.total)}</td><td></td></tr></table></section>`;
}

export function reportDocHtml(d: ReportDoc, opts: { fonts?: ReportDocFonts } = {}): string {
  const faces = opts.fonts
    ? `@font-face{font-family:"SAX Report";font-weight:400;src:url(data:font/woff2;base64,${opts.fonts.regular}) format("woff2")}@font-face{font-family:"SAX Report";font-weight:700;src:url(data:font/woff2;base64,${opts.fonts.bold}) format("woff2")}`
    : '';
  const max = Math.max(1, ...d.months.flatMap((m) => [m.sales ?? 0, m.purchase ?? 0]));
  const w = (v: DocAmount) => Math.round(((v ?? 0) / max) * 140);
  const meta = [
    d.bizNo ? ['사업자등록번호', d.bizNo] : null,
    ['만든 날', d.made],
    d.bankTo ? ['계좌', d.bankTo] : null,
    d.hometaxTo ? ['홈택스 자료', d.hometaxTo] : null,
  ].filter((x): x is string[] => !!x);
  const months = d.months
    .map((m) => `<tr class="${m.on ? 'on' : 'out'}"><td>${esc(m.label)}</td><td>${won(m.sales)}</td><td>${won(m.purchase)}</td><td>${won(m.in)}</td><td>${won(m.out)}</td><td class="bars"><span><i class="bar" style="width:${w(m.sales)}px"></i></span><span><i class="bar b" style="width:${w(m.purchase)}px"></i></span></td></tr>`)
    .join('');
  const pair = Math.max(d.bankOut.length, d.bankIn.length);
  const bankRows = Array.from({ length: pair }, (_, i) => {
    const o = d.bankOut[i];
    const n = d.bankIn[i];
    return `<tr><td>${o ? esc(o.label) : ''}</td><td>${o ? won(o.amount) : ''}</td><td class="l">${n ? esc(n.label) : ''}</td><td>${n ? won(n.amount) : ''}</td></tr>`;
  }).join('');
  const balTotal = d.balances.every((b) => b.amount !== null) ? d.balances.reduce((s, b) => s + (b.amount ?? 0), 0) : null;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(`${d.bizName} 리포트 ${d.period}`)}</title><style>${faces}${STYLE}</style></head><body><div class="page">
<div class="top"><div><h1>${esc(d.bizName)} 리포트</h1><div class="p">${esc(d.period)}</div></div><div class="meta">${meta.map(([k, v]) => `<div><span class="k">${esc(k!)}</span><span>${esc(v!)}</span></div>`).join('')}</div></div>
<div class="g3">${lines('매출', d.sales, d.salesTotal)}${lines('매입', d.purchase, d.purchaseTotal)}<section><h2>통장</h2><table><tr><td>들어온 돈</td><td>${won(d.bank.in)}</td></tr><tr><td>나간 돈</td><td>${won(d.bank.out)}</td></tr><tr class="t"><td>남은 돈</td><td>${won(d.bank.net)}</td></tr></table></section></div>
<section><h2>달마다</h2><table><tr><th>달</th><th>매출</th><th>매입</th><th>들어온 돈</th><th>나간 돈</th><th class="l">매출과 매입</th></tr>${months}</table></section>
${d.partnersSale || d.partnersPurchase ? `<div class="g2">${rankTable('매출 거래처', d.partnersSale)}${rankTable('매입 거래처', d.partnersPurchase)}</div>` : ''}
<div class="g2">${d.itemsSale ? `<section><h2>매출 품목</h2><table><tr><th>품목</th><th>건수</th><th>금액</th></tr>${d.itemsSale.map((x) => `<tr><td>${esc(x.name)}</td><td>${num(x.count)}건</td><td>${won(x.amount)}</td></tr>`).join('') || '<tr><td>없음</td></tr>'}</table></section>` : ''}
<section><h2>계좌</h2><table><tr><th>나간 돈</th><th></th><th class="l">들어온 돈</th><th></th></tr>${bankRows}<tr class="t"><td>합계</td><td>${won(d.bank.out)}</td><td class="l">합계</td><td>${won(d.bank.in)}</td></tr></table>
${d.balances.length ? `<table style="margin-top:10px"><tr><th>잔액</th><th>${d.balanceDay ? esc(d.balanceDay) : ''}</th></tr>${d.balances.map((b) => `<tr><td>${esc(b.label)}</td>${amountCell(b.amount)}</tr>`).join('')}<tr class="t"><td>합계</td>${amountCell(balTotal)}</tr></table>` : ''}</section></div>
<div class="foot"><span>택스오프</span></div>
</div></body></html>`;
}
