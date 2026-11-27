/**
 * 화면 글자에 넣을 값. 빈 값(null, undefined, 빈 글, 숫자가 아님)이면 null을 돌려 그 줄이나 조각을 그리지 않는다.
 * 카드 글에 "null", "undefined", "NaN"이 새지 않게 하는 공용 처리다(test/card-text.spec.ts가 지킨다). PC는 tex shell-views.js shown.
 */
export function shown<T>(v: T | null | undefined | false): T | null {
  if (v == null || v === false) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (typeof v === 'string' && !v.trim()) return null;
  return v;
}

/** 빈 조각은 빼고 sep으로 잇는다. */
export const joinShown = (parts: ReadonlyArray<string | number | null | undefined | false>, sep = ', '): string =>
  parts
    .map((x) => shown(x))
    .filter((x) => x !== null)
    .join(sep);
