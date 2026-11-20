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
