import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPaperInvoice, makeReceiptOffer } from '../vendor/sax-remote/src/index.ts';
import { parsePaperInvoice } from '../src/capture/invoice.ts';
import { toWire } from '../src/capture/invoice-wire.ts';
import { paperTaxInvoice } from './fixtures/invoice-boxes.ts';

const TODAY = new Date(2026, 10, 16);
const read = parsePaperInvoice(paperTaxInvoice(), TODAY)!.invoice;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('와이어 paperInvoice(receipt.v2)', () => {
  it('읽은 견본이 그대로 @sax/remote 검사를 통과하고 offer에 실린다', () => {
    const w = toWire(read);
    assert.ok(w.ok);
    assert.deepEqual(checkPaperInvoice(w.invoice), []);
    assert.equal(w.droppedItems, false);
    assert.equal(w.invoice.items!.length, 2);
    assert.equal(w.invoice.receiptOrClaim, 'claim');
    for (const v of Object.values(w.invoice.fieldConfidence!)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
    const offer = makeReceiptOffer(JPEG, { capturedAt: 1, ocrEngine: 'ios_vision', ownerConfirmed: true, paperInvoice: w.invoice });
    assert.equal(offer.paperInvoice!.total, 1_353_000);
  });
  it('품목 합이 공급가액과 다르면 품목만 뺀다(사진이 같이 간다)', () => {
    const w = toWire({ ...read, items: read.items.slice(0, 1) });
    assert.ok(w.ok);
    assert.equal(w.droppedItems, true);
    assert.equal(w.invoice.items, undefined);
  });
  it('소수 수량은 규격 칸으로', () => {
    const w = toWire({ ...read, items: [{ ...read.items[0]!, qty: 2.5 }, read.items[1]!] });
    assert.ok(w.ok);
    assert.equal(w.invoice.items![0]!.qty, undefined);
    assert.equal(w.invoice.items![0]!.spec, '수량 2.5');
  });
  it('필수 칸이 비면 보내지 않는다', () => {
    const w = toWire({ ...read, buyer: { ...read.buyer, name: null } });
    assert.deepEqual(w, { ok: false, bad: ['buyer.name'] });
    assert.equal(toWire({ ...read, direction: null }).ok, false);
  });
});
