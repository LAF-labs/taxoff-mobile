import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface PathProtection {
  excludedFromBackup: boolean;
  protection: string;
}

declare class SaxNativeModule extends NativeModule<Record<string, never>> {
  protectPath(uri: string): Promise<PathProtection>;
  inspectPath(uri: string): Promise<PathProtection>;
  ocrAvailable(): boolean;
  recognizeText(uri: string): Promise<string[]>;
  vaultSet?(service: string, account: string, value: string): Promise<void>;
  vaultGet?(service: string, account: string, prompt: string, passcode: boolean): Promise<string | null>;
  vaultDelete?(service: string, account: string): Promise<void>;
  vaultPolicy?(): { accessible: string; auth: string };
  pxPublic?(tag: string): Promise<string | null>;
  pxCreate?(tag: string): Promise<string>;
  pxSign?(tag: string, dataB64: string, prompt: string): Promise<string | null>;
  pxDelete?(tag: string): Promise<void>;
  /** 문서함: PDF를 애플 기본 미리보기로 띄우고 닫힐 때 끝난다(iOS만). */
  previewFile?(uri: string, title: string): Promise<void>;
  uxPublic?(tag: string): Promise<string | null>;
  uxCreate?(tag: string): Promise<string>;
  uxDelete?(tag: string): Promise<void>;
  uxGrant?(tag: string, eB64: string, txPubB64: string, aadB64: string, prompt: string): Promise<{ enc: string; ct: string } | null>;
  recognizeTextBoxes?(uri: string): Promise<Array<{ text: string; x: number; y: number; w: number; h: number; conf: number }>>;
}

export default requireOptionalNativeModule<SaxNativeModule>('SaxNative');
