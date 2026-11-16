/** 받침에 맞춘 조사: josa('동네마트 성수점', '은', '는') → '동네마트 성수점은'. 한글이 아니면(숫자·영문) 뒤 것을 쓴다. */
export function josa(word: string, withFinal: string, without: string): string {
  const c = word.trim().slice(-1).charCodeAt(0);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return word + (hangul && (c - 0xac00) % 28 !== 0 ? withFinal : without);
}
