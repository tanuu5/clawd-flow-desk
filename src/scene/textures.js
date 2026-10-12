// textures.js — Canvas で描くテクスチャ（画像ファイルは使わない）
import * as THREE from 'three';

export const JP_FONT = '"Zen Kaku Gothic New", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
export const SCRIPT_FONT = '"Yellowtail", "Brush Script MT", cursive';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = aniso;
  return t;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** ヘリンボーン風ではなく、素直な幅広のウォルナット板。 */
export function woodFloor() {
  const [c, g] = canvas(1024, 1024);
  const r = rng(7);
  const rows = 6;
  const h = 1024 / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 400;
    while (x < 1024) {
      const w = 380 + r() * 380;
      const base = 30 + r() * 16;
      g.fillStyle = `hsl(${22 + r() * 6}, ${38 + r() * 10}%, ${base * 0.55}%)`;
      g.fillRect(x, y * h, w, h);
      // 木目
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = `rgba(${20 + r() * 30},${10 + r() * 15},${5},${0.08 + r() * 0.12})`;
        g.lineWidth = 0.6 + r() * 1.6;
        g.beginPath();
        const yy = y * h + r() * h;
        g.moveTo(x, yy);
        for (let s = 0; s <= 8; s++) g.lineTo(x + (w * s) / 8, yy + Math.sin(s * 0.9 + r() * 2) * 3);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x, y * h, 2, h);
      x += w;
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, y * h, 1024, 2);
  }
  return tex(c, { repeat: [2.2, 2.2] });
}

