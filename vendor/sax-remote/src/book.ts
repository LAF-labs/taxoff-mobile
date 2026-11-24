import type { CmdRunBody } from './envelope.ts';

/** 폰이 PC 거래처 장부에 거래처 하나를 넣거나 고치는 명령(ADR-066). cmd.run으로 실시간이나 큐로 간다. */
export const COUNTERPARTY_SAVE = 'book.counterparty_save';

export const BOOK_FIELD_MAX = { name: 60, rep: 100, email: 254, item: 100 } as const;

/**
 * ref가 있으면 그 거래처를 고치고(등록번호는 바꾸지 않는다), 없으면 등록번호로 새로 넣는다.
 * 고칠 때 email이 없으면 지금 주소를 그대로 둔다(폰은 가린 주소만 안다). 빈 문자열은 지운다는 뜻이다.
 */
export interface PhoneCounterpartySave {
  ref?: string;
  bizNo: string;
  name: string;
  rep?: string;
  email?: string;
  item?: string;
}

const REF = /^[A-Za-z0-9_-]{1,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIZNO = /^\d{3}-\d{2}-\d{5}$/;

/** 사업자등록번호 형식(000-00-00000)과 검증 숫자. */
export function isBizNo(v: string): boolean {
  if (!BIZNO.test(v)) return false;
  const d = v.replace(/\D/g, '').split('').map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i]! * w[i]!;
  sum += Math.floor((d[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

export function bizNoDashed(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
}

const KEYS = new Set(['ref', 'bizNo', 'name', 'rep', 'email', 'item']);

/** 맞지 않으면 이유 이름. 폰은 보내기 전에, PC는 받을 때 같은 검사를 한다. */
export function checkCounterpartySave(s: PhoneCounterpartySave): 'ref' | 'bizNo' | 'name' | 'rep' | 'email' | 'item' | null {
  if (s.ref !== undefined && !REF.test(s.ref)) return 'ref';
  if (!isBizNo(s.bizNo)) return 'bizNo';
  const name = s.name.trim();
  if (name.length < 1 || name.length > BOOK_FIELD_MAX.name) return 'name';
  if (s.rep !== undefined && s.rep.trim().length > BOOK_FIELD_MAX.rep) return 'rep';
  if (s.email !== undefined && s.email.trim() !== '' && (s.email.trim().length > BOOK_FIELD_MAX.email || !EMAIL.test(s.email.trim()))) return 'email';
  if (s.item !== undefined && s.item.trim().length > BOOK_FIELD_MAX.item) return 'item';
  return null;
}

export function counterpartySaveCmd(cmdId: string, s: PhoneCounterpartySave): CmdRunBody {
  const bad = checkCounterpartySave(s);
  if (bad) throw new Error(`book: bad ${bad}`);
  const inputs: Record<string, unknown> = { bizNo: s.bizNo, name: s.name.trim() };
  if (s.ref !== undefined) inputs.ref = s.ref;
  for (const k of ['rep', 'email', 'item'] as const) if (s[k] !== undefined) inputs[k] = s[k]!.trim();
  return { cmdId, playbookId: COUNTERPARTY_SAVE, inputs };
}

/** PC가 받은 inputs를 읽는다. 모르는 키나 맞지 않는 값이 있으면 null. */
export function parseCounterpartySave(inputs: unknown): PhoneCounterpartySave | null {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return null;
  const o = inputs as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.has(k))) return null;
  if (typeof o.bizNo !== 'string' || typeof o.name !== 'string') return null;
  for (const k of ['ref', 'rep', 'email', 'item'] as const) if (o[k] !== undefined && typeof o[k] !== 'string') return null;
  const s: PhoneCounterpartySave = { bizNo: o.bizNo, name: o.name };
  for (const k of ['ref', 'rep', 'email', 'item'] as const) if (o[k] !== undefined) s[k] = o[k] as string;
  return checkCounterpartySave(s) ? null : s;
}
