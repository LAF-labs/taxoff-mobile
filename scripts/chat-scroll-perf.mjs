#!/usr/bin/env node
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
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -50);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const gaps = await page.evaluate(() => ((globalThis.__on = false), globalThis.__gaps.slice(1)));
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
