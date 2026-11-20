// 폰 OCR 어댑터(P-08). iOS는 Vision(기기 안, 네트워크 없음), 나머지는 'none'(사진만 보내고 PC docparse가 읽는다, D14 §2.7).
// 한국어 정확도가 모자라면 기본을 'none'으로 내린다: 사진·확인 흐름은 같고 후보 칸만 비어 있다.
import { Platform } from 'react-native';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { linesToBoxes, type OcrBox } from './invoice.ts';

type OcrEngineId = 'ios_vision' | 'none';

interface OcrEngine {
  id: OcrEngineId;
  /** 파일 URI의 글자를 위에서 아래 줄 순서로. 실패하면 빈 배열(사진은 그대로 보낸다). */
  read(uri: string): Promise<string[]>;
  /** 글자 상자(위치 포함). 상자를 못 주는 빌드는 줄을 전폭 상자로 바꿔 준다. 실패하면 빈 배열. */
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

/** 앱 설정에서 끌 수 있다(정확도 시험 결과에 따라 기본값을 정한다). */
export function ocrEngine(enabled = true): OcrEngine {
  if (!enabled) return none;
  if (Platform.OS === 'ios' && SaxNative?.ocrAvailable()) return iosVision;
  return none;
}
