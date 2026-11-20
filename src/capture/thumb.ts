import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface Thumb {
  w: number;
  h: number;
  data: string;
}

const THUMB_W = 16;

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

export function jpegUri(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(s)}`;
}
