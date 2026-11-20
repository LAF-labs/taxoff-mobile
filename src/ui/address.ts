export function glueAddress(a: string): string {
  const parts = a.split(/ +/);
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i]!;
    const prev = parts[i - 1]!;
    const glue = /^\d/.test(t) || (/,$/.test(prev) && t.length <= 6) || /^\(/.test(t);
    out += (glue ? '\u00A0' : ' ') + t;
  }
  return out;
}
