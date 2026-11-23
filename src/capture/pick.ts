import * as ImagePicker from 'expo-image-picker';

type Picked = { kind: 'image'; uri: string; width: number; height: number } | { kind: 'pdf' } | null;

export async function pickPhoto(): Promise<Picked> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  if (a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.fileName ?? a.uri)) return { kind: 'pdf' };
  return { kind: 'image', uri: a.uri, width: a.width, height: a.height };
}

export const PDF_LINE = 'PDF는 아직 못 읽어요. 화면을 캡처해서 올려 주세요';
