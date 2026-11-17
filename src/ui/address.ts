/**
 * 주소 보기 표기: 번지·층·호 같은 짧은 덩어리는 앞 낱말에 붙은 칸(U+00A0)으로 묶어 "성수이로 00, / 1층"처럼 갈라지지 않게 한다.
 * 줄은 시·구·로 사이 같은 긴 낱말 사이에서만 바뀐다. 저장 값은 바꾸지 않는다(보기 전용).
 */
export function glueAddress(a: string): string {
  const parts = a.split(/ +/);
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i]!;
    const prev = parts[i - 1]!;
    // 숫자로 시작하는 덩어리(번지·층·호), 쉼표 뒤 짧은 덩어리, 괄호 덩어리는 앞에 붙인다
    const glue = /^\d/.test(t) || (/,$/.test(prev) && t.length <= 6) || /^\(/.test(t);
    out += (glue ? '\u00A0' : ' ') + t;
  }
  return out;
}
