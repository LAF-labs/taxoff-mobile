import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOT = '·';

const DIRS = ['src', 'vendor/sax-chat-core/src'];

const ALLOW_LINE: Array<{ file: string; re: RegExp; why: string }> = [
  { file: 'vendor/sax-chat-core/src/reply-check.ts', re: /replace\(\//, why: '모델 답의 가운데점을 쉼표로 바꾸는 정규식' },
];

const walk = (dir: string, out: string[]): void => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
};

const isComment = (line: string): boolean => {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
};

describe('폰 화면 문구에 가운데점(·)을 쓰지 않는다', () => {
  it('src와 대화 코어 사본에는 가운데점이 없다', () => {
    const files: string[] = [];
    for (const d of DIRS) walk(d, files);
    assert.ok(files.length > 50, `점검 대상이 너무 적다: ${files.length}`);
    const bad: string[] = [];
    for (const f of files) {
      fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (!line.includes(DOT) || isComment(line)) return;
        if (ALLOW_LINE.some((a) => a.file === f && a.re.test(line))) return;
        bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(bad, [], `가운데점은 공백, 쉼표, 줄바꿈, 슬래시 중 자연스러운 것으로 바꾼다:\n${bad.join('\n')}`);
  });

  it('예외 목록은 실제로 쓰이고 있다', () => {
    for (const a of ALLOW_LINE) {
      const hit = fs.readFileSync(path.join(ROOT, a.file), 'utf8').split('\n').some((l) => l.includes(DOT) && !isComment(l) && a.re.test(l));
      assert.ok(hit, `${a.file}: 예외(${a.why})가 더는 필요 없다. 목록에서 지운다`);
    }
  });
});
