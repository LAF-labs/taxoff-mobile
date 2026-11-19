// 영수증 사진의 아주 작은 미리보기(가로 16px JPEG, 몇백 바이트). 대화 카드가 사진이 오기 전에
// 사진 비율만큼 자리를 잡고 이 흐린 그림을 먼저 둔다(사진이 늦게 와도 화면이 튀지 않게, 11-19).
// 원본은 PC가 받으면 지우지만 이 미리보기는 대화 기록(recent)에 남는다. 글자를 읽을 수 없는 크기라 개인 정보가 드러나지 않는다.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface Thumb {
  /** 원본 폭·높이(비율만 쓴다) */
  w: number;
  h: number;
  /** data:image/jpeg;base64,… */
  data: string;
}

export const THUMB_W = 16;

export async function makeThumb(uri: string, w: number, h: number): Promise<Thumb | null> {
  if (!(w > 0 && h > 0)) return null;
  try {
    const img = await ImageManipulator.manipulate(uri).resize({ width: THUMB_W }).renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });
    return out.base64 ? { w, h, data: `data:image/jpeg;base64,${out.base64}` } : null;
  } catch {
    return null;
  }
}

/** 사진 바이트 → data URI(대화 카드가 보관함의 원본을 보일 때) */
export function jpegUri(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(s)}`;
}
