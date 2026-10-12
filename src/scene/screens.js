// screens.js — ホログラムの画面と壁のタスクボードに描く中身（Canvas 2D）
//
//   コード：Clawd がキーを打つたびに 1〜2 文字ずつ進む。ファイルを書き終えると保存して次のファイルへ
//   ターミナル：曲のセクションが変わるとテストやビルドを走らせ、曲が終わるとコミットする
//   上の画面：再生中の曲・スペクトル・集中タイマー
//   タスクボード：集中の回数に合わせて、カードが「やること → 作業中 → 完了」へ動く
// どれも 10fps 前後で描けば十分。

import { JP_FONT } from './textures.js';

const MONO = 'Menlo, "SF Mono", Consolas, "Hiragino Kaku Gothic ProN", monospace';

// ---------------------------------------------------------------- コード（架空のファイル）
const FILES = [
  { name: 'groove.js', code: `// groove.js — 拍をそろえて、ひとつずつ
import { clock } from './clock.js';
import { pinch } from './claws.js';

export async function focus(task) {
  const steps = split(task, { size: 'small' });
  for (const step of steps) {
    await clock.nextBeat();
    await pinch(step);        // one thing at a time
    log(\`✓ \${step.name}\`);
  }
  return commit('feat: ' + task.title);
}

function split(task, { size }) {
  return task.todo
    .filter((t) => !t.done)
    .map((t) => ({ ...t, size }));
}` },
  { name: 'claws.ts', code: `// claws.ts — 左右のはさみで、キーをつまむ
type Side = 'left' | 'right';

export interface Claw {
  side: Side;
  grip: number;      // 0..1
  busy: boolean;
}

export function pinch(claw: Claw, key: string) {
  if (claw.busy) return false;
  claw.busy = true;
  claw.grip = Math.min(1, claw.grip + 0.25);
  press(key);
  claw.busy = false;
  return true;
}

export const both = (k: string) =>
  [left, right].every((c) => pinch(c, k));` },
  { name: 'tempo.py', code: `# tempo.py — 作業用の曲のテンポを決める
from dataclasses import dataclass

@dataclass
class Track:
    title: str
    bpm: int
    key: str = "C major"

def steady(tracks, lo=110, hi=123):
    """となりの曲との差は 4 BPM まで"""
    out, prev = [], None
    for t in tracks:
        bpm = max(lo, min(hi, t.bpm))
        if prev and abs(bpm - prev) > 4:
            bpm = prev + (4 if bpm > prev else -4)
        out.append(Track(t.title, bpm, t.key))
        prev = bpm
    return out` },
  { name: 'desk.rs', code: `// desk.rs — 机の高さと、コーヒーの残り
pub struct Desk {
    pub height_mm: u16,
    pub coffee_ml: f32,
}

impl Desk {
    pub fn sip(&mut self, ml: f32) -> f32 {
        self.coffee_ml = (self.coffee_ml - ml).max(0.0);
        self.coffee_ml
    }

    pub fn raise(&mut self, mm: u16) {
        self.height_mm = (self.height_mm + mm).min(1200);
    }
}

#[test]
fn coffee_never_negative() {
    let mut d = Desk { height_mm: 625, coffee_ml: 30.0 };
    assert_eq!(d.sip(50.0), 0.0);
}` },
  { name: 'focus.css', code: `/* focus.css — 夜でも目にやさしく */
:root {
  --ink: #e9f4ff;
  --glow: #48e4ff;
  --clawd: #c67d5f;
}

.desk {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 24px;
}

.screen {
  backdrop-filter: blur(12px);
  border: 1px solid color-mix(in oklab, var(--glow) 40%, transparent);
  animation: breathe 4s ease-in-out infinite;
}

@keyframes breathe {
  50% { opacity: 0.92; }
}` },
  { name: 'timer.js', code: `// timer.js — 25 分の集中と 5 分の休憩
export class Pomodoro {
  constructor({ focus = 25, rest = 5 } = {}) {
    this.focus = focus * 60;
    this.rest = rest * 60;
    this.phase = 'focus';
    this.left = this.focus;
  }

  tick(sec) {
    this.left -= sec;
    if (this.left > 0) return null;
    this.phase = this.phase === 'focus' ? 'rest' : 'focus';
    this.left = this.phase === 'focus' ? this.focus : this.rest;
    return this.phase; // ← ここで Clawd が伸びをする
  }
}` },
];

