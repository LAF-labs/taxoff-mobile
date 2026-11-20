interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function guideCrop(photo: { width: number; height: number }, view: { width: number; height: number }, guide: Rect): { originX: number; originY: number; width: number; height: number } {
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const ox = (photo.width - view.width / scale) / 2;
  const oy = (photo.height - view.height / scale) / 2;
  const x = Math.max(0, Math.round(ox + guide.x / scale));
  const y = Math.max(0, Math.round(oy + guide.y / scale));
  const w = Math.min(photo.width - x, Math.round(guide.w / scale));
  const h = Math.min(photo.height - y, Math.round(guide.h / scale));
  return { originX: x, originY: y, width: Math.max(1, w), height: Math.max(1, h) };
}

export function fitEdge(w: number, h: number, max: number): { width: number; height: number } | null {
  const long = Math.max(w, h);
  if (long <= max) return null;
  const k = max / long;
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

export const GUIDE_RATIO = { receipt: 1.6, invoice: 0.71, bizReg: 1.41 } as const;
export function guideRect(view: { width: number; height: number }, ratio: number = GUIDE_RATIO.receipt): Rect {
  let w = view.width * 0.88;
  let h = w * ratio;
  if (h > view.height * 0.8) {
    h = view.height * 0.8;
    w = h / ratio;
  }
  return { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
}
