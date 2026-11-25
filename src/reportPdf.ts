import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportDocHtml, type CopyReport } from '@sax/remote';
import SaxNative from '../modules/sax-native/src/SaxNativeModule';
import { reportDocOf, reportFileName, type ReportView } from './report';

/** 이 폰에서 리포트 PDF를 만들 수 있는지(iOS 네이티브 htmlToPdf). */
export const canReportPdf = () => !!SaxNative?.htmlToPdf;

/**
 * 월 리포트 PDF(tex ADR-068 결정 11): PC와 같은 reportDocHtml로 그린 HTML을 PDF로 바꿔 공유 시트로 연다.
 * PC가 꺼져 있어도 사본으로 만든다. 파일은 앱 임시 폴더에 두고 공유 시트가 닫히면 지운다.
 */
export async function shareReportPdf(copy: CopyReport, v: ReportView, now = Date.now()): Promise<'shared' | 'failed'> {
  const make = SaxNative?.htmlToPdf;
  if (!make) return 'failed';
  const name = reportFileName(v.month, v.months);
  const file = new File(Paths.cache, name);
  try {
    if (file.exists) file.delete();
    await make(reportDocHtml(reportDocOf(copy, v, now)), file.uri);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
    return 'shared';
  } catch {
    return 'failed';
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* 다음에 같은 이름으로 만들 때 지운다 */
    }
  }
}