const KW = new Set(['import', 'from', 'export', 'async', 'await', 'function', 'const', 'let', 'for', 'of', 'return', 'if', 'else', 'new', 'class', 'constructor',
  'this', 'type', 'interface', 'def', 'in', 'pub', 'struct', 'impl', 'fn', 'mut', 'self', 'true', 'false', 'null', 'and', 'or', 'not', 'None', 'max', 'min', 'let']);

/** 1 行を色分けした断片に分ける（とても簡易な字句解析）。 */
function tokenize(line) {
  const out = [];
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) return [{ t: line, c: '#6f7f99' }];
  const re = /(\/\/.*$|#.*$|'[^']*'|"[^"]*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|\s+|.)/g;
  let m;
  while ((m = re.exec(line))) {
    const s = m[0];
    let c = '#e6edf7';
    if (s.startsWith('//') || (s.startsWith('#') && !s.startsWith('#['))) c = '#6f7f99';
    else if (/^['"`]/.test(s)) c = '#b7e07a';
    else if (/^\d/.test(s)) c = '#ffb86b';
    else if (KW.has(s)) c = '#ff7ab8';
    else if (/^[A-Z]/.test(s)) c = '#7fd8ff';
    else if (/^[{}()[\];,.:=<>+\-*/!&|?]$/.test(s)) c = '#9ab4d4';
    out.push({ t: s, c });
  }
  return out;
}

export class Screens {
  constructor(A) {
    this.A = A;
    this.file = 0;
    this.pos = Math.floor(FILES[0].code.length * 0.55); // 今のファイルの何文字目まで打ったか（途中から始める）
    this.saved = 0;         // 保存した印を出す時間
    this.term = [];         // ターミナルの行
    this.jobs = [];         // これから出す行 [{ at, text, color }]
    this.t = 0;
    this.commits = 0;
    this.done = [];         // タスクボードの「完了」
    this.cursorBlink = 0;
    this.buildN = 0;
    this.pushLine('$ clawd --focus', '#9ab4d4');
    this.pushLine('  flow mode: on  ·  headphones: connected', '#7fd8ff');
  }

  // ---------------------------------------------------------------- 入力
  /** Clawd がキーを 1 回打った */
  type(big = false) {
    const f = FILES[this.file];
    const n = big ? 1 : 1 + (Math.random() < 0.4 ? 1 : 0);
    this.pos += n;
    if (big) { // Enter：行末まで進める
      const nl = f.code.indexOf('\n', this.pos - 1);
      if (nl >= 0 && nl - this.pos < 40) this.pos = nl + 1;
    }
    if (this.pos >= f.code.length) {
      this.saved = 2.2;
      this.pushLine(`  saved ${f.name}`, '#6f7f99');
      this.file = (this.file + 1) % FILES.length;
      this.pos = 0;
    }
  }

  pushLine(text, color = '#e6edf7') {
    this.term.push({ text, color });
    if (this.term.length > 40) this.term.shift();
  }

  queue(lines, gap = 0.35) {
    let at = Math.max(this.t, this.jobs.length ? this.jobs[this.jobs.length - 1].at : this.t);
    for (const l of lines) { at += l.wait ?? gap; this.jobs.push({ at, ...l }); }
  }

  /** 曲のセクションが変わった：テストやビルドを走らせる */
  onSection(type, song) {
    const r = Math.random();
    if (type === 'lift' || (type === 'main' && r < 0.5)) {
      const n = 18 + Math.floor(Math.random() * 30);
      this.queue([
        { text: '$ npm test', color: '#9ab4d4' },
        { text: `  ✓ groove keeps time (${8 + Math.floor(Math.random() * 20)}ms)`, color: '#8fe3a0' },
        { text: `  ✓ bass follows the root (${5 + Math.floor(Math.random() * 15)}ms)`, color: '#8fe3a0' },
        { text: `  ✓ claws never collide (${3 + Math.floor(Math.random() * 9)}ms)`, color: '#8fe3a0' },
        { text: `  Tests: ${n} passed, ${n} total`, color: '#b7e07a', wait: 0.6 },
      ]);
    } else if (type === 'groove' || type === 'intro') {
      this.buildN++;
      this.queue([
        { text: '$ npm run build', color: '#9ab4d4' },
        { text: '  building ▓▓▓░░░░░░░ 30%', color: '#7fd8ff', bar: 0.3 },
        { text: '  building ▓▓▓▓▓▓▓░░░ 70%', color: '#7fd8ff', bar: 0.7, replace: true, wait: 0.9 },
        { text: '  building ▓▓▓▓▓▓▓▓▓▓ 100%', color: '#7fd8ff', bar: 1, replace: true, wait: 0.9 },
        { text: `  ✓ built in ${(1.2 + Math.random() * 1.6).toFixed(2)}s`, color: '#8fe3a0' },
      ]);
    } else if (type === 'break') {
      this.queue([{ text: '$ git diff --stat', color: '#9ab4d4' }, { text: `   ${2 + Math.floor(Math.random() * 4)} files changed, ${20 + Math.floor(Math.random() * 90)} insertions(+)`, color: '#e6edf7' }]);
    }
  }

  /** 曲が終わった：コミットする */
  onSongEnd(song) {
    this.commits++;
    const hash = Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
    const msg = song ? `feat: ${song.title.toLowerCase()}` : 'chore: tidy up';
    this.queue([
      { text: `$ git commit -am "${msg}"`, color: '#9ab4d4' },
      { text: `  [main ${hash}] ${msg}`, color: '#ffb86b' },
    ]);
    if (song) this.addDone(song.title, 'song');
  }

  /** 集中の 1 回が終わった */
  onFocusDone(count) {
    this.queue([
      { text: '$ git push', color: '#9ab4d4' },
      { text: '  ✓ pushed to origin/main', color: '#8fe3a0' },
      { text: `  🍅 focus #${count} done — time for a break`, color: '#ff7ab8' },
    ]);
  }

  addDone(title, kind) {
    this.done.push({ title, kind, at: new Date() });
    if (this.done.length > 30) this.done.shift();
  }

  // ---------------------------------------------------------------- 描画
  update(dt) {
    this.t += dt;
    this.saved = Math.max(0, this.saved - dt);
    this.cursorBlink += dt;
    while (this.jobs.length && this.jobs[0].at <= this.t) {
      const j = this.jobs.shift();
      if (j.replace && this.term.length) this.term[this.term.length - 1] = { text: j.text, color: j.color };
      else this.pushLine(j.text, j.color);
    }
  }

  draw({ music, spectrum, focus, env }) {
    this.drawCode();
    this.drawTerm();
    this.drawTop(music, spectrum, focus);
  }

  panel(g, w, h, title, accent = 'rgba(90,240,255,') {
    g.clearRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(10,22,40,0.78)'); grd.addColorStop(1, 'rgba(6,14,28,0.7)');
    g.fillStyle = grd;
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.fill();
    g.strokeStyle = accent + '0.55)'; g.lineWidth = 3;
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.stroke();
    if (title) {
      g.fillStyle = accent + '0.12)'; g.fillRect(6, 6, w - 12, 44);
      g.fillStyle = accent + '0.95)'; g.font = `700 22px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(title, 24, 29);
    }
  }

  drawCode() {
    const S = this.A.screens.code;
    const g = S.canvas.getContext('2d');
    const w = S.canvas.width, h = S.canvas.height;
    const f = FILES[this.file];
    this.panel(g, w, h, null);
    // タブ
    let tx = 18;
    g.font = `500 20px ${MONO}`; g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const fi = (this.file + i) % FILES.length;
      const name = FILES[fi].name;
      const tw = g.measureText(name).width + 34;
      g.fillStyle = i === 0 ? 'rgba(90,240,255,0.18)' : 'rgba(255,255,255,0.04)';
      g.beginPath(); g.roundRect(tx, 14, tw, 36, 8); g.fill();
      g.fillStyle = i === 0 ? '#dff8ff' : '#7a8aa6';
      g.fillText(name, tx + 17, 33);
      tx += tw + 8;
    }
    if (this.saved > 0) { g.fillStyle = `rgba(143,227,160,${Math.min(1, this.saved)})`; g.textAlign = 'right'; g.fillText('✓ saved', w - 26, 33); g.textAlign = 'left'; }
    // 本文
    const text = f.code.slice(0, this.pos);
    const lines = text.split('\n');
    const lh = 30, top = 70, maxLines = Math.floor((h - top - 16) / lh);
    const first = Math.max(0, lines.length - maxLines);
    g.font = `500 21px ${MONO}`;
    for (let i = first; i < lines.length; i++) {
      const y = top + (i - first) * lh + lh / 2;
      g.fillStyle = '#4b5a75'; g.textAlign = 'right';
      g.fillText(String(i + 1), 58, y);
      g.textAlign = 'left';
      let x = 76;
      for (const tk of tokenize(lines[i])) {
        g.fillStyle = tk.c;
        g.fillText(tk.t, x, y);
        x += g.measureText(tk.t).width;
      }
      if (i === lines.length - 1 && Math.floor(this.cursorBlink * 2.4) % 2 === 0) {
        g.fillStyle = '#ff7ab8'; g.fillRect(x + 2, y - 12, 11, 24);
      }
    }
    // 走査線
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = (this.t * 30) % 4; y < h; y += 4) g.fillRect(0, y, w, 1);
    S.tex.needsUpdate = true;
  }

  drawTerm() {
    const S = this.A.screens.term;
    const g = S.canvas.getContext('2d');
    const w = S.canvas.width, h = S.canvas.height;
    this.panel(g, w, h, '▸ terminal', 'rgba(255,140,200,');
    const lh = 29, top = 64, maxLines = Math.floor((h - top - 14) / lh);
    const lines = this.term.slice(-maxLines);
    g.font = `500 19px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    lines.forEach((l, i) => { g.fillStyle = l.color; g.fillText(l.text, 22, top + i * lh + lh / 2); });
    if (Math.floor(this.cursorBlink * 2) % 2 === 0) { g.fillStyle = '#ff7ab8'; g.fillRect(22, top + lines.length * lh + 4, 11, 22); }
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = (this.t * 30) % 4; y < h; y += 4) g.fillRect(0, y, w, 1);
    S.tex.needsUpdate = true;
  }

  drawTop(music, spectrum, focus) {
    const S = this.A.screens.top;
    const g = S.canvas.getContext('2d');
    const w = S.canvas.width, h = S.canvas.height;
    this.panel(g, w, h, null);
    const song = music.song;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(90,240,255,0.95)'; g.font = `700 30px ${JP_FONT}`;
    g.fillText(song ? `♪ ${song.title}` : '♪ FLOW FM 62.0', 30, 58);
    g.font = `500 21px ${JP_FONT}`; g.fillStyle = 'rgba(200,236,255,0.75)';
    if (song) g.fillText(`${song.titleJa}  ·  ${song.styleLabel}  ·  ${song.bpm} BPM`, 30, 92);
    if (music.section) {
      g.font = `700 21px ${JP_FONT}`; g.fillStyle = 'rgba(255,140,200,0.95)';
      g.fillText(music.section.label, 30, 126);
      g.fillStyle = 'rgba(90,240,255,0.95)';
      g.fillText(music.chord || '', 150, 126);
    }
    // 拍のランプ（4 つ）
    const beat = Math.floor(music.beat || 0);
    for (let i = 0; i < 4; i++) {
      const on = music.playing && ((beat % 4) + 4) % 4 === i;
      g.fillStyle = on ? (i === 0 ? '#ff7ab8' : '#5af0ff') : 'rgba(120,160,200,0.25)';
      g.beginPath(); g.arc(300 + i * 30, 119, 9, 0, Math.PI * 2); g.fill();
    }
    // スペクトル（左下）
    const n = 34, x0 = 30, sw = 420, base = h - 26, hmax = 110;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (spectrum) {
        const a = Math.floor(Math.pow(i / n, 2.1) * 300) + 2, b = Math.floor(Math.pow((i + 1) / n, 2.1) * 300) + 3;
        for (let k = a; k < b; k++) v = Math.max(v, spectrum[k] || 0);
        v /= 255;
      } else if (music.playing) v = 0.25 + 0.2 * Math.sin(this.t * 6 + i * 0.7) * Math.sin(this.t * 2.3 + i);
      const bh = Math.max(3, v * v * hmax);
      const x = x0 + (i * sw) / n;
      const grd = g.createLinearGradient(0, base - bh, 0, base);
      grd.addColorStop(0, 'rgba(255,120,200,0.95)'); grd.addColorStop(1, 'rgba(90,240,255,0.8)');
      g.fillStyle = grd;
      g.fillRect(x, base - bh, sw / n - 4, bh);
    }
    // 集中タイマー（右）
    const cx = w - 170, cy = h / 2 + 4, r = 104;
    g.lineWidth = 14; g.lineCap = 'round';
    g.strokeStyle = 'rgba(120,160,200,0.2)';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    if (focus.active) {
      const resting = focus.phase !== 'focus';
      g.strokeStyle = resting ? '#8fe3a0' : '#ff7ab8';
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - focus.progress)); g.stroke();
      g.textAlign = 'center';
      g.fillStyle = '#eaf6ff'; g.font = `700 52px ${MONO}`;
      g.fillText(focus.clock, cx, cy + 14);
      g.font = `700 21px ${JP_FONT}`; g.fillStyle = resting ? '#8fe3a0' : '#ff9fcc';
      g.fillText(resting ? '休憩' : `集中 ${focus.round}`, cx, cy - 34);
      if (!focus.running) { g.fillStyle = 'rgba(234,246,255,0.7)'; g.font = `500 18px ${JP_FONT}`; g.fillText('一時停止', cx, cy + 50); }
    } else {
      const d = new Date();
      g.textAlign = 'center'; g.fillStyle = '#eaf6ff'; g.font = `700 52px ${MONO}`;
      g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, cx, cy + 14);
      g.font = `500 19px ${JP_FONT}`; g.fillStyle = 'rgba(200,236,255,0.7)';
      g.fillText('いまの時刻', cx, cy - 34);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let y = (this.t * 30) % 4; y < h; y += 4) g.fillRect(0, y, w, 1);
    S.tex.needsUpdate = true;
  }

  /** 壁のタスクボード（変わったときだけ描けばよいが、軽いので 2fps で描く） */
  drawBoard(focus) {
    const B = this.A.board;
    const g = B.canvas.getContext('2d');
    const w = B.canvas.width, h = B.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,18,34,0.55)';
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 22); g.fill();
    g.strokeStyle = 'rgba(120,190,255,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 22); g.stroke();
    g.fillStyle = 'rgba(200,236,255,0.95)'; g.font = `700 34px ${JP_FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('TODAY', 34, 46);
    g.font = `500 22px ${JP_FONT}`; g.fillStyle = 'rgba(200,236,255,0.7)';
    const mins = Math.round(focus.focusedSec / 60);
    g.fillText(`集中 ${focus.done} 回 · ${mins} 分 · コミット ${this.commits}`, 170, 48);
    const cols = [['やること', '#7fd8ff'], ['作業中', '#ff9fcc'], ['完了', '#8fe3a0']];
    const cw = (w - 80) / 3;
    const tasks = ['テンポを決める', 'ベースを書く', 'テストを足す', 'README を直す', 'ビルドを軽く', '画面を磨く', 'コーヒーを淹れる', 'バグを 1 つ', 'リファクタ'];
    const doneN = this.done.length;
    cols.forEach(([label, col], i) => {
      const x = 30 + i * (cw + 10);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 84, cw, h - 110);
      g.fillStyle = col; g.font = `700 24px ${JP_FONT}`; g.fillText(label, x + 16, 110);
      let items;
      if (i === 0) items = tasks.slice((doneN + 1) % tasks.length).concat(tasks).slice(0, 4).map((t) => ({ t }));
      else if (i === 1) items = [{ t: tasks[doneN % tasks.length], live: true }];
      else items = this.done.slice(-5).reverse().map((d) => ({ t: d.kind === 'song' ? `♪ ${d.title}` : d.title }));
      items.forEach((it, k) => {
        const y = 136 + k * 84;
        if (y + 70 > h - 30) return;
        g.fillStyle = it.live ? 'rgba(255,140,200,0.22)' : 'rgba(255,255,255,0.09)';
        g.beginPath(); g.roundRect(x + 12, y, cw - 24, 70, 10); g.fill();
        g.fillStyle = col; g.fillRect(x + 12, y, 6, 70);
        g.fillStyle = 'rgba(234,246,255,0.92)'; g.font = `500 22px ${JP_FONT}`;
        const t = it.t.length > 13 ? it.t.slice(0, 12) + '…' : it.t;
        g.fillText(t, x + 30, y + 35);
        if (it.live) { g.fillStyle = '#ff9fcc'; g.fillRect(x + 30, y + 54, (cw - 70) * (focus.active && focus.phase === 'focus' ? 1 - focus.progress : 0.5), 5); }
      });
    });
    B.tex.needsUpdate = true;
  }
}
