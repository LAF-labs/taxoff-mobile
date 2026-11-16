// 가림 자가 점검(ADR-047). PC가 꺼졌을 때 폰이 모델을 부르기 전에, 이 기기의 JS 엔진(Hermes)에서 가림 규칙이 PC와 같이 도는지 한 번 본다.
// 실제 길(PhoneChat → 모델 포트) 그대로 가짜 모델에 한 문장을 보내 나가는 글에 원값이 없고 토큰이 있는지 본다.
// 실패하면 폰 대화를 열지 않는다(닫힌 쪽으로 실패: 정규식·정규화가 엔진에서 다르게 돌면 원값이 나갈 수 있다).
import { PhoneChat, type PhoneCopy, type PhoneModel } from '@sax/chat-core';

const SAMPLE = '한빛전자(220-81-62517)에 55만원 끊어줘, 메일은 tax@hanbit.example';
const RAW = ['한빛전자', '220-81-62517', '55만원', '550000', 'tax@hanbit.example', 'hanbit'];
const COPY: PhoneCopy = {
  asOf: 0,
  profile: { id: 'self', name: '점검상회', bizNo: '123-45-67890' },
  counterparties: [{ id: 'c1', name: '한빛전자', email: 'tax@hanbit.example', bizNo: '220-81-62517', item: '컨설팅' }],
  issued: [],
  receivables: [],
};

/** 점검 결과. ok가 거짓이면 reason에 어디서 막혔는지(원값 없이) 적는다. */
export interface SelfCheck {
  ok: boolean;
  reason?: 'raw_value_sent' | 'no_tokens' | 'not_called' | 'threw';
}

export async function maskingSelfCheck(randomHex: () => string): Promise<SelfCheck> {
  const sent: string[] = [];
  const model: PhoneModel = {
    runToken: async () => 'selfcheck',
    respond: async (req) => {
      sent.push(String(req.text));
      return { status: 'completed', output: { kind: 'smalltalk', text: '네.', show: [], ask: null }, toolCalls: [], replay: [] };
    },
  };
  let n = 0;
  const chat = new PhoneChat({
    model,
    store: { load: async () => null, save: async () => undefined },
    copy: () => ({ ...COPY, asOf: Date.now() }),
    now: Date.now,
    newId: () => `01KB${String(++n).padStart(22, '0')}`,
    randomHex,
  });
  try {
    await chat.send(SAMPLE);
  } catch {
    return { ok: false, reason: 'threw' };
  }
  const out = sent.join('\n');
  if (!out) return { ok: false, reason: 'not_called' };
  if (RAW.some((r) => out.includes(r))) return { ok: false, reason: 'raw_value_sent' };
  if (!/\[NAME_\d+\]/.test(out) || !/\[AMT_\d+\]/.test(out) || !/\[BIZNO_\d+\]/.test(out)) return { ok: false, reason: 'no_tokens' };
  return { ok: true };
}
