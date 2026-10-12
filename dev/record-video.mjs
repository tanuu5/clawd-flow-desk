#!/usr/bin/env node
// record-video.mjs — 作業用 BGM 動画（ポモドーロ付き）を録る（実時間）。
//
//   npm run dev                                   # 開発サーバー（/__append で書き出しを受け取る）
//   caffeinate -dims node dev/record-video.mjs --minutes 60   # shots/video/flowdesk-60min.mp4 と chapters.txt ができる
//
// Chrome の MP4 録画は、ファイルが 4GB（2^32 バイト）に達すると止まる（60 分・10Mbps で 55 分 50 秒の所で止まった）。
// ビットレートは、長さから 4GB に収まる値を自動で選ぶ。念のため画面も消さない（caffeinate -d）。
// 描画や書き出しが止まったら、見張りが気づいて終了コード 2 で止める。
// 途中で切れたときは --from <秒> --track <曲> で続きだけ録り、曲の切れ目の無音でつなぐ。
//
// ヘッドレス Chrome（Mac の実 GPU）で ?video=<分> を開き、MediaRecorder（H.264 / AAC）で
// キャンバスと音をそのまま録る。指定の長さが近づくと、今の曲の終わりで Clawd が眠り、暗転して止まる。
// 録画は実時間なので、60 分の動画には 60 分ほどかかる。音はスピーカーからは鳴らない（--mute-audio）。

import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const minutes = +arg('minutes', 60);
const base = arg('url', 'http://127.0.0.1:5184/');
const name = arg('name', `video/flowdesk-${minutes}min.mp4`);
const seekTo = arg('seek', null); // 確認用：最初の曲の何秒目へ飛ぶか
const from = arg('from', null);   // 途中から録る：動画の何秒目から
const track = arg('track', null); //              何曲目（0 始まり）を頭から
// Chrome の MP4 録画は 4GB（2^32 バイト）を超えると止まる。超えないビットレートにする（音の 256kbps と余裕を見込む）
const vbr = +arg('vbr', Math.min(10e6, Math.floor((3.6e9 * 8) / ((minutes + 3) * 60) - 256e3)));

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  .filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error('Chrome が見つかりません（CHROME_PATH で指定）');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 60000,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[page error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto(`${base}?video=${minutes}${from ? `&from=${from}` : ''}${track ? `&track=${track}` : ''}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__video?.state.ready && window.__dev?.ready', { timeout: 120000, polling: 200 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 2500)); // 最初の環境マップを撮り終えるまで

const started = Date.now();
await page.evaluate((name, vbr) => { window.__video.record(name, { vbr }); }, name, vbr);
await page.evaluate(() => window.__video.begin());
if (seekTo) {
  await new Promise((r) => setTimeout(r, 12000));
  await page.evaluate((s) => window.__dev.music.load(0, +s), seekTo);
}
console.log(`録画開始：${name}（${minutes} 分の予定、映像 ${(vbr / 1e6).toFixed(1)} Mbps）`);

const file = path.join('shots', name);
const sizeOf = () => { try { return statSync(file).size; } catch { return 0; } };
let last = '', lastFrames = -1, lastSize = 0, stall = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  let s;
  try {
    s = await page.evaluate(() => window.__video.status());
  } catch (e) {
    console.log('見張り：ページが応答しません（' + e.message.slice(0, 80) + '）');
    process.exit(2);
  }
  const size = sizeOf();
  // 見張り：描画のコマ数と、ファイルの大きさが 20 秒以上増えなければ止まったとみなす
  if (s.frames === lastFrames || (size === lastSize && !s.ending)) stall++; else stall = 0;
  lastFrames = s.frames; lastSize = size;
  if (stall >= 4) { console.log(`見張り：描画か書き出しが止まりました（${(s.t / 60).toFixed(1)} 分、${(size / 1e9).toFixed(2)} GB）`); process.exit(2); }
  const line = `${(s.t / 60).toFixed(1)} 分  ${s.phase}  ${s.track ?? '-'}${s.ending ? '  （終わり）' : ''}  ${(size / 1e9).toFixed(2)} GB`;
  if (line.slice(0, -8) !== last.slice(0, -8)) console.log(line);
  last = line;
  if (s.done) break;
  if ((Date.now() - started) / 1000 > minutes * 60 + 15 * 60) { console.log('時間を超えたので止めます'); break; }
}
await page.evaluate(() => window.__video.finish());
const log = await page.evaluate(() => window.__video.state.log.map(({ song, ...x }) => x));
const fmt = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`; };
// チャプター：集中・休憩の区切り（YouTube の説明欄にそのまま貼れる形）と、曲の一覧
const phases = log.filter((x) => x.kind === 'phase');
const chap = phases.map((x, i) => `${i === 0 ? '0:00' : fmt(x.at)} ${x.phase === 'focus' ? `集中 ${x.round}（25 分）` : '休憩（5 分）'}`);
const songs = log.filter((x) => x.kind === 'song').map((x) => `${fmt(x.at)} ${x.isBreak ? '☕' : String(x.no).padStart(2, '0') + '.'} ${x.title}（${x.titleJa}）`);
const lines = ['# チャプター', ...chap, '', '# 曲', ...songs];
const out = path.join('shots', path.dirname(name));
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, path.basename(name, '.mp4') + '-chapters.txt'), lines.join('\n') + '\n');
writeFileSync(path.join(out, path.basename(name, '.mp4') + '-log.json'), JSON.stringify(log, null, 2));
console.log(lines.join('\n'));
await browser.close();