/** 夕陽のストライプを丸く切り抜いたラグ。 */
export function rug() {
  const [c, g] = canvas(1024, 1024);
  g.clearRect(0, 0, 1024, 1024);
  const cx = 512, cy = 512;
  const rings = ['#2b2d5c', '#f3e6cf', '#5fb7b2', '#f3e6cf', '#f2a7b8', '#f3e6cf', '#f6c17a', '#f3e6cf'];
  const R = 500;
  for (let i = 0; i < rings.length; i++) {
    g.fillStyle = rings[i];
    g.beginPath(); g.arc(cx, cy, R - i * 52, 0, Math.PI * 2); g.fill();
  }
  // 中央：沈む太陽とストライプ
  g.save();
  g.beginPath(); g.arc(cx, cy, R - 8 * 52, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#f6a35e'; g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = '#ec7a8c';
  for (let k = 0; k < 6; k++) g.fillRect(0, cy + k * 18, 1024, 7 + k * 1.2);
  g.restore();
  // 毛足のざらつき
  const id = g.getImageData(0, 0, 1024, 1024);
  const r = rng(3);
  for (let i = 0; i < id.data.length; i += 4) {
    if (id.data[i + 3] === 0) continue;
    const n = (r() - 0.5) * 22;
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n;
  }
  g.putImageData(id, 0, 0);
  return tex(c);
}

/** 80 年代のリゾート画のような「プールと椰子と空」のイラスト。 */
export function poolArt(seed = 1, size = 512) {
  const [c, g] = canvas(size, size);
  const r = rng(seed);
  const S = size / 512;
  const palettes = [
    { sky: ['#1e88c9', '#7fd0f0'], sea: '#1366a8', pool: '#35c7d8', wall: '#f7f3ea', accent: '#f25f7a', sun: null },
    { sky: ['#ef6f8e', '#ffc58a'], sea: '#7d4f9e', pool: '#58c5d0', wall: '#fff2e2', accent: '#3a3f8f', sun: '#ffe2a1' },
    { sky: ['#14183f', '#5a4aa0'], sea: '#1d2152', pool: '#3ad0e0', wall: '#e9e6ff', accent: '#ff7eb6', sun: '#fff6d8' },
    { sky: ['#2aa7c9', '#bfeaf2'], sea: '#0f7fa8', pool: '#f2b8c6', wall: '#ffffff', accent: '#ffb23f', sun: null },
  ];
  const P = palettes[seed % palettes.length];
  const grd = g.createLinearGradient(0, 0, 0, size * 0.62);
  grd.addColorStop(0, P.sky[0]); grd.addColorStop(1, P.sky[1]);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  if (P.sun) { g.fillStyle = P.sun; g.beginPath(); g.arc(size * (0.3 + r() * 0.4), size * 0.5, size * 0.12, 0, Math.PI * 2); g.fill(); }
  // 雲
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let k = 0; k < 3; k++) {
    const x = r() * size, y = size * (0.12 + r() * 0.25);
    for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(x + j * 18 * S, y + Math.sin(j) * 6 * S, 26 * S, 12 * S, 0, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = P.sea; g.fillRect(0, size * 0.56, size, size * 0.08);
  // 白い建物の壁とプール
  g.fillStyle = P.wall; g.fillRect(0, size * 0.62, size, size * 0.38);
  g.fillStyle = P.pool;
  g.beginPath(); g.moveTo(size * 0.08, size * 0.74); g.lineTo(size * 0.95, size * 0.7); g.lineTo(size, size); g.lineTo(0, size); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2 * S;
  for (let k = 0; k < 6; k++) { g.beginPath(); const y = size * (0.78 + k * 0.035); g.moveTo(size * 0.1, y); g.bezierCurveTo(size * 0.4, y - 6 * S, size * 0.6, y + 6 * S, size * 0.95, y - 2 * S); g.stroke(); }
  g.fillStyle = P.accent; g.fillRect(size * 0.62, size * 0.6, size * 0.02, size * 0.12); // 飛び込み台の柱
  g.fillRect(size * 0.55, size * 0.59, size * 0.16, size * 0.015);
  // 椰子のシルエット
  const palm = (x, h, lean) => {
    g.strokeStyle = '#1b1f2a'; g.lineWidth = 7 * S; g.lineCap = 'round';
    const topX = x + lean * size, topY = size * 0.62 - h;
    g.beginPath(); g.moveTo(x, size * 0.66); g.quadraticCurveTo(x + lean * size * 0.2, size * 0.62 - h * 0.5, topX, topY); g.stroke();
    g.fillStyle = '#1b1f2a';
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * 0.95 + (k / 6) * Math.PI * 0.9 + (r() - 0.5) * 0.2;
      const L = (60 + r() * 30) * S;
      g.beginPath(); g.moveTo(topX, topY);
      const ex = topX + Math.cos(a) * L, ey = topY + Math.sin(a) * L * 0.6 + L * 0.35;
      g.quadraticCurveTo(topX + Math.cos(a) * L * 0.5, topY + Math.sin(a) * L * 0.6 - 18 * S, ex, ey);
      g.quadraticCurveTo(topX + Math.cos(a) * L * 0.5, topY + Math.sin(a) * L * 0.6 - 4 * S, topX, topY + 4 * S);
      g.fill();
    }
  };
  palm(size * (0.12 + r() * 0.1), size * (0.42 + r() * 0.08), 0.06);
  palm(size * (0.78 + r() * 0.12), size * (0.32 + r() * 0.1), -0.05);
  return tex(c);
}

/** ネオン管の文字。白い芯＋色のにじみ。背景は透明。 */
export function neonText(text, color, { w = 1024, h = 320, font = SCRIPT_FONT, size = 190, italic = false } = {}) {
  const [c, g] = canvas(w, h);
  g.font = `${italic ? 'italic ' : ''}${size}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = w / 2, y = h / 2 + size * 0.05;
  g.lineJoin = 'round';
  g.shadowColor = color;
  for (const [blur, lw, a] of [[60, 18, 0.5], [28, 12, 0.8], [10, 8, 1]]) {
    g.shadowBlur = blur; g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = lw;
    g.strokeText(text, x, y);
  }
  g.shadowBlur = 6; g.globalAlpha = 1; g.strokeStyle = '#fff6fb'; g.lineWidth = 3.2;
  g.strokeText(text, x, y);
  return tex(c);
}

/** ビルの看板（日本語のネオン風）。 */
export function signBoard(text, { fg = '#ff5fa2', bg = 'rgba(10,6,20,0.85)', w = 512, h = 160, vertical = false, size = 96 } = {}) {
  const [c, g] = canvas(vertical ? h : w, vertical ? w : h);
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg; g.lineWidth = 6; g.shadowColor = fg; g.shadowBlur = 18;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#ffffff'; g.font = `700 ${size}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowBlur = 24;
  if (vertical) {
    const chars = [...text];
    const step = (c.height - 40) / chars.length;
    chars.forEach((ch, i) => { g.fillStyle = fg; g.fillText(ch, c.width / 2, 20 + step * (i + 0.5)); g.fillStyle = '#fff'; g.globalAlpha = 0.6; g.fillText(ch, c.width / 2, 20 + step * (i + 0.5)); g.globalAlpha = 1; });
  } else {
    g.fillStyle = fg; g.fillText(text, c.width / 2, c.height / 2 + 4);
    g.globalAlpha = 0.55; g.fillStyle = '#fff'; g.fillText(text, c.width / 2, c.height / 2 + 4); g.globalAlpha = 1;
  }
  return tex(c);
}

/** レコード盤（溝と中央のラベル）。 */
export function vinyl(labelColor = '#f25f7a', title = 'CITY POP') {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(256, 256, 255, 0, Math.PI * 2); g.fill();
  for (let r = 250; r > 92; r -= 2) {
    g.strokeStyle = `rgba(255,255,255,${0.02 + ((r * 37) % 7) * 0.006})`;
    g.lineWidth = 1; g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke();
  }
  // 光の筋（回すと流れて見える）
  const grd = g.createConicGradient(0, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.08, 'rgba(255,255,255,0.10)'); grd.addColorStop(0.16, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.58, 'rgba(255,255,255,0.08)'); grd.addColorStop(0.66, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  g.fillStyle = labelColor; g.beginPath(); g.arc(256, 256, 88, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `600 22px ${JP_FONT}`; g.textAlign = 'center';
  g.fillText(title, 256, 226);
  g.font = `500 14px ${JP_FONT}`; g.fillText('33⅓ RPM', 256, 300);
  g.fillStyle = '#ddd'; g.beginPath(); g.arc(256, 256, 6, 0, Math.PI * 2); g.fill();
  return tex(c);
}

/** 大理石風の天板。 */
export function marble() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#ece8e1'; g.fillRect(0, 0, 512, 512);
  const r = rng(11);
  for (let k = 0; k < 14; k++) {
    g.strokeStyle = `rgba(120,110,120,${0.08 + r() * 0.14})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    let x = r() * 512, y = r() * 512;
    g.moveTo(x, y);
    for (let s = 0; s < 18; s++) { x += (r() - 0.3) * 50; y += (r() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  return tex(c);
}

/** 葉（アルファつき）：kind = 'palm' | 'monstera' */
export function leaf(kind = 'palm') {
  const [c, g] = canvas(256, 512);
  g.clearRect(0, 0, 256, 512);
  if (kind === 'palm') {
    g.strokeStyle = '#3f6b34'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(128, 512); g.quadraticCurveTo(132, 250, 128, 6); g.stroke();
    for (let k = 0; k < 26; k++) {
      const y = 480 - k * 18;
      const L = 110 * Math.sin(((k + 1) / 28) * Math.PI) + 12;
      for (const s of [-1, 1]) {
        g.fillStyle = k % 2 ? '#4c8a3c' : '#43803a';
        g.beginPath(); g.moveTo(128, y);
        g.quadraticCurveTo(128 + s * L * 0.6, y - 26, 128 + s * L, y - 48);
        g.quadraticCurveTo(128 + s * L * 0.5, y - 18, 128, y - 8);
        g.fill();
      }
    }
  } else {
    g.fillStyle = '#2f7a46';
    g.beginPath(); g.ellipse(128, 270, 118, 220, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 6; k++) {
      for (const s of [-1, 1]) {
        const y = 120 + k * 58;
        g.beginPath(); g.moveTo(128 + s * 40, y); g.lineTo(128 + s * 130, y - 30); g.lineTo(128 + s * 130, y - 4); g.lineTo(128 + s * 44, y + 14); g.fill();
        g.beginPath(); g.ellipse(128 + s * 60, y + 30, 8, 13, 0, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#4f9a5e'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(128, 500); g.lineTo(128, 60); g.stroke();
  }
  return tex(c);
}

/** 「Z」の文字（眠っているとき）。 */
export function zTexture() {
  const [c, g] = canvas(128, 128);
  g.font = `700 96px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#c8d0ff'; g.shadowColor = '#8a96c9'; g.shadowBlur = 12;
  g.fillText('Z', 64, 68);
  return tex(c);
}

export function sparkleTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#E8C13C';
  g.fillRect(24, 4, 16, 56); g.fillRect(4, 24, 56, 16);
  g.fillStyle = '#fff3c4'; g.fillRect(28, 28, 8, 8);
  return tex(c);
}

/** 光の玉（街灯・空飛ぶ車のライト）。 */
export function glowTexture() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false });
}

