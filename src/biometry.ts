import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { pickKind, type BioKind } from './biometryLabel';

export interface BioInfo {
  kind: BioKind;
  enrolled: boolean;
}

async function bioInfo(): Promise<BioInfo> {
  try {
    const t = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const A = LocalAuthentication.AuthenticationType;
    const types = t.map((x) => (x === A.FACIAL_RECOGNITION ? 'face' : x === A.FINGERPRINT ? 'fingerprint' : 'iris') as 'face' | 'fingerprint' | 'iris');
    return { kind: pickKind(types, Platform.OS), enrolled: await LocalAuthentication.isEnrolledAsync() };
  } catch {
    return { kind: 'none', enrolled: false };
  }
}

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
