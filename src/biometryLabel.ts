// 잠금 해제 단추 문구: 기기가 가진 생체 종류에 맞춘다. 순수 함수(시험용).
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

/** 설정 줄에 쓰는 이름 */
export function bioName(kind: BioKind): string {
  return { faceId: 'Face ID', touchId: 'Touch ID', fingerprint: '지문', face: '얼굴', iris: '홍채', none: '생체 없음' }[kind];
}

/** OS가 알려 준 생체 종류(여러 개면 얼굴 > 지문 > 홍채)와 플랫폼으로 이름을 고른다. */
export function pickKind(types: Array<'face' | 'fingerprint' | 'iris'>, os: 'ios' | 'android' | string): BioKind {
  if (types.includes('face')) return os === 'ios' ? 'faceId' : 'face';
  if (types.includes('fingerprint')) return os === 'ios' ? 'touchId' : 'fingerprint';
  if (types.includes('iris')) return 'iris';
  return 'none';
}