/** レコード棚の背表紙。 */
export function spines(seed = 5) {
  const [c, g] = canvas(1024, 256);
  const r = rng(seed);
  const cols = ['#f25f7a', '#35c7d8', '#f6c17a', '#2b2d5c', '#f3e6cf', '#7d4f9e', '#1e88c9', '#e2b04a', '#151515', '#ef6f8e', '#5fb7b2'];
  let x = 0;
  while (x < 1024) {
    const w = 8 + r() * 10;
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(x, 0, w, 256);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + w - 1, 0, 1, 256);
    if (r() < 0.4) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + w * 0.3, 40 + r() * 60, w * 0.4, 50 + r() * 80); }
    x += w;
  }
  return tex(c);
}

/** 自分のビルの外壁（ほかの階の窓）。12m × 10.2m（3 階ぶん）で 1 枚。 */
export function facadeWindows(seed = 1) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed * 97 + 3);
  g.fillStyle = '#07070c'; g.fillRect(0, 0, 512, 512);
  const fh = 512 / 3;
  for (let f = 0; f < 3; f++) {
    const y = f * fh;
    g.fillStyle = '#0d0d14'; g.fillRect(0, y + fh - 14, 512, 14); // スラブ
    for (let k = 0; k < 8; k++) {
      const x = k * 64;
      const lit = r() < 0.4;
      const warm = r() < 0.7;
      if (lit) {
        const grd = g.createLinearGradient(0, y, 0, y + fh - 14);
        grd.addColorStop(0, warm ? '#ffcf96' : '#cfe0ff'); grd.addColorStop(1, warm ? '#c97a45' : '#7d8fc0');
        g.fillStyle = grd;
      } else g.fillStyle = r() < 0.5 ? '#141a2c' : '#1b1426';
      g.fillRect(x + 3, y + 4, 58, fh - 22);
      if (lit && r() < 0.5) { g.fillStyle = 'rgba(30,20,30,0.55)'; g.fillRect(x + 3 + r() * 30, y + fh * 0.45, 12 + r() * 20, fh * 0.45); }
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 音符（♪ ♫）のスプライト。 */
export function noteTexture(glyph = '♪', color = '#ff7ab8') {
  const [c, g] = canvas(128, 128);
  g.font = `700 100px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 18;
  g.fillStyle = color; g.fillText(glyph, 64, 70);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(glyph, 64, 70);
  return tex(c);
}

/** 磨いたコンクリートの床（大きな目地と、うっすらしたムラ）。 */
export function concrete() {
  const [c, g] = canvas(1024, 1024);
  const r = rng(21);
  g.fillStyle = '#5d5c63'; g.fillRect(0, 0, 1024, 1024);
  for (let k = 0; k < 2600; k++) {
    const x = r() * 1024, y = r() * 1024, s = 6 + r() * 60;
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.012 + r() * 0.02})` : `rgba(0,0,0,${0.015 + r() * 0.03})`;
    g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.18})`; g.fillRect(r() * 1024, r() * 1024, 1.2, 1.2); }
  g.fillStyle = 'rgba(20,20,26,0.55)';
  g.fillRect(0, 0, 1024, 3); g.fillRect(0, 0, 3, 1024); g.fillRect(0, 511, 1024, 2); g.fillRect(511, 0, 2, 1024);
  return tex(c, { repeat: [3, 3] });
}

/** キーボードのキーの並び（白いキーと、文字の代わりの小さな印）。 */
export function keycaps(seed = 3) {
  const [c, g] = canvas(512, 256);
  const r = rng(seed);
  g.fillStyle = '#1b1c22'; g.fillRect(0, 0, 512, 256);
  const rows = 5, cols = 7;
  const kw = 512 / cols, kh = 256 / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const accent = (y === 4 && x === 6) || (y === 0 && x === 0);
    g.fillStyle = accent ? '#e3846a' : r() < 0.15 ? '#c9c7cf' : '#eceaf0';
    const px = x * kw + 5, py = y * kh + 5;
    g.beginPath(); g.roundRect(px, py, kw - 10, kh - 10, 8); g.fill();
    g.fillStyle = 'rgba(40,40,52,0.55)';
    g.fillRect(px + kw * 0.32, py + kh * 0.36, kw * 0.22, kh * 0.18);
  }
  return tex(c);
}
