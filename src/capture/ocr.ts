import { Platform } from 'react-native';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { linesToBoxes, type OcrBox } from './invoice.ts';

type OcrEngineId = 'ios_vision' | 'none';

interface OcrEngine {
  id: OcrEngineId;
  read(uri: string): Promise<string[]>;
  boxes(uri: string): Promise<OcrBox[]>;
}

const none: OcrEngine = { id: 'none', read: async () => [], boxes: async () => [] };

const clamp = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const iosVision: OcrEngine = {
  id: 'ios_vision',
  async read(uri) {
    try {
      return (await SaxNative!.recognizeText(uri)).slice(0, 200).map((l) => l.slice(0, 200));
    } catch {
      return [];
    }
  },
  async boxes(uri) {
    try {
      if (!SaxNative!.recognizeTextBoxes) return linesToBoxes(await this.read(uri));
      const raw = await SaxNative!.recognizeTextBoxes(uri);
      return raw.slice(0, 400).map((b) => ({ text: String(b.text).slice(0, 200), x: clamp(b.x), y: clamp(b.y), w: clamp(b.w), h: clamp(b.h), conf: clamp(b.conf) }));
    } catch {
      return [];
    }
  },
};

export function ocrEngine(enabled = true): OcrEngine {
  if (!enabled) return none;
  if (Platform.OS === 'ios' && SaxNative?.ocrAvailable()) return iosVision;
  return none;
}
