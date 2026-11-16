import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paperTaxInvoice } from './fixtures/invoice-boxes.ts';
import { checkInvoice, linesToBoxes, looksLikeInvoice, parsePaperInvoice, toRows, toV1Candidates, vatFits, type OcrBox } from '../src/capture/invoice.ts';

const TODAY = new Date(2026, 10, 16);
const B = (text: string, x: number, y: number, w = 0.08): OcrBox => ({ text, x, y, w, h: 0.018 });

describe('종이 세금계산서 파서', () => {
  it('칸 위치로 공급자·공급받는자·금액·품목을 읽는다', () => {
    const r = parsePaperInvoice(paperTaxInvoice(), TODAY);
    assert.ok(r);
    const i = r.invoice;
    assert.equal(i.docKind, 'tax_invoice');
    assert.equal(r.copyOf, 'buyer');
    assert.equal(i.direction, 'purchase');
    assert.equal(r.electronicCopy, false);
    assert.deepEqual(i.supplier, { bizNo: '123-45-67891', name: '가나식자재', ceo: '김가나', address: '서울 마포구 월드컵로 1' });
    assert.deepEqual(i.buyer, { bizNo: '220-81-12341', name: '율무커피', ceo: '박율무', address: '서울 성동구 왕십리로 2' });
    assert.equal(i.writtenOn, '2026-11-05');
    assert.equal(i.supplyAmount, 1_230_000);
    assert.equal(i.vatAmount, 123_000);
    assert.equal(i.total, 1_353_000);
    assert.equal(i.fieldConfidence.total, 0.95);
    assert.equal(i.bookNo, '3권 12호');
    assert.equal(i.serialNo, '0045');
    assert.equal(i.receiptOrClaim, 'claim');
    assert.equal(i.items.length, 2);
    assert.deepEqual(i.items[0], { month: 11, day: 5, name: '원두 1kg', spec: null, qty: 10, unitPrice: 100_000, supply: 1_000_000, vat: 100_000 });
    assert.equal(i.items[1]!.name, '우유');
    assert.equal(i.items[1]!.spec, '1L');
    assert.equal(i.items[1]!.qty, 50);
    assert.equal(i.items[1]!.supply, 230_000);
    assert.deepEqual(checkInvoice(i, TODAY), []);
  });

  it('자리마다 한 칸인 옛 서식의 숫자를 이어 붙인다', () => {
    const r = parsePaperInvoice(paperTaxInvoice({ digitCells: true }), TODAY)!;
    assert.equal(r.invoice.supplyAmount, 1_230_000);
    assert.equal(r.invoice.vatAmount, 123_000);
    assert.equal(r.invoice.total, 1_353_000);
  });

  it('작성 년 월 일이 한 상자("2026 11 05")로 읽혀도 날짜로 본다', () => {
    const boxes = paperTaxInvoice().filter((b) => !(b.y === 0.28 && ['2026', '11', '05'].includes(b.text)));
    boxes.push(B('2026 11 05', 0.02, 0.28, 0.14));
    assert.equal(parsePaperInvoice(boxes, TODAY)!.invoice.writtenOn, '2026-11-05');
  });

  it('라벨이 안 읽혀도 사업자번호는 왼쪽·오른쪽 순서로 나눈다', () => {
    const r = parsePaperInvoice(paperTaxInvoice({ noLabels: true }), TODAY)!;
    assert.equal(r.invoice.supplier.bizNo, '123-45-67891');
    assert.equal(r.invoice.buyer.bizNo, '220-81-12341');
  });

  it('공급자 보관용이면 매출, 승인번호가 있으면 전자세금계산서 출력물', () => {
    const boxes = paperTaxInvoice().map((b) => (b.text === '(공급받는자 보관용)' ? { ...b, text: '(공급자 보관용)' } : b));
    boxes.push(B('승인번호 20261105-41000012-abcdefgh', 0.02, 0.07, 0.4), B('20261105-41000012-00001234', 0.3, 0.075, 0.3));
    const r = parsePaperInvoice(boxes, TODAY)!;
    assert.equal(r.invoice.direction, 'sales');
    assert.equal(r.invoice.approvalNo, '20261105-41000012-00001234');
    assert.equal(r.electronicCopy, true);
    // 매출이면 상대는 공급받는자
    assert.deepEqual(toV1Candidates(r.invoice), { amount: 1_353_000, issuedOn: '2026-11-05', merchant: '율무커피', merchantBizNo: '220-81-12341' });
  });

  it('매입이면 v1 후보의 상호·번호는 공급자', () => {
    const r = parsePaperInvoice(paperTaxInvoice(), TODAY)!;
    assert.deepEqual(toV1Candidates(r.invoice), { amount: 1_353_000, issuedOn: '2026-11-05', merchant: '가나식자재', merchantBizNo: '123-45-67891' });
  });

  it('계산서(면세)는 세액 0, 합계 = 공급가액', () => {
    const boxes = paperTaxInvoice()
      .filter((b) => !['123,000', '100,000', '23,000'].includes(b.text) || b.x < 0.55)
      .map((b) => (b.text === '세금계산서' ? { ...b, text: '계산서' } : b.text === '1,353,000' ? { ...b, text: '1,230,000' } : b));
    const r = parsePaperInvoice(boxes, TODAY)!;
    assert.equal(r.invoice.docKind, 'invoice');
    assert.equal(r.invoice.vatAmount, 0);
    assert.equal(r.invoice.total, 1_230_000);
    assert.equal(r.invoice.supplyAmount, 1_230_000);
  });

  it('줄 목록만 있는 OCR에서도 서식 이름·번호·금액을 건진다', () => {
    const lines = ['세금계산서', '(공급받는자 보관용)', '등록번호 123-45-67891', '등록번호 220-81-12341', '작성 2026.11.05', '공급가액 50,000 세액 5,000', '합계금액 55,000'];
    assert.equal(looksLikeInvoice(lines), 'tax_invoice');
    const r = parsePaperInvoice(linesToBoxes(lines), TODAY)!;
    assert.equal(r.invoice.supplier.bizNo, '123-45-67891');
    assert.equal(r.invoice.buyer.bizNo, '220-81-12341');
    assert.equal(r.invoice.writtenOn, '2026-11-05');
    assert.equal(r.invoice.supplyAmount, 50_000);
    assert.equal(r.invoice.total, 55_000);
  });

  it('영수증은 세금계산서로 보지 않는다', () => {
    assert.equal(looksLikeInvoice(['가나다 마트', '카드 영수증', '합계 12,000']), null);
    assert.equal(parsePaperInvoice(linesToBoxes(['가나다 마트', '합계 12,000']), TODAY), null);
  });
});

