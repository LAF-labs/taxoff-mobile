// 이 기기의 생체 종류·등록 상태(expo-local-authentication). 잠금 해제 자체는 생체로만 열리는 키 항목 읽기(keyring.unlock)이고,
// 여기서는 단추 문구와 안내만 고른다. 승인 서명(승인 시트)은 이것과 별개로 매번 생체 + 하드웨어 키다.
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { pickKind, type BioKind } from './biometryLabel';

export interface BioInfo {
  kind: BioKind;
  /** 생체를 등록했는지 */
  enrolled: boolean;
}

export async function bioInfo(): Promise<BioInfo> {
  try {
    const t = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const A = LocalAuthentication.AuthenticationType;
    const types = t.map((x) => (x === A.FACIAL_RECOGNITION ? 'face' : x === A.FINGERPRINT ? 'fingerprint' : 'iris') as 'face' | 'fingerprint' | 'iris');
    return { kind: pickKind(types, Platform.OS), enrolled: await LocalAuthentication.isEnrolledAsync() };
  } catch {
    return { kind: 'none', enrolled: false };
  }
}

/** 갤러리는 fixed로 고정한다. */
export function useBioInfo(fixed?: BioInfo): BioInfo | null {
  const [info, setInfo] = useState<BioInfo | null>(fixed ?? null);
  useEffect(() => {
    if (fixed) return;
    let live = true;
    void bioInfo().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [fixed]);
  return fixed ?? info;
}
