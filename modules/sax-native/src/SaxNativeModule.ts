import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface PathProtection {
  excludedFromBackup: boolean;
  /** iOS: FileProtectionType 원문(예: NSFileProtectionComplete), Android: app_private */
  protection: string;
}

declare class SaxNativeModule extends NativeModule<Record<string, never>> {
  protectPath(uri: string): Promise<PathProtection>;
  inspectPath(uri: string): Promise<PathProtection>;
  ocrAvailable(): boolean;
  recognizeText(uri: string): Promise<string[]>;
  /** 글자 상자(0~1, 위·왼쪽 0). 옛 빌드에는 없다(호출하는 쪽이 recognizeText로 물러난다). */
  /**
   * 앱 진입 키 항목(D08 §3.1 '앱 잠금'): 생체 또는 폰 암호(iOS userPresence, Android BIOMETRIC_STRONG|DEVICE_CREDENTIAL),
   * 이 기기만·폰 암호 필요. 오류 message: cancel · passcode_not_set · keychain_* · keystore_*. 옛 빌드에는 없다.
   */
  vaultSet?(service: string, account: string, value: string): Promise<void>;
  vaultGet?(service: string, account: string, prompt: string, passcode: boolean): Promise<string | null>;
  vaultDelete?(service: string, account: string): Promise<void>;
  vaultPolicy?(): { accessible: string; auth: string };
  recognizeTextBoxes?(uri: string): Promise<Array<{ text: string; x: number; y: number; w: number; h: number; conf: number }>>;
}

/** 네이티브 빌드에만 있다. 없으면 null이고, 호출하는 쪽은 사진을 저장하지 않는다(fail-closed). */
export default requireOptionalNativeModule<SaxNativeModule>('SaxNative');
