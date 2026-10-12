// theory.js — 和音・音階・ボイシングの道具

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const pcOf = (m) => ((m % 12) + 12) % 12;

const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SHARP_KEYS = new Set([2, 4, 7, 9, 11]);

export function noteName(pc, keyPc = 0) {
  return (SHARP_KEYS.has(pcOf(keyPc)) ? SHARP : FLAT)[pcOf(pc)];
}

// 和音の種類：根音からの半音数
export const QUALITIES = {
  '':      { iv: [0, 4, 7], sym: '' },
  m:       { iv: [0, 3, 7], sym: 'm' },
  madd9:   { iv: [0, 3, 7, 14], sym: 'm(add9)' },
  sus4:    { iv: [0, 5, 7], sym: 'sus4' },
  maj7:    { iv: [0, 4, 7, 11], sym: 'maj7' },
  maj9:    { iv: [0, 4, 7, 11, 14], sym: 'maj9' },
  '6':     { iv: [0, 4, 7, 9], sym: '6' },
  '69':    { iv: [0, 4, 7, 9, 14], sym: '6/9' },
  add9:    { iv: [0, 4, 7, 14], sym: 'add9' },
  m7:      { iv: [0, 3, 7, 10], sym: 'm7' },
  m9:      { iv: [0, 3, 7, 10, 14], sym: 'm9' },
  m11:     { iv: [0, 3, 7, 10, 14, 17], sym: 'm11' },
  m6:      { iv: [0, 3, 7, 9], sym: 'm6' },
  '7':     { iv: [0, 4, 7, 10], sym: '7' },
  '9':     { iv: [0, 4, 7, 10, 14], sym: '9' },
  '13':    { iv: [0, 4, 7, 10, 14, 21], sym: '13' },
  '7b9':   { iv: [0, 4, 7, 10, 13], sym: '7(♭9)' },
  '7sus4': { iv: [0, 5, 7, 10], sym: '7sus4' },
  '9sus4': { iv: [0, 5, 7, 10, 14], sym: '9sus4' },
  m7b5:    { iv: [0, 3, 6, 10], sym: 'm7(♭5)' },
  dim7:    { iv: [0, 3, 6, 9], sym: 'dim7' },
};

export const isDominant = (q) => ['7', '9', '13', '7b9', '7sus4', '9sus4'].includes(q);

/** chord = { root: pc, q, bass: pc } */
export function chordPcs(ch) {
  return QUALITIES[ch.q].iv.map((i) => pcOf(ch.root + i));
}

/** メロディの強拍に置く音（根音・3度・5度・7度と、テンションの 9度）。 */
export function chordTonePcs(ch, withTensions = true) {
  const iv = QUALITIES[ch.q].iv.filter((i) => withTensions || i < 12);
  return iv.map((i) => pcOf(ch.root + i));
}

export function chordSymbol(ch, keyPc) {
  const s = noteName(ch.root, keyPc) + QUALITIES[ch.q].sym;
  return ch.bass !== undefined && ch.bass !== ch.root ? s + '/' + noteName(ch.bass, keyPc) : s;
}

/**
 * コードスケール：キーの長音階をもとに、和音の音とぶつかる音を和音の音に置き換える。
 * 例）C キーの E7 → G を G♯ に（A ハーモニックマイナー相当）。Gm7 → B を B♭ に。
 */
export function chordScale(keyPc, ch) {
  const scale = [0, 2, 4, 5, 7, 9, 11].map((i) => pcOf(keyPc + i));
  const tones = chordPcs(ch);
  for (const t of tones) {
    if (scale.includes(t)) continue;
    const below = pcOf(t - 1), above = pcOf(t + 1);
    let i = scale.indexOf(below);
    if (i >= 0 && !tones.includes(below)) { scale[i] = t; continue; }
    i = scale.indexOf(above);
    if (i >= 0 && !tones.includes(above)) { scale[i] = t; continue; }
    scale.push(t);
  }
  return [...new Set(scale)].sort((a, b) => a - b);
}

/** pcs に含まれる音のうち target に最も近い MIDI 番号。同じ距離なら dir の向きを優先。 */
export function nearestWithPc(target, pcs, dir = 1) {
  for (let d = 0; d < 12; d++) {
    const a = target + d * (dir >= 0 ? 1 : -1), b = target - d * (dir >= 0 ? 1 : -1);
    if (pcs.includes(pcOf(a))) return a;
    if (pcs.includes(pcOf(b))) return b;
  }
  return target;
}

/** 音階 pcs に沿って m から steps 段だけ動かす（m が音階外なら近い音から数える）。 */
export function scaleMove(m, steps, pcs) {
  let cur = nearestWithPc(m, pcs, steps);
  const dir = Math.sign(steps);
  for (let k = 0; k < Math.abs(steps); k++) {
    let n = cur + dir;
    while (!pcs.includes(pcOf(n))) n += dir;
    cur = n;
  }
  return cur;
}

/** 音階上の段数の差（a → b）。 */
export function scaleSteps(a, b, pcs) {
  if (a === b) return 0;
  const dir = Math.sign(b - a);
  let n = 0;
  for (let m = a + dir; dir > 0 ? m <= b : m >= b; m += dir) if (pcs.includes(pcOf(m))) n++;
  return n * dir;
}

/**
 * 和音を鍵盤の音域に積む。前の和音に近い形（声部の動きが小さい形）を選ぶ。
 * rootless：5 音以上の和音は根音を省く（ベースが弾くので）。
 */
export function voiceChord(ch, prev, { lo = 52, hi = 77, size = 4, rootless = true } = {}) {
  let ivs = QUALITIES[ch.q].iv.slice();
  if (rootless && ivs.length >= 5) ivs = ivs.filter((i) => i !== 0);
  if (ivs.length > size) ivs = ivs.filter((i) => i !== 7);
  while (ivs.length > size) ivs.pop();
  if (ivs.length < size) ivs.push(ivs[0] + 12);
  const pcs = ivs.map((i) => pcOf(ch.root + i));
  const center = (lo + hi) / 2;
  let best = null, bestScore = Infinity;
  for (let r = 0; r < pcs.length; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (let base = lo - 2; base < lo + 12; base++) {
      if (pcOf(base) !== order[0]) continue;
      const v = [base];
      for (let k = 1; k < order.length; k++) {
        let n = v[k - 1] + 1;
        while (pcOf(n) !== order[k]) n++;
        v.push(n);
      }
      if (v[v.length - 1] > hi || v[0] < lo - 2) continue;
      let score = 0;
      if (prev && prev.length === v.length) for (let k = 0; k < v.length; k++) score += Math.abs(v[k] - prev[k]);
      else score = Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 2;
      if (v[1] - v[0] <= 2 && v[0] < 57) score += 4; // 低い所の密集は濁る
      if (score < bestScore) { bestScore = score; best = v; }
    }
  }
  return best || pcs.map((p) => nearestWithPc(center, [p]));
}