describe('검산', () => {
  const base = parsePaperInvoice(paperTaxInvoice(), TODAY)!.invoice;
  it('합계가 공급가액 + 세액과 다르면 알린다', () => {
    const issues = checkInvoice({ ...base, total: 1_350_000 }, TODAY);
    assert.deepEqual(issues, [{ field: 'total', code: 'sum_mismatch', expected: 1_353_000 }]);
  });
  it('세액 10% 불일치는 알리기만, 영세율 0은 괜찮다', () => {
    assert.deepEqual(checkInvoice({ ...base, vatAmount: 120_000, total: 1_350_000 }, TODAY).map((i) => i.code), ['vat_not_10pct']);
    assert.deepEqual(checkInvoice({ ...base, vatAmount: 0, total: 1_230_000 }, TODAY), []);
  });
  it('등록번호 검증 숫자·같은 번호·방향 없음', () => {
    const codes = checkInvoice({ ...base, direction: null, supplier: { ...base.supplier, bizNo: '123-45-67890' }, buyer: { ...base.buyer, bizNo: '123-45-67890' } }, TODAY).map((i) => i.code);
    assert.deepEqual(codes, ['direction_required', 'biz_invalid', 'biz_invalid', 'same_party']);
  });
  it('10% 검산', () => {
    assert.ok(vatFits(1_230_000, 123_000));
    assert.ok(vatFits(12_345, 1_234));
    assert.ok(vatFits(12_345, 1_235));
    assert.ok(!vatFits(12_345, 1_200));
  });
});

describe('줄 묶기', () => {
  it('같은 높이의 상자를 왼쪽부터 한 줄로', () => {
    const rows = toRows([B('b', 0.5, 0.1), B('a', 0.1, 0.102), B('c', 0.1, 0.2)]);
    assert.deepEqual(rows.map((r) => r.text), ['a b', 'c']);
  });
});
