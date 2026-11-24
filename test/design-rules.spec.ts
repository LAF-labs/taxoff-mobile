import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compare, count, readBaseline, RULES, scan } from './design-check.ts';

describe('화면 확정 규칙', () => {
  it('어긋난 곳이 기준선보다 늘지 않는다', () => {
    const hits = scan();
    const { worse } = compare(count(hits), readBaseline());
    const lines = worse.flatMap((w) => [
      `${w.rule} ${w.file}: ${w.base} → ${w.now}곳. ${RULES[w.rule]}`,
      ...hits.filter((h) => h.rule === w.rule && h.file === w.file).map((h) => `  ${h.file}:${h.line}  ${h.text}`),
    ]);
    assert.deepEqual(lines, [], `docs/design.md "확정 기준 v3.0"을 따라 주세요.\n${lines.join('\n')}`);
  });

  it('기준선에 없는 규칙 이름이 없다', () => {
    for (const rule of Object.keys(readBaseline())) assert.ok(rule in RULES, rule);
  });
});
