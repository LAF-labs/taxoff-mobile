import { checkPaperInvoice, type PaperInvoice as WireInvoice, type PaperInvoiceItem } from '../../vendor/sax-remote/src/index.ts';
import type { PaperInvoice } from './invoice.ts';

const biz = (s: string | null) => {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (s ?? '');
};

function wireItems(inv: PaperInvoice): PaperInvoiceItem[] | undefined {
  if (!inv.items.length) return undefined;
  const items = inv.items.slice(0, 20).map((it) => {
    const o: PaperInvoiceItem = { name: it.name.slice(0, 60), supply: it.supply };
    if (it.month !== null) o.month = it.month;
    if (it.day !== null) o.day = it.day;
    const spec = [it.spec, it.qty !== null && !Number.isInteger(it.qty) ? `수량 ${it.qty}` : null].filter(Boolean).join(' ');
    if (spec) o.spec = spec.slice(0, 30);
    if (it.qty !== null && Number.isInteger(it.qty)) o.qty = it.qty;
    if (it.unitPrice !== null && Number.isSafeInteger(it.unitPrice)) o.unitPrice = it.unitPrice;
    if (inv.docKind === 'tax_invoice' && it.vat !== null) o.vat = it.vat;
    return o;
  });
  return items;
}

type WireResult = { ok: true; invoice: WireInvoice; droppedItems: boolean } | { ok: false; bad: string[] };

export function toWire(inv: PaperInvoice): WireResult {
  if (!inv.direction || !inv.writtenOn || inv.supplyAmount === null || inv.total === null) {
    return { ok: false, bad: [!inv.direction && 'direction', !inv.writtenOn && 'writtenOn', inv.supplyAmount === null && 'supplyAmount', inv.total === null && 'total'].filter(Boolean) as string[] };
  }
  const party = (p: PaperInvoice['supplier']) => {
    const o: WireInvoice['supplier'] = { bizNo: biz(p.bizNo), name: (p.name ?? '').slice(0, 60) };
    if (p.ceo) o.ceo = p.ceo.slice(0, 30);
    if (p.address) o.address = p.address.slice(0, 120);
    return o;
  };
  const fc: Record<string, number> = {};
  for (const [k, v] of Object.entries(inv.fieldConfidence)) fc[k] = Math.round(Math.min(1, Math.max(0, v)) * 100);
  const w: WireInvoice = {
    docKind: inv.docKind,
    direction: inv.direction,
    writtenOn: inv.writtenOn,
    supplier: party(inv.supplier),
    buyer: party(inv.buyer),
    supplyAmount: inv.supplyAmount,
    vatAmount: inv.docKind === 'invoice' ? 0 : (inv.vatAmount ?? 0),
    total: inv.total,
    receiptOrClaim: inv.receiptOrClaim,
    fieldConfidence: fc,
  };
  if (inv.approvalNo) w.approvalNo = inv.approvalNo;
  if (inv.bookNo) w.bookNo = inv.bookNo.slice(0, 20);
  if (inv.serialNo) w.serialNo = inv.serialNo.slice(0, 20);
  const items = wireItems(inv);
  if (items) w.items = items;
  let bad = checkPaperInvoice(w);
  let droppedItems = false;
  if (w.items && bad.length && bad.every((b) => b.startsWith('items'))) {
    delete w.items;
    droppedItems = true;
    bad = checkPaperInvoice(w);
  }
  return bad.length ? { ok: false, bad } : { ok: true, invoice: w, droppedItems };
}
