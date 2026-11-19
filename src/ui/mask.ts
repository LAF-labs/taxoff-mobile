// 입력 칸 표기(금액 천 단위 쉼표, 사업자번호·날짜 하이픈). 순수 함수.
export type Mask = 'won' | 'bizNo' | 'day' | 'text' | 'email' | 'phone';

/** 입력 중 표기 맞추기. 저장 값은 parse 쪽에서 숫자만 다시 뽑는다. */
export function masked(m: Mask, raw: string): string {
  if (m === 'text') return raw;
  if (m === 'email') return raw.replace(/\s/g, '');
  const d = raw.replace(/\D/g, '');
  if (m === 'won') return d ? Number(d.slice(0, 12)).toLocaleString('ko-KR') : '';
  if (m === 'phone') return [d.slice(0, 3), d.slice(3, d.length > 10 ? 7 : 6), d.slice(d.length > 10 ? 7 : 6, 11)].filter(Boolean).join('-');
  if (m === 'bizNo') return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 10)].filter(Boolean).join('-');
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-');
}

