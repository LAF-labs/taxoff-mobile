/**
 * 종이 세금계산서와 계산서 칸 규칙. 규칙은 PC와 하나라 tex `@sax/remote` `paper-read.ts`(ADR-073)를 쓰고, 여기에는 폰 확인 화면의 문구와 v1 후보만 둔다.
 * 규칙을 고칠 때는 tex에서 고친 뒤 `pnpm sync:remote <tex 체크아웃> remote`로 맞춘다.
 */
import { checkPaperDraft, type PaperDraftIssue, type PaperInvoiceDraft } from '../../vendor/sax-remote/src/paper-read.ts';

export {
  linesToBoxes,
  looksLikeInvoice,
  parsePaperInvoice,
  toRows,
  vatFits,
  type InvoiceKind,
  type OcrBox,
  type PaperDirection as Direction,
  type PaperInvoiceDraft as PaperInvoice,
  type PaperItemDraft as InvoiceItem,
  type PaperPartyDraft as Party,
  type PaperRead as InvoiceRead,
} from '../../vendor/sax-remote/src/paper-read.ts';

type InvoiceIssue = PaperDraftIssue;

export const checkInvoice = checkPaperDraft;

export function issueText(i: InvoiceIssue): string {
  switch (i.code) {
    case 'sum_mismatch':
      return `공급가액과 세액을 더하면 ${i.expected.toLocaleString('ko-KR')}원이에요. 합계를 확인해 주세요.`;
    case 'vat_not_10pct':
      return '세액이 공급가액의 10%와 달라요. 종이에 적힌 대로면 그대로 두세요.';
    case 'biz_invalid':
      return '등록번호가 맞지 않아요. 한 자리씩 확인해 주세요.';
    case 'same_party':
      return '공급자와 공급받는자 등록번호가 같아요.';
    case 'day_invalid':
      return '작성일자가 맞지 않아요.';
    case 'direction_required':
      return '받은 것인지 발급한 것인지 골라 주세요.';
    case 'amount_required':
      return '금액을 적어 주세요.';
    case 'required':
      return '종이에 적힌 대로 적어 주세요.';
  }
}

export const blocking = (i: InvoiceIssue) => i.code !== 'vat_not_10pct';

export function toV1Candidates(inv: PaperInvoiceDraft): { amount?: number; issuedOn?: string; merchant?: string; merchantBizNo?: string } {
  const other = inv.direction === 'sales' ? inv.buyer : inv.supplier;
  const c: { amount?: number; issuedOn?: string; merchant?: string; merchantBizNo?: string } = {};
  if (inv.total !== null && inv.total > 0) c.amount = inv.total;
  if (inv.writtenOn) c.issuedOn = inv.writtenOn;
  if (other.name) c.merchant = other.name.slice(0, 80);
  if (other.bizNo) c.merchantBizNo = other.bizNo;
  return c;
}
