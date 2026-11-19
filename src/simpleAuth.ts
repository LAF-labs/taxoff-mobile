// 폰에서 시작하는 간편인증 시트의 단계와 값 검사(순수 함수, 시험용). 화면은 screens/SimpleAuthSheet.tsx.
import { PASS_CARRIERS, SIMPLE_APPS } from './run.ts';
import type { SimpleId } from './storage/state.ts';

export type SimpleStep = 'confirm' | 'app' | 'carrier' | 'name' | 'birth' | 'phone';

export interface SimpleDraft {
  provider: string;
  /** PASS만 */
  carrier: string;
  name: string;
  /** 입력 표기(YYYY-MM-DD) */
  birth: string;
  /** 입력 표기(010-1234-5678) */
  phone: string;
}

export const draftOf = (id?: SimpleId | null): SimpleDraft => ({
  provider: id?.provider ?? '',
  carrier: id?.carrier ?? '',
  name: id?.name ?? '',
  birth: id?.birth ? `${id.birth.slice(0, 4)}-${id.birth.slice(4, 6)}-${id.birth.slice(6, 8)}` : '',
  phone: id?.phone ? id.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') : '',
});

/** 한 칸 검사(그 단계의 [다음]을 켠다) */
export function stepOk(step: SimpleStep, d: SimpleDraft): boolean {
  if (step === 'app') return SIMPLE_APPS.some((a) => a.code === d.provider);
  if (step === 'carrier') return PASS_CARRIERS.some((c) => c.code === d.carrier);
  if (step === 'name') return /^[가-힣A-Za-z][가-힣A-Za-z ]{0,19}$/.test(d.name.trim());
  if (step === 'birth') return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(d.birth.replace(/\D/g, ''));
  if (step === 'phone') return /^01[016789]\d{7,8}$/.test(d.phone.replace(/\D/g, ''));
  return toId(d) !== null;
}

/** 다 맞으면 보낼 값 */
export function toId(d: SimpleDraft): SimpleId | null {
  const steps: SimpleStep[] = ['app', ...(d.provider === 'pass' ? (['carrier'] as const) : []), 'name', 'birth', 'phone'];
  if (!steps.every((s) => stepOk(s, d))) return null;
  return { provider: d.provider, name: d.name.trim(), birth: d.birth.replace(/\D/g, ''), phone: d.phone.replace(/\D/g, ''), ...(d.provider === 'pass' ? { carrier: d.carrier } : {}) };
}

/** 단계 순서(PASS면 통신사가 낀다) */
export const stepsOf = (d: SimpleDraft): SimpleStep[] => ['app', ...(d.provider === 'pass' ? (['carrier'] as const) : []), 'name', 'birth', 'phone'];

