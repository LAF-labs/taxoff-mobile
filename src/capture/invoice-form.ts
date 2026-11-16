// 확인 화면의 세금계산서 칸(글자) ↔ 보낼 값(PaperInvoice). 순수 함수 — node --test로 시험한다.
import { masked } from '../ui/mask.ts';
import type { InvoiceItem, InvoiceKind, PaperInvoice } from './invoice.ts';

/** 확인 화면의 세금계산서 칸(글자 그대로). 보낼 때 PaperInvoice로 바꾼다. */
export interface InvoiceForm {
  docKind: InvoiceKind;
  direction: 'sales' | 'purchase' | null;
  writtenOn: string;
  supplierBiz: string;
  supplierName: string;
  supplierCeo: string;
  buyerBiz: string;
  buyerName: string;
  supply: string;
  vat: string;
  total: string;
  receiptOrClaim: 'receipt' | 'claim' | null;
  items: InvoiceItem[];
  approvalNo: string | null;
  bookNo: string | null;
  serialNo: string | null;
  supplierAddress: string | null;
  buyerAddress: string | null;
}

export const FIELD_KEY: Record<string, keyof InvoiceForm> = {
  'supplier.bizNo': 'supplierBiz', 'supplier.name': 'supplierName', 'supplier.ceo': 'supplierCeo',
  'buyer.bizNo': 'buyerBiz', 'buyer.name': 'buyerName',
  supplyAmount: 'supply', vatAmount: 'vat', total: 'total', writtenOn: 'writtenOn', direction: 'direction', receiptOrClaim: 'receiptOrClaim',
};

export const num = (s: string): number | null => {
  const d = s.replace(/\D/g, '');
  return d ? Number(d) : null;
};
export const fmt = (n: number | null) => (n === null ? '' : masked('won', String(n)));

export function emptyInvoiceForm(kind: InvoiceKind = 'tax_invoice'): InvoiceForm {
  return {
    docKind: kind, direction: null, writtenOn: '', supplierBiz: '', supplierName: '', supplierCeo: '', buyerBiz: '', buyerName: '',
    supply: '', vat: kind === 'invoice' ? '0' : '', total: '', receiptOrClaim: null, items: [], approvalNo: null, bookNo: null, serialNo: null,
    supplierAddress: null, buyerAddress: null,
  };
}

export function formFrom(inv: PaperInvoice): InvoiceForm {
  return {
    docKind: inv.docKind, direction: inv.direction, writtenOn: inv.writtenOn ?? '',
    supplierBiz: inv.supplier.bizNo ?? '', supplierName: inv.supplier.name ?? '', supplierCeo: inv.supplier.ceo ?? '',
    buyerBiz: inv.buyer.bizNo ?? '', buyerName: inv.buyer.name ?? '',
    supply: fmt(inv.supplyAmount), vat: fmt(inv.vatAmount), total: fmt(inv.total), receiptOrClaim: inv.receiptOrClaim, items: inv.items,
    approvalNo: inv.approvalNo, bookNo: inv.bookNo, serialNo: inv.serialNo, supplierAddress: inv.supplier.address, buyerAddress: inv.buyer.address,
  };
}

/** 확인한 칸 → 보낼 값. 사장님이 만진 칸은 확신 1, 나머지는 읽은 확신 그대로. */
export function invoiceOf(f: InvoiceForm, conf: Record<string, number>, touched: ReadonlySet<string>): PaperInvoice {
  const fc: Record<string, number> = {};
  for (const [k, field] of Object.entries(FIELD_KEY)) {
    if (touched.has(field)) fc[k] = 1;
    else if (conf[k] !== undefined) fc[k] = conf[k]!;
  }
  const biz = (s: string) => (s.replace(/\D/g, '').length === 10 ? masked('bizNo', s) : s.trim() || null);
  return {
    docKind: f.docKind, direction: f.direction, writtenOn: f.writtenOn || null, approvalNo: f.approvalNo, bookNo: f.bookNo, serialNo: f.serialNo,
    supplier: { bizNo: biz(f.supplierBiz), name: f.supplierName.trim() || null, ceo: f.supplierCeo.trim() || null, address: f.supplierAddress },
    buyer: { bizNo: biz(f.buyerBiz), name: f.buyerName.trim() || null, ceo: null, address: f.buyerAddress },
    supplyAmount: num(f.supply), vatAmount: f.docKind === 'invoice' ? 0 : num(f.vat), total: num(f.total),
    items: f.items, receiptOrClaim: f.receiptOrClaim, fieldConfidence: fc,
  };
}

