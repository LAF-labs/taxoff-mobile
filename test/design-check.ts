// 화면 확정 규칙(docs/design.md "확정 기준 v3.0") 검사.
// 사용: node test/design-check.ts            어긋난 곳이 기준선보다 늘면 실패
//       node test/design-check.ts --list     어긋난 곳을 모두 찍는다
//       node test/design-check.ts --update   줄었을 때 기준선을 낮춘다(늘었으면 쓰지 않고 실패)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
export const BASELINE_PATH = path.join(ROOT, 'test/design-baseline.json');
const UI_DIR = 'src/ui/';
const THEME = 'src/theme.ts';

export const RULES = {
  border: '화면 코드에서 테두리를 직접 그리지 않는다. 카드, 줄, 입력 칸은 src/ui 부품을 쓴다.',
  'overlay-adhoc': '시트와 확인 창은 src/ui의 공용 부품으로만 띄운다. 화면에서 Modal과 딤을 직접 그리지 않는다.',
  'raw-color': '색은 src/theme.ts 토큰으로만 쓴다.',
  'raw-type': '글자 크기는 src/theme.ts의 type으로만 쓴다.',
  'raw-radius': '모서리 값은 src/theme.ts의 radius로만 쓴다.',
} as const;
export type Rule = keyof typeof RULES;
export interface Hit {
  rule: Rule;
  file: string;
  line: number;
  text: string;
}
export type Counts = Partial<Record<Rule, Record<string, number>>>;

/** 주석을 같은 길이의 빈칸으로 바꾼다(줄 번호 유지). 문자열 안의 //는 건드리지 않는다. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i] ?? '';
    const n = src[i + 1] ?? '';
    if (q) {
      out += c;
      if (c === '\\') {
        out += n;
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      if (c === "'" || c === '"' || c === '`') q = c;
      out += c;
      i++;
    }
  }
  return out;
}

function sources(): string[] {
  const out: string[] = ['App.tsx'];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) out.push(rel);
    }
  };
  walk('src');
  return out.sort();
}

export function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sources()) {
    const shared = file.startsWith(UI_DIR);
    const lines = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8')).split('\n');
    lines.forEach((text, i) => {
      const hit = (rule: Rule) => hits.push({ rule, file, line: i + 1, text: text.trim().slice(0, 160) });
      if (!shared && /\bborder(Top|Bottom|Left|Right)?Width\b/.test(text)) hit('border');
      if (!shared && (/<Modal\b/.test(text) || /\bp\.(scrim|dim)\b/.test(text))) hit('overlay-adhoc');
      if (file !== THEME && /['"]#[0-9a-fA-F]{3,8}['"]/.test(text)) hit('raw-color');
      if (file !== THEME && /\bfontSize:\s*\d/.test(text)) hit('raw-type');
      if (file !== THEME && /\bborder\w*Radius:\s*\d/.test(text)) hit('raw-radius');
    });
  }
  return hits;
}

export function count(hits: Hit[]): Counts {
  const c: Counts = {};
  for (const h of hits) {
    const byFile = (c[h.rule] ??= {});
    byFile[h.file] = (byFile[h.file] ?? 0) + 1;
  }
  const sorted: Counts = {};
  for (const rule of (Object.keys(c) as Rule[]).sort()) {
    const byFile = c[rule] ?? {};
    sorted[rule] = Object.fromEntries(Object.keys(byFile).sort().map((f) => [f, byFile[f] ?? 0]));
  }
  return sorted;
}

export interface Change {
  rule: Rule;
  file: string;
  now: number;
  base: number;
}

/** 기준선보다 늘어난 곳과 줄어든 곳. 늘면 실패, 줄면 기준선을 다시 쓰라고 알린다. */
export function compare(now: Counts, base: Counts): { worse: Change[]; better: Change[] } {
  const worse: Change[] = [];
  const better: Change[] = [];
  for (const rule of new Set([...Object.keys(now), ...Object.keys(base)]) as Set<Rule>) {
    for (const file of new Set([...Object.keys(now[rule] ?? {}), ...Object.keys(base[rule] ?? {})])) {
      const a = now[rule]?.[file] ?? 0;
      const b = base[rule]?.[file] ?? 0;
      if (a > b) worse.push({ rule, file, now: a, base: b });
      if (a < b) better.push({ rule, file, now: a, base: b });
    }
  }
  return { worse, better };
}

export const readBaseline = (): Counts => JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Counts;

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const hits = scan();
  const now = count(hits);
  if (process.argv.includes('--update')) {
    // 기준선은 줄이기만 한다. 어느 파일이든 늘었으면 쓰지 않고 실패한다.
    const grown = compare(now, readBaseline()).worse;
    if (grown.length) {
      for (const w of grown) process.stderr.write(`어긋남이 늘어 기준선을 쓰지 않았어요. ${w.rule} ${w.file}: ${w.base} → ${w.now}곳\n`);
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(now, null, 2)}\n`);
    process.stdout.write(`기준선을 다시 썼어요: ${hits.length}곳\n`);
  } else {
    if (process.argv.includes('--list')) for (const h of hits) process.stdout.write(`${h.rule}\t${h.file}:${h.line}\t${h.text}\n`);
    const { worse, better } = compare(now, readBaseline());
    for (const w of worse) {
      process.stderr.write(`어긋남 ${w.rule} ${w.file}: ${w.base} → ${w.now}곳. ${RULES[w.rule]}\n`);
      for (const h of hits.filter((x) => x.rule === w.rule && x.file === w.file)) process.stderr.write(`  ${h.file}:${h.line}  ${h.text}\n`);
    }
    for (const b of better) process.stdout.write(`줄었어요 ${b.rule} ${b.file}: ${b.base} → ${b.now}곳. node test/design-check.ts --update 로 기준선을 낮춰 주세요.\n`);
    process.stdout.write(`어긋난 곳 ${hits.length}곳(기준선과 비교)\n`);
    if (worse.length) process.exit(1);
  }
}
