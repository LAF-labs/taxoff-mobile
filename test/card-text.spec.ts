// 카드 글자에 null, undefined, NaN이 새지 않는지 본다(대표 지적 11-26: 발급을 중지하면 카드에 "null"이 보였다).
// 진행 카드 제목, 합계, 알림 줄은 PC가 보낸 명령 상태에서 만든다. 값이 비어 들어와도 그 조각만 빠져야 한다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REJECT_LINE, jobOf, type PhoneCmd } from '../src/phoneCmd.ts';
import { runEvents } from '../src/notify/events.ts';
import { STOP_COPY } from '../src/run.ts';
import { joinShown, shown } from '../src/ui/text.ts';

const LEAK = /\b(null|undefined|NaN)\b|\[object /;
const base: PhoneCmd = {
  cmdId: '01JD8Z6Q3B9K2M4N5P7R8S9T0V',
  req: { v: 1, target: { counterpartyRef: 'cp-1' }, supply: 300_000, item: '꽃', day: '2026-11-26' } as unknown as PhoneCmd['req'],
  cpName: '새봄꽃집',
  total: 330_000,
  createdAt: 1_700_000_000_000,
  sentAt: 1_700_000_000_100,
  ack: 'accepted' as PhoneCmd['ack'],
  runId: 'run-1',
};
const phases: Array<Partial<PhoneCmd>> = [{}, { phase: 'login' }, { phase: 'approve' }, { phase: 'stopped' }, { phase: 'stopped', code: 'app_old' }, { phase: 'stopped', code: 'in_doubt' }, { phase: 'done' }];

describe('폰 카드 글자에 빈 값이 새지 않는다', () => {
  it('거래처 이름, 제목, 합계가 비어 들어와도 제목과 알림 줄에 남지 않는다', () => {
    const found: string[] = [];
    for (const p of phases)
      for (const empty of [{ cpName: null }, { cpName: undefined }, { cpName: '' }, { title: null }, { title: '' }, { total: undefined }, { total: Number.NaN }]) {
        const c = { ...base, ...p, ...empty } as unknown as PhoneCmd;
        const before = jobOf({ ...c, phase: 'approve' } as PhoneCmd);
        const job = jobOf(c);
        const lines = [job.title, ...runEvents([before], [job]).flatMap((e) => [e.title, e.line, e.os.title, e.os.body])];
        for (const t of lines) if (LEAK.test(String(t))) found.push(`${JSON.stringify({ ...p, ...empty })}: ${t}`);
      }
    assert.deepEqual(found, []);
  });

  it('중지했을 때 제목은 이름이 없으면 "세금계산서"만', () => {
    assert.equal(jobOf({ ...base, phase: 'stopped', cpName: null } as unknown as PhoneCmd).title, '세금계산서');
    assert.equal(jobOf({ ...base, phase: 'stopped' }).title, '새봄꽃집 세금계산서');
  });

  it('고정 문구에도 빈 값 흔적이 없다', () => {
    for (const t of [...Object.values(STOP_COPY).map((x) => x.line), ...Object.values(REJECT_LINE)]) assert.ok(!LEAK.test(t), t);
  });

  it('공용 처리: 빈 값은 그리지 않는다', () => {
    assert.equal(shown(null), null);
    assert.equal(shown(undefined), null);
    assert.equal(shown(' '), null);
    assert.equal(shown(Number.NaN), null);
    assert.equal(shown(0), 0);
    assert.equal(joinShown(['새봄꽃집', null, undefined, '', '세금계산서'], ' '), '새봄꽃집 세금계산서');
  });
});
