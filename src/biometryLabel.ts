export type BioKind = 'faceId' | 'touchId' | 'fingerprint' | 'face' | 'iris' | 'none';

export function unlockLabel(kind: BioKind): string {
  switch (kind) {
    case 'faceId':
      return 'Face ID로 열기';
    case 'touchId':
      return 'Touch ID로 열기';
    case 'fingerprint':
      return '지문으로 열기';
    case 'face':
      return '얼굴로 열기';
    case 'iris':
      return '홍채로 열기';
    default:
      return '열기';
  }
}

export function bioName(kind: BioKind): string {
  return { faceId: 'Face ID', touchId: 'Touch ID', fingerprint: '지문', face: '얼굴', iris: '홍채', none: '생체 없음' }[kind];
}

export function pickKind(types: Array<'face' | 'fingerprint' | 'iris'>, os: 'ios' | 'android' | string): BioKind {
  if (types.includes('face')) return os === 'ios' ? 'faceId' : 'face';
  if (types.includes('fingerprint')) return os === 'ios' ? 'touchId' : 'fingerprint';
  if (types.includes('iris')) return 'iris';
  return 'none';
}
