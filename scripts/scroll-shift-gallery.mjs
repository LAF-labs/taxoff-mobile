#!/usr/bin/env node
// 폰 대화 스크롤 시험(갤러리, 웹): 긴 대화를 위로 올려 읽는 중 새 답이 오게 하고, 그 순간을 녹화해 scroll-shift.mjs로 밀린 거리를 잰다.
// 캡처도 남긴다(라이트·다크): 새 답 단추가 뜬 모습, 단추를 누른 뒤, 내가 보낸 말 뒤.
// 쓰기: pnpm gallery && node scripts/scroll-shift-gallery.mjs [출력 폴더]   (dist-gallery를 이 스크립트가 직접 띄운다)
//   GALLERY_DIR=다른/dist-gallery  고치기 전 빌드를 잴 때
// 키보드는 웹에 없으니 시뮬레이터 녹화로 잰다: xcrun simctl io booted recordVideo kb.mov → node scripts/scroll-shift.mjs --video kb.mov --crop … --scale 3
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// playwright는 이 레포 의존성이 아니다(무거워서). 전역이나 다른 폴더 것을 PLAYWRIGHT=/경로/node_modules/playwright로 알려 준다.
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = path.resolve(process.env.GALLERY_DIR ?? path.join(import.meta.dirname, '../dist-gallery'));
const OUT = path.resolve(process.argv[2] ?? 'scroll-shift-out');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 393;
const H = 852;
const browser = await chromium.launch();

async function scene(scheme) {
  const dir = path.join(OUT, scheme);
  fs.mkdirSync(dir, { recursive: true });
  const vid = path.join(dir, 'video');
  // 지난 녹화가 남아 있으면 그것을 잴 수 있다: 폴더를 비우고 시작한다
  fs.rmSync(vid, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: scheme, recordVideo: { dir: vid, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.goto(`${base}?s=home-chat-long&n=40&w=${W}&h=${H}`);
  await page.waitForSelector('[data-testid=chat]');
  await sleep(800);
  const chat = page.locator('[data-testid=chat]');
  // 뒤집힌 목록(scaleY(-1))이면 scrollTop 0이 맨 아래(가장 새 말)다. 아니면 scrollHeight 쪽이 맨 아래.
  const inv = await chat.evaluate((el) => /matrix\(1, 0, 0, -1|scaleY\(-1\)/.test(getComputedStyle(el).transform) || /-1/.test(getComputedStyle(el).transform));
  const readAt = (px) => chat.evaluate((el, [px, inv]) => { el.scrollTop = inv ? px : el.scrollHeight - el.clientHeight - px; }, [px, inv]);
  const fromEnd = () => chat.evaluate((el, inv) => Math.round(inv ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop), inv);
  // 맨 아래에서 400pt 위를 읽는 중
  await readAt(400);
  await sleep(2000);
  const top0 = await chat.evaluate((el) => el.scrollTop);
  // 녹화와 맞출 표시: 새 답을 붙이는 같은 순간 왼쪽 위 구석(잰 곳 밖)에 빨간 점 하나
  await page.evaluate(() => {
    const m = document.createElement('i');
    m.style.cssText = 'position:fixed;left:0;top:0;width:6px;height:6px;background:#f00;z-index:2147483647';
    document.body.append(m);
    globalThis.__galleryReply('참고로 가나식자재는 지난달에도 입금이 열흘 늦었어요. 이번에도 늦으면 알려 드릴게요.');
  });
  // 녹화 시계는 쪽 시계와 0.5초쯤 어긋날 수 있다: 재는 구간(사건 ±1초) 밖에서만 다음 동작(단추 누르기)을 한다
  await sleep(2500);
  const top1 = await chat.evaluate((el) => el.scrollTop);
  await page.screenshot({ path: path.join(dir, 'phone-new-reply.png') });
  const box = await chat.boundingBox();
  const btn = page.locator('[data-testid=chat-new-reply]');
  const hasBtn = (await btn.count()) > 0;
  if (hasBtn) {
    await btn.click();
    await sleep(700);
    await page.screenshot({ path: path.join(dir, 'phone-after-button.png') });
  }
  await readAt(400);
  await sleep(300);
  await page.evaluate(() => globalThis.__galleryMine('고마워, 늦으면 알려 줘'));
  await sleep(700);
  const gap = await fromEnd();
  await page.screenshot({ path: path.join(dir, 'phone-sent.png') });
  await ctx.close();
  const webm = fs.readdirSync(vid).find((f) => f.endsWith('.webm'));
  const crop = [box.x, box.y, box.width, box.height].map(Math.round).join(',');
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'scroll-shift.mjs'), '--video', path.join(vid, webm), '--crop', crop, '--scale', '1', '--marker', '1,1', '--span', '1.2', '--label', `phone-${scheme}`, '--out', path.join(dir, 'rec-new-reply')], { encoding: 'utf8' });
  console.log(scheme, r.stdout.trim() || r.stderr.trim(), `inverted ${inv}`, `dom scrollTop delta ${Math.round(top1 - top0)}`, `button ${hasBtn}`, `after send gap to end ${gap}`);
}
for (const s of ['light', 'dark']) await scene(s);
await browser.close();
server.close();
