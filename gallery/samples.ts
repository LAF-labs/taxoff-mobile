// 갤러리 견본: public/sample-invoice.jpg(가짜 사업자로 그린 종이 세금계산서)와 그 OCR 상자.
import { paperTaxInvoice } from '../test/fixtures/invoice-boxes';

export const SAMPLE_INVOICE = paperTaxInvoice();
export const SAMPLE_SHOT = { uri: '/sample-invoice.jpg', width: 1520, height: 1040, capturedAt: Date.now() };
