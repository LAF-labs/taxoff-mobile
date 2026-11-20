export function josa(word: string, withFinal: string, without: string): string {
  const c = word.trim().slice(-1).charCodeAt(0);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return word + (hangul && (c - 0xac00) % 28 !== 0 ? withFinal : without);
}
