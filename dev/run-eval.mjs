#!/usr/bin/env node
// run-eval.mjs — 開発サーバーのページをヘッドレス Chrome で開き、式を評価して結果を JSON で表示する（確認用）
//   node dev/run-eval.mjs /dev/audio-test.html "await sectionFeatures({ track: 0 })"
import puppeteer from 'puppeteer-core';

const [path = '/dev/audio-test.html', ...exprs] = process.argv.slice(2);
const base = process.env.BASE || 'http://127.0.0.1:5184';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +(process.env.W || 1600), height: +(process.env.H || 900), deviceScaleFactor: +(process.env.DPR || 1) });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || window.__dev?.ready === true', { timeout: 60000 });
  for (const ex of exprs) {
    const r = await page.evaluate(`(async () => (${ex}))()`);
    console.log(JSON.stringify(r, null, 1));
  }
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); // 最後にページ全体を撮る（UI ごと）
} finally {
  await browser.close();
}
