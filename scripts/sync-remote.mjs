// @sax/remote 고정 사본 맞추기. 정본은 LAF-labs/tex의 poc/packages/remote이고, 이 레포에서는 고치지 않는다.
// 쓰는 법: node scripts/sync-remote.mjs <tex 체크아웃 경로> [--check]
//   tex 체크아웃의 HEAD 커밋을 vendor/sax-remote/VENDORED_FROM에 적고 src·스키마 두 개를 그대로 복사한다.
//   --check: 복사하지 않고 사본이 그 커밋과 같은지만 본다(CI가 tex를 받아 돌린다).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [texDir, flag] = process.argv.slice(2);
if (!texDir) {
  process.stderr.write('usage: node scripts/sync-remote.mjs <tex checkout> [--check]\n');
  process.exit(2);
}
const here = path.resolve(import.meta.dirname, '..');
const dest = path.join(here, 'vendor/sax-remote');
const sources = [
  ['poc/packages/remote/src', 'src'],
  ['sovereign-ax/design/schemas/remote-envelope.schema.json', 'remote-envelope.schema.json'],
  ['sovereign-ax/design/schemas/intent-envelope.schema.json', 'intent-envelope.schema.json'],
];
const sha = execFileSync('git', ['-C', texDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function files(dir, base = dir) {
  if (!fs.statSync(dir).isDirectory()) return [[path.basename(dir), dir]];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, base).map(([r, a]) => [path.join(path.relative(base, dir), r).replace(/^\.\//, ''), a]) : [[path.relative(base, p), p]];
  });
}

if (flag === '--check') {
  const pinned = fs.readFileSync(path.join(dest, 'VENDORED_FROM'), 'utf8').match(/^commit: ([0-9a-f]{40})$/m)?.[1];
  let bad = 0;
  for (const [from, to] of sources) {
    const src = path.join(texDir, from);
    const rows = fs.statSync(src).isDirectory() ? files(src).map(([r, a]) => [path.join(to, r), a]) : [[to, src]];
    for (const [rel, abs] of rows) {
      const mine = path.join(dest, rel);
      if (!fs.existsSync(mine) || !fs.readFileSync(mine).equals(fs.readFileSync(abs))) {
        process.stderr.write(`다름: vendor/sax-remote/${rel}\n`);
        bad++;
      }
    }
  }
  if (pinned !== sha) process.stderr.write(`VENDORED_FROM ${pinned} ≠ tex HEAD ${sha}\n`);
  process.exit(bad ? 1 : 0);
}

fs.rmSync(path.join(dest, 'src'), { recursive: true, force: true });
for (const [from, to] of sources) fs.cpSync(path.join(texDir, from), path.join(dest, to), { recursive: true });
fs.writeFileSync(
  path.join(dest, 'VENDORED_FROM'),
  `repo: LAF-labs/tex\ncommit: ${sha}\npaths: ${sources.map(([f]) => f).join(', ')}\n\n이 폴더는 tex 정본의 사본이다. 여기서 고치지 말고 tex에서 고친 뒤 pnpm sync:remote <tex 경로>로 다시 맞춘다.\n`,
);
process.stdout.write(`vendor/sax-remote ← tex ${sha.slice(0, 12)}\n`);
