#!/usr/bin/env node
// 폰 대화 기록이 길 때(기본 200줄) 스크롤이 버벅이는지 숫자로 잰다(갤러리, 웹 Chromium, CPU 4배 느리게 = 중급 폰 근사).
// 재는 것: 처음 그리기(ms), 새 말 하나 붙일 때 다시 그리는 시간(ms), 마우스 휠로 3,000pt 올리는 동안의 프레임 간격(평균, p95, 최대)과 33ms 넘은 프레임 수(한 프레임 이상 놓침).
// 쓰기: pnpm gallery && PLAYWRIGHT=…/playwright node scripts/chat-scroll-perf.mjs [줄 수]   GALLERY_DIR=… 로 다른 빌드
// 웹 숫자는 실기기와 다르다: 같은 조건에서 고치기 전·뒤를 비교하는 데 쓴다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = path.resolve(process.env.GALLERY_DIR ?? path.join(import.meta.dirname, '../dist-gallery'));
const N = Number(process.argv[2] ?? 200);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const runs = [];
for (let k = 0; k < 3; k++) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/?s=home-chat-long&n=${N}`);
  await page.waitForFunction((n) => document.body.innerText.includes(`(${n})`), N, { timeout: 60000 });
  const mount = Date.now() - t0;
  await page.waitForTimeout(800);
  const nodes = await page.evaluate(() => document.querySelectorAll('[data-testid=chat] *').length);
  await page.mouse.move(196, 400);
  await page.evaluate(() => {
    const gaps = (globalThis.__gaps = []);
    let last = performance.now();
    globalThis.__on = true;
    const loop = (t) => {
      gaps.push(t - last);
      last = t;
      if (globalThis.__on) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  // 위로 3,000pt: 50pt씩 60번, 16ms 간격(손가락으로 쭉 올리는 속도)
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -50);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const gaps = await page.evaluate(() => ((globalThis.__on = false), globalThis.__gaps.slice(1)));
  // 새 말 하나 붙일 때 다시 그리는 시간(200줄을 다 다시 그리면 길어진다)
  const replyMs = await page.evaluate(async () => {
    const t = performance.now();
    globalThis.__galleryReply('새 답 시험 문장');
    while (!document.body.innerText.includes('새 답 시험 문장')) await new Promise((r) => setTimeout(r, 1));
    return +(performance.now() - t).toFixed(1);
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (x) => +sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))].toFixed(1);
  const res = { mountMs: mount, nodes, frames: gaps.length, avgMs: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p95Ms: q(0.95), maxMs: q(1), over33: gaps.filter((x) => x > 33.4).length, replyMs };
  runs.push(res);
  await page.close();
}
console.log(JSON.stringify({ rows: N, runs }, null, 1));
await browser.close();
server.close();
