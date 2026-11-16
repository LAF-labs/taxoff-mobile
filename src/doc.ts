// 서류 보기(P-05) 공유·저장. 지금은 번들 견본 PDF 하나(assets/sample/tax-invoice.pdf)를 쓴다.
// 실제 서류는 PC가 보낸 암호 파일을 폰에서 풀어 쓰고, 공유가 끝나면 임시 파일을 지운다(다음 PR).
import { Asset } from 'expo-asset';
import * as Sharing from 'expo-sharing';
import { SAMPLE_DOC } from './queueStore';

async function localUri(): Promise<string | null> {
  const a = Asset.fromModule(SAMPLE_DOC);
  await a.downloadAsync();
  return a.localUri ?? null;
}

/**
 * 시스템 공유 시트로 PDF를 넘긴다. purpose='save'면 같은 시트에서 "파일에 저장"을 고르게 한다
 * (iOS 공유 시트의 파일에 저장, Android는 저장 대상 앱). 실패하면 false.
 */
export async function shareDoc(name: string, purpose: 'share' | 'save' = 'share'): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    const uri = await localUri();
    if (!uri) return false;
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: purpose === 'save' ? `${name} 저장` : name });
    return true;
  } catch {
    return false;
  }
}
