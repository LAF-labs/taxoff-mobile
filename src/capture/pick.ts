// 앨범에서 사진 하나 고르기(2026-11-16 대표 결정: 종이 증빙·사업자등록증 모두 카메라와 앨범 둘 다).
// iOS 14+는 시스템 사진 고르기(PHPicker)라 사진 권한 없이 고른 한 장만 앱에 온다. 앨범 전체를 읽거나 올리지 않는다.
// 돌아온 파일은 고르기가 앱 캐시에 만든 사본이다: 앱은 그 사본만 지우고, 사용자 앨범의 원본은 건드리지 않는다.
import * as ImagePicker from 'expo-image-picker';

export type Picked = { kind: 'image'; uri: string; width: number; height: number } | { kind: 'pdf' } | null;

export async function pickPhoto(): Promise<Picked> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  // 이미지 고르기에서는 보통 오지 않지만, PDF가 오면 아직 읽지 않는다(문서 고르기·PDF 읽기는 다음 PR)
  if (a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.fileName ?? a.uri)) return { kind: 'pdf' };
  return { kind: 'image', uri: a.uri, width: a.width, height: a.height };
}

export const PDF_LINE = 'PDF는 아직 못 읽어요 · 화면을 캡처해서 올려 주세요';
