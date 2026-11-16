import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkInvoice, parsePaperInvoice } from '../src/capture/invoice.ts';
import { emptyInvoiceForm, formFrom, invoiceOf } from '../src/capture/invoice-form.ts';
import { masked } from '../src/ui/mask.ts';
import { paperTaxInvoice } from './fixtures/invoice-boxes.ts';

const TODAY = new Date(2026, 10, 16);

describe('입력 표기', () => {
  it('금액·사업자번호·날짜', () => {
    assert.equal(masked('won', '1230000'), '1,230,000');
    assert.equal(masked('won', '1,230,0001'), '12,300,001');
    assert.equal(masked('won', ''), '');
    assert.equal(masked('bizNo', '1111111119'), '111-11-11119');
    assert.equal(masked('bizNo', '1234'), '123-4');
    assert.equal(masked('day', '20261105'), '2026-11-05');
    assert.equal(masked('text', ' 그대로 '), ' 그대로 ');
  });
});

describe('세금계산서 확인 칸', () => {
  const read = parsePaperInvoice(paperTaxInvoice(), TODAY)!.invoice;
  it('읽은 값 → 칸 → 보낼 값이 같다(사장님이 안 고치면 확신은 읽은 그대로)', () => {
    const back = invoiceOf(formFrom(read), read.fieldConfidence, new Set());
    assert.deepEqual({ ...back, fieldConfidence: {} }, { ...read, buyer: { ...read.buyer, ceo: null }, fieldConfidence: {} });
    assert.equal(back.fieldConfidence.total, read.fieldConfidence.total);
  });
  it('사장님이 고친 칸은 확신 1', () => {
    const f = { ...formFrom(read), total: '1,353,000' };
    const v = invoiceOf(f, { total: 0.5 }, new Set(['total']));
    assert.equal(v.fieldConfidence.total, 1);
  });
  it('계산서는 세액 칸 값과 관계없이 0', () => {
    const f = { ...emptyInvoiceForm('invoice'), supply: '50,000', vat: '5,000', total: '50,000', direction: 'purchase' as const, writtenOn: '2026-11-05', supplierBiz: '111-11-11119', supplierName: '가나', buyerBiz: '999-99-99997', buyerName: '시험' };
    const v = invoiceOf(f, {}, new Set());
    assert.equal(v.vatAmount, 0);
    assert.deepEqual(checkInvoice(v, TODAY), []);
  });
  it('빈 양식은 방향·작성일자·양쪽 번호·상호·금액이 필요하다', () => {
    const codes = checkInvoice(invoiceOf(emptyInvoiceForm(), {}, new Set()), TODAY).map((i) => i.code);
    assert.deepEqual(codes, ['direction_required', 'required', 'required', 'required', 'required', 'required', 'amount_required', 'amount_required']);
  });
});
