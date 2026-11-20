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
  recognizeTextBoxes?(uri: string): Promise<Array<{ text: string; x: number; y: number; w: number; h: number; conf: number }>>;
}

export default requireOptionalNativeModule<SaxNativeModule>('SaxNative');
