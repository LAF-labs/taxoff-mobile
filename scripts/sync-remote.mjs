import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGES = {
  remote: {
    dir: 'sax-remote',
    name: '@sax/remote',
    sources: [
      ['poc/packages/remote/src', 'src'],
      ['sovereign-ax/design/schemas/remote-envelope.schema.json', 'remote-envelope.schema.json'],
      ['sovereign-ax/design/schemas/intent-envelope.schema.json', 'intent-envelope.schema.json'],
    ],
  },
  redaction: { dir: 'sax-redaction', name: '@sax/redaction', sources: [['poc/packages/redaction/src', 'src']] },
  'chat-core': { dir: 'sax-chat-core', name: '@sax/chat-core', sources: [['poc/packages/chat-core/src', 'src']] },
};

const args = process.argv.slice(2);
const check = args.includes('--check');
const [texDir, ...names] = args.filter((a) => a !== '--check');
if (!texDir || names.some((n) => !(n in PACKAGES))) {
  process.stderr.write(`usage: node scripts/sync-remote.mjs <tex checkout> [${Object.keys(PACKAGES).join('|')} ...] [--check]\n`);
  process.exit(2);
}
const picked = names.length ? names : Object.keys(PACKAGES);
const here = path.resolve(import.meta.dirname, '..');
const sha = execFileSync('git', ['-C', texDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function files(dir, base = dir) {
  if (!fs.statSync(dir).isDirectory()) return [[path.basename(dir), dir]];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, base).map(([r, a]) => [path.join(path.relative(base, dir), r).replace(/^\.\//, ''), a]) : [[path.relative(base, p), p]];
  });
}

let bad = 0;
for (const key of picked) {
  const { dir, name, sources } = PACKAGES[key];
  const dest = path.join(here, 'vendor', dir);
  if (check) {
    const pinned = fs.readFileSync(path.join(dest, 'VENDORED_FROM'), 'utf8').match(/^commit: ([0-9a-f]{40})$/m)?.[1];
    for (const [from, to] of sources) {
      const src = path.join(texDir, from);
      const rows = fs.statSync(src).isDirectory() ? files(src).map(([r, a]) => [path.join(to, r), a]) : [[to, src]];
      for (const [rel, abs] of rows) {
        const mine = path.join(dest, rel);
        if (!fs.existsSync(mine) || !fs.readFileSync(mine).equals(fs.readFileSync(abs))) {
          process.stderr.write(`다름: vendor/${dir}/${rel}\n`);
          bad++;
        }
      }
      const mineDir = path.join(dest, to);
      if (fs.existsSync(mineDir) && fs.statSync(mineDir).isDirectory()) {
        for (const [rel] of files(mineDir)) {
          if (!fs.existsSync(path.join(src, rel))) {
            process.stderr.write(`정본에 없음: vendor/${dir}/${to}/${rel}\n`);
            bad++;
          }
        }
      }
    }
    if (pinned !== sha) process.stderr.write(`vendor/${dir}: VENDORED_FROM ${pinned} ≠ tex HEAD ${sha}\n`);
    continue;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.rmSync(path.join(dest, 'src'), { recursive: true, force: true });
  for (const [from, to] of sources) fs.cpSync(path.join(texDir, from), path.join(dest, to), { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), `{ "type": "module", "private": true, "description": "tex ${sources[0][0].replace(/\/src$/, '')} 고정 사본(${name}). VENDORED_FROM 참고." }\n`);
  fs.writeFileSync(
    path.join(dest, 'VENDORED_FROM'),
    `repo: LAF-labs/tex\ncommit: ${sha}\npaths: ${sources.map(([f]) => f).join(', ')}\n\n이 폴더는 tex 정본의 사본이다. 여기서 고치지 말고 tex에서 고친 뒤 pnpm sync:remote <tex 경로> ${key}로 다시 맞춘다.\n`,
  );
  process.stdout.write(`vendor/${dir} ← tex ${sha.slice(0, 12)}\n`);
}
process.exit(bad ? 1 : 0);
