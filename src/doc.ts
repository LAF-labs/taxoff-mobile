import { Asset } from 'expo-asset';
import * as Sharing from 'expo-sharing';
import { SAMPLE_DOC } from './queueStore';

async function localUri(): Promise<string | null> {
  const a = Asset.fromModule(SAMPLE_DOC);
  await a.downloadAsync();
  return a.localUri ?? null;
}

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
