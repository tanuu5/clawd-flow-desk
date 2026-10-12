// composer.js — シードから作業用の曲（ワークフロー音楽）を 1 曲ぶん組み立てる
//
// 目標は「集中しやすい」とされた曲の特徴（Orpella ほか 2025, PLOS ONE 20(2): e0316047 の work flow 音楽）：
//   ・強いリズム：中くらいの速さ（110〜123 BPM）、拍がはっきり、リズムは単純（キックが拍ごとか 1・3 拍、フィルは少なめ）
//   ・シンプルな調性：1 曲を 1 つのコードループ（ほぼ全部が長音階の音）で通す。メロディは 5 音音階の短いモチーフのくり返し
//   ・高い音を出しすぎない（約 6000Hz 以下）：音色とミキサーの EQ で高域を抑える（engine.js / instruments.js）
//   ・適度なダイナミクス：はっきりしたアタック、音の数は拍あたり 1 つ前後が中心
// 曲は 6〜7 分と長めにし、層を足したり引いたりして（イントロ → グルーヴ → メイン → リフト → ブレイク …）少しずつ変える。
// 曲と曲は途切れずにつながる（アウトロの最後はキックとハットだけになり、次の曲のイントロもキックから始まる）。
// 出力は 16 分音符を単位にしたイベントの列。音を鳴らすのは engine.js。

import { makeRng } from './rng.js';
import { chordTonePcs, chordSymbol, nearestWithPc, scaleMove, voiceChord, pcOf, noteName, QUALITIES } from './theory.js';

// ---------------------------------------------------------------- コードループ（4 小節 = 16 拍）
// [キーの長音階での根音の半音, 種類（M 長三和音系 / m 短三和音系 / D 属和音）, 拍数]
// マイナーの曲は平行調として書く（主和音は vi）。
const LOOPS = {
  major: [
    { name: 'I–V–vi–IV', c: [[0, 'M', 4], [7, 'D', 4], [9, 'm', 4], [5, 'M', 4]] },
    { name: 'I–vi–IV–V', c: [[0, 'M', 4], [9, 'm', 4], [5, 'M', 4], [7, 'D', 4]] },
    { name: 'IV–V–iii–vi', c: [[5, 'M', 4], [7, 'D', 4], [4, 'm', 4], [9, 'm', 4]] },
    { name: 'I–iii–IV–V', c: [[0, 'M', 4], [4, 'm', 4], [5, 'M', 4], [7, 'D', 4]] },
    { name: 'I–IV', c: [[0, 'M', 8], [5, 'M', 8]] },
    { name: 'IV–I', c: [[5, 'M', 8], [0, 'M', 8]] },
    { name: 'I–ii', c: [[0, 'M', 8], [2, 'm', 8]] },
  ],
  minor: [
    { name: 'i–VI–III–VII', c: [[9, 'm', 4], [5, 'M', 4], [0, 'M', 4], [7, 'M', 4]] },
    { name: 'i–VII–VI–VII', c: [[9, 'm', 4], [7, 'M', 4], [5, 'M', 4], [7, 'M', 4]] },
    { name: 'i–iv', c: [[9, 'm', 8], [2, 'm', 8]] },
    { name: 'VI–VII–i', c: [[5, 'M', 4], [7, 'M', 4], [9, 'm', 8]] },
  ],
};

// 和音の色づけ（スタイルごと）。キーの長音階から外れる音を含むものは選ばない（下の diatonic）
const COLORS = {
  triad:   { M: ['', '', 'add9'], D: ['', 'sus4', ''], m: ['m', 'm', 'madd9', 'm7'] },
  seventh: { M: ['maj7', 'maj9', 'maj7'], D: ['9sus4', '7sus4', 'add9'], m: ['m7', 'm9', 'm7'] },
  soul:    { M: ['maj7', 'maj9', '6'], D: ['9', '13', '9sus4'], m: ['m7', 'm9', 'm11'] },
  lounge:  { M: ['maj9', '69', 'maj7'], D: ['9sus4', '13'], m: ['m9', 'm11', 'm7'] },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
function diatonic(deg, q) {
  return QUALITIES[q].iv.every((i) => MAJOR.includes(pcOf(deg + i)));
}
function colorOf(R, deg, kind, palette) {
  const list = COLORS[palette][kind].filter((q) => diatonic(deg, q));
  const fallback = kind === 'm' ? 'm' : '';
  return list.length ? R.pick(list) : fallback;
}

// ---------------------------------------------------------------- スタイル（リズムの型）
// 1 文字 = 16 分音符。'.' は休み、'-' は伸ばす。
//   ハット：x 強め / h 弱め / o オープン　　パーカッション：s シェイカー / t タンバリン
const STYLES = {
  house: {
    label: 'ディープハウス', bpm: [117, 123], swing: 0, palette: 'seventh',
    kick: ['x...x...x...x...'], back: '....c.......c...', backLift: '....c.......c...',
    hat: '..o...o...o...o.', hatLift: 'h.o.h.o.h.o.h.o.', hatSoft: '..h...h...h...h.',
    perc: '..s...s...s...s.', percLift: '.s.s.s.s.s.s.s.s',
    bass: ['..R...R...R...R.', 'R..R..R...R.O.R.', '..R.O.R...R.O.R.'],
    chords: 'stab', chordPats: ['..x...x...x...x.', 'x..x..x...x..x..', '...x..x....x..x.'],
    arp: 8, riff: true, leads: ['soft', 'whistle'], duck: 0.42, kickLen: 1.35, fill: 'clap',
  },
  synthwave: {
    label: 'シンセウェーブ', bpm: [110, 117], swing: 0, palette: 'triad',
    kick: ['x.......x.......', 'x.......x.x.....'], back: '....x.......x...', backLift: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.', hatLift: 'x.x.x.x.x.x.x.xo', hatSoft: 'h...h...h...h...',
    perc: '', percLift: '....t.......t...',
    bass: ['R.R.R.R.R.R.R.R.', 'R.R.O.R.R.R.O.R.'],
    chords: 'pad', chordPats: ['x---------------'],
    arp: 16, riff: false, leads: ['synth', 'lyricon'], duck: 0.3, kickLen: 1.1, fill: 'tom', gatedSnare: true,
  },
  funk: {
    label: 'フューチャーファンク', bpm: [116, 122], swing: 0, palette: 'soul',
    kick: ['x...x...x...x...'], back: '....x.......x...', backLift: '....c.......c...',
    hat: 'h.x.h.x.h.x.h.x.', hatLift: 'h.o.h.o.h.o.h.o.', hatSoft: '..h...h...h...h.',
    perc: '', percLift: '..t...t...t...t.',
    bass: ['R.O.R.O.R.O.R.O.', 'R.OgR.O.R.OgR.OA', 'R.O.R.O.R.O.F.OA'],
    chords: 'ep', chordPats: ['..x-..x-..x-..x-', 'x--x--x-..x-..x-'],
    gtr: '.mX..mX..mX..mX.', brass: ['x..x..x.........', '......x...x..x..'],
    arp: 0, riff: false, leads: ['lyricon', 'synth'], duck: 0.22, kickLen: 1, fill: 'snare', slap: 0.5,
  },
  citypop: {
    label: '作業用シティポップ', bpm: [110, 117], swing: 0, palette: 'soul',
    kick: ['x.....x.x.......', 'x.....x...x.....'], back: '....x.......x...', backLift: '....x.......x...',
    hat: 'x.h.x.h.x.h.x.h.', hatLift: 'x.h.x.h.x.h.x.o.', hatSoft: 'h...h...h...h...',
    perc: '..s...s...s...s.', percLift: '..s...s...s...s.',
    bass: ['R..R..O.R.R.....', 'R.....O.R...R.O.', 'R..R..O.R..R.OA.'],
    chords: 'ep', chordPats: ['x-----x---x-----', 'x-------..x---x-'],
    gtr: '..X...X...X...X.', brass: ['..x.....x..x....'],
    arp: 0, riff: true, leads: ['lyricon', 'soft'], duck: 0, kickLen: 1, fill: 'snare', slap: 0.2,
  },
  // 休憩用（集中タイマーの休憩中だけ流す）：遅め・やわらかめ
  lounge: {
    label: 'ラウンジ（休憩）', bpm: [86, 93], swing: 0.12, palette: 'lounge', breakOnly: true,
    kick: ['x.......x.x.....', 'x......x..x.....'], back: '....r.......r...', backLift: '....x.......x...',
    hat: 'x.h.x.h.x.h.x.h.', hatLift: 'x.h.x.h.x.h.x.o.', hatSoft: 'h.......h.......',
    perc: '', percLift: '..s...s...s...s.',
    bass: ['R-----R-F-----A-', 'R-------F---R-A-'],
    chords: 'ep', chordPats: ['x-------x-----x-', 'x-----x---x-----'],
    arp: 0, riff: false, leads: ['whistle', 'soft'], duck: 0, kickLen: 1, fill: 'none', slap: 0,
  },
};
export const STYLE_KEYS = Object.keys(STYLES).filter((k) => !STYLES[k].breakOnly);
export const styleBpm = (key) => STYLES[key]?.bpm || [112, 120];

// ---------------------------------------------------------------- メロディのモチーフ（2 小節 = 32 ステップ）
// 8 分音符が中心の、覚えやすい単純なリズム
const MOTIFS = [
  'x---x---x-x-x---|x---x---x-------',
  '..x-x-x-x---x---|..x-x-x-x-------',
  'x-x-..x-x-..x---|x-x-..x-x-------',
  'x-----x-x-----x-|x-----x-x-------',
  '....x-x-x-x-x---|....x-x-x-------',
  'x--x--x-x-------|x--x--x-x---x---',
  'x---x-x---x-x---|x---x-x---------',
  '..x---x---x-x---|..x---x---------',
];
const RIFFS = ['x.x.x...x.x.x...', 'x...x.x...x.x...', 'x.x...x.x.x...x.', '..x.x...x.x.x...'];

// ---------------------------------------------------------------- 曲名
const EN_A = ['Deep', 'Neon', 'Morning', 'Silent', 'Quantum', 'Clear', 'Steady', 'Cobalt', 'Chrome', 'Electric',
  'Midnight', 'Focus', 'Parallel', 'Async', 'Orbit', 'Lucid', 'Signal', 'Pixel', 'Velvet', 'Glass'];
const EN_B = ['Commit', 'Compile', 'Loop', 'Pipeline', 'Workflow', 'Sprint', 'Deploy', 'Terminal', 'Circuit', 'Runtime',
  'Merge', 'Cursor', 'Thread', 'Kernel', 'Buffer', 'Script', 'Build', 'Cache', 'Flow', 'Grid'];
const JA_A = ['午前10時', '62階', '雨の日', '月曜日', '金曜日', 'ガラス越し', '深夜', '昼下がり', '夜明け前', '首都高',
  '窓辺', '机の上', '真夜中', '初日', '最終日'];
const JA_B = ['コンパイル', 'コミット', 'ビルド', 'デプロイ', 'ループ', 'スプリント', 'カーソル', 'リファクタ', 'ターミナル',
  'プルリク', 'テストケース', 'マージ', 'キャッシュ', 'ランタイム', 'ログ'];
const BREAK_A = ['Coffee', 'Sunny', 'Lazy', 'Soft', 'Cloud', 'Tea', 'Window', 'Sofa', 'Slow', 'Quiet'];
const BREAK_B = ['Break', 'Pause', 'Breeze', 'Nap', 'Stretch', 'Daydream', 'Interlude', 'Recess'];
const BREAK_JA = ['ひと休み', 'コーヒーブレイク', 'のびのび', 'うたた寝', '窓の外', 'おやつの時間', '深呼吸', '小休止'];

/** 曲名。attempt = 0 がふつう。重なるときは engine.songFor が attempt を増やして選び直す。 */
export function makeTitle(seed, attempt = 0, isBreak = false) {
  const RT = makeRng(mixSeed(seed * 31 + 7 + attempt * 7919));
  if (isBreak) {
    const a = RT.pick(BREAK_A), b = RT.pick(BREAK_B), ja = RT.pick(BREAK_JA);
    return { title: `${a} ${b}`, titleJa: ja, words: [a, b, ja] };
  }
  const a = RT.pick(EN_A), b = RT.pick(EN_B), ja = RT.pick(JA_A), jb = RT.pick(JA_B);
  return { title: `${a} ${b}`, titleJa: `${ja}の${jb}`, words: [a, b, ja, jb] };
}

function mixSeed(x) { // 近いシードから似た並びが出ないよう、ビットをよく混ぜる
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  return ((x >>> 16) ^ x) >>> 0;
}

// 再生リスト（固定のシード → いつ開いても同じ 8 曲）。テンポは少しずつ上げていく（となりの曲との差は 4 BPM 以内）。
// minor：平行調のマイナー（主和音は vi）
export const PLAYLIST = [
  { seed: 2101, style: 'citypop', key: 5, bpm: 112 },
  { seed: 2102, style: 'house', key: 8, bpm: 116 },
  { seed: 2103, style: 'synthwave', key: 0, bpm: 114, minor: true },
  { seed: 2104, style: 'funk', key: 2, bpm: 118 },
  { seed: 2105, style: 'house', key: 3, bpm: 120, minor: true },
  { seed: 2106, style: 'citypop', key: 7, bpm: 117 },
  { seed: 2107, style: 'synthwave', key: 10, bpm: 116 },
  { seed: 2108, style: 'funk', key: 4, bpm: 120 },
];
// 休憩用（集中タイマーの休憩中）
export const BREAK_LIST = [
  { seed: 3101, style: 'lounge', key: 5, bpm: 90 },
  { seed: 3102, style: 'lounge', key: 10, bpm: 88 },
  { seed: 3103, style: 'lounge', key: 3, bpm: 92, minor: true },
  { seed: 3104, style: 'lounge', key: 8, bpm: 86 },
];

export const SECTION_LABEL = { intro: 'イントロ', groove: 'グルーヴ', main: 'メイン', lift: 'リフト', break: 'ブレイク', outro: 'アウトロ' };
const ENERGY = { intro: 0.55, groove: 0.72, main: 0.86, lift: 1, break: 0.5, outro: 0.6 };

// ---------------------------------------------------------------- 本体
export function generateSong(seed, hint = {}) {
  const R = makeRng(seed * 7919 + 13);
  const styleKey = hint.style || R.pick(STYLE_KEYS);
  const st = STYLES[styleKey];
  const bpm = hint.bpm ?? R.int(st.bpm[0], st.bpm[1]);
  const keyPc = hint.key ?? R.pick([0, 2, 3, 5, 7, 8, 10]);
  const minor = hint.minor ?? R.chance(0.25);
  const isBreak = !!st.breakOnly;
  // 主音（メロディの中心）。マイナーは平行調の vi
  const homePc = pcOf(keyPc + (minor ? 9 : 0));
  const loopDef = R.pick(minor ? LOOPS.minor : LOOPS.major);
  const loop = loopDef.c.map(([deg, kind, beats]) => ({ root: pcOf(keyPc + deg), q: colorOf(R, deg, kind, st.palette), beats }));
  for (const c of loop) c.bass = c.root;
  const leadPatch = R.pick(st.leads);
  const kickPat = R.pick(st.kick), kickAlt = R.pick(st.kick);
  const bassPats = R.shuffle(st.bass);
  const chordPats = R.shuffle(st.chordPats);
  const riffPat = R.pick(RIFFS);

  // 構成
  const plan = isBreak ? [['intro', 8], ['main', 16], ['groove', 8], ['main', 16], ['outro', 8]] : makePlan(R);
  const sections = [];
  let bar = 0;
  for (const [type, bars] of plan) {
    sections.push({ type, bars, startBar: bar, label: SECTION_LABEL[type], energy: ENERGY[type], keyPc });
    bar += bars;
  }
  // ブレイクは和音をゆっくり（1 和音 2 小節）。ほかはループのまま
  const slow = loop.map((c) => ({ ...c, beats: c.beats * 2 })).slice(0, Math.max(1, Math.ceil(loop.length / 2)));
  for (const sec of sections) sec.barChords = toBars(fillLoop(sec.type === 'break' ? slow : loop, sec.bars), sec.bars);

  // フック（8 小節）。ループは 4 小節なので、どのセクションでも同じ和音の上に乗る
  const loopBars = toBars(fillLoop(loop, 8), 8);
  const hook = genHook(R, loopBars, keyPc, homePc);

  // イベント
  const events = [];
  const kicks = [];
  const state = { chordPrev: null, padPrev: null, gtrPrev: null, brassPrev: null };
  const occurrence = {};
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const next = sections[si + 1];
    const base = sec.startBar * 16;
    const add = (ev) => { ev.s += base; events.push(ev); };
    const nth = occurrence[sec.type] = (occurrence[sec.type] ?? -1) + 1; // 同じ種類のセクションの何回目か
    const bassPat = bassPats[nth % bassPats.length];
    const chordPat = chordPats[(nth + (sec.type === 'lift' ? 1 : 0)) % chordPats.length];

    // メロディ（フックを 8 小節ごとにくり返す）
    const L0 = layersFor(sec.type, 0, sec.bars, st);
    if (L0.lead || sec.type === 'break') {
      for (let b8 = 0; b8 < sec.bars; b8 += 8) {
        for (const n of hook) {
          if (n.s >= (sec.bars - b8) * 16) continue;
          const s = b8 * 16 + n.s;
          if (sec.type === 'break') { // ブレイクでは、フックをベルで静かになぞる（長い音だけ）
            if (n.d >= 3 || n.s % 16 === 0) add({ s, i: 'bell', m: n.m, d: n.d + 2, v: 0.42 });
            continue;
          }
          add({ s, i: 'lead', m: n.m, d: n.d, v: n.v * (sec.type === 'main' ? 0.9 : 1), patch: leadPatch, glide: null });
          if (sec.type === 'lift' && n.d >= 2) add({ s, i: 'bell', m: n.m + 12, d: n.d, v: n.v * 0.4 });
        }
      }
    }

    for (let b = 0; b < sec.bars; b++) {
      const chords = sec.barChords[b];
      const nextFirst = b + 1 < sec.bars ? sec.barChords[b + 1][0].chord : next ? next.barChords[0][0].chord : chords[chords.length - 1].chord;
      const at = (s) => chordAtBar(chords, s);
      const bs = b * 16;
      const L = layersFor(sec.type, b, sec.bars, st);
      const isLastBar = b === sec.bars - 1;
      const fill = isLastBar && next && sec.type !== 'break' && sec.type !== 'outro' && st.fill !== 'none' && (next.type !== 'groove' || R.chance(0.5)) ? st.fill : null;
      const fillFrom = fill ? (fill === 'tom' ? 8 : 12) : 16;

      // ---- ドラム
      if (b === 0 && (sec.type === 'lift' || sec.type === 'main' || (si > 0 && sections[si - 1].type === 'break') || si === 0) && sec.type !== 'break') add({ s: bs, i: 'crash', v: si === 0 ? 0.5 : 0.7 });
      const kp = b % 2 === 1 ? kickAlt : kickPat;
      const hatPat = L.hat === 'lift' ? st.hatLift : L.hat === 'soft' ? st.hatSoft : st.hat;
      const backPat = sec.type === 'lift' ? st.backLift : st.back;
      const percPat = sec.type === 'lift' ? st.percLift : st.perc;
      for (let s = 0; s < 16; s++) {
        if (L.kick && kp[s] === 'x' && !(s >= fillFrom && s % 4 !== 0)) {
          add({ s: bs + s, i: 'kick', v: s % 8 === 0 ? 1 : 0.9, len: st.kickLen });
          kicks.push(base + bs + s);
        }
        if (s >= fillFrom) continue;
        const bc = backPat[s];
        if (L.back && bc !== '.') add({ s: bs + s, i: 'snare', v: 0.85 + R.float(-0.04, 0.04), kind: bc === 'r' ? 'rim' : bc === 'c' ? 'clap' : st.gatedSnare ? 'gated' : 'snare' });
        const hc = hatPat[s];
        if (L.hat && hc !== '.') add({ s: bs + s, i: 'hat', v: (hc === 'x' ? 0.72 : hc === 'o' ? 0.62 : 0.42) * (L.hat === 'soft' ? 0.75 : 1) + R.float(-0.04, 0.04), open: hc === 'o' });
        const pc = percPat ? percPat[s] : '.';
        if (L.perc && pc && pc !== '.') add({ s: bs + s, i: 'perc', v: (s % 4 === 2 ? 0.6 : 0.4), kind: pc === 't' ? 'tamb' : 'shaker' });
      }
      if (fill) addFill(add, bs, fill);
      if (sec.type === 'break' && isLastBar) { // ブレイクの終わり：上がっていくノイズとスネアの連打
        add({ s: bs - 16, i: 'riser', d: 32, v: 0.7 });
        for (let s = 8; s < 16; s++) add({ s: bs + s, i: 'snare', v: 0.3 + (s - 8) * 0.07, kind: styleKey === 'house' ? 'clap' : 'snare' });
      }

      // ---- ベース
      if (L.bass) {
        const pat = L.bass === 'long' ? 'R---------------' : bassPat;
        for (const n of bassBar(R, pat, chords, nextFirst, st.slap || 0, keyPc)) add({ ...n, s: bs + n.s, i: 'bass', v: n.v * (L.bass === 'long' ? 0.7 : 1) });
      }

      // ---- 和音（エレピ / オルガンのスタブ / パッド）
      if (L.chords) {
        const inst = st.chords;
        const hits = inst === 'pad' ? alignHits([{ s: 0, d: 16 }], chords) : alignHits(parseHits(chordPat), chords);
        for (const h of hits) {
          const ch = at(h.s);
          const range = inst === 'stab' ? { lo: 55, hi: 74 } : inst === 'pad' ? { lo: 53, hi: 74 } : { lo: 52, hi: 76 };
          state.chordPrev = voiceChord(ch, state.chordPrev, range);
          const v = (h.s % 4 === 0 ? 0.8 : 0.72) * (sec.type === 'intro' ? 0.8 : sec.type === 'break' ? 0.7 : 1) + R.float(-0.04, 0.04);
          add({ s: bs + h.s, i: inst === 'stab' ? 'stab' : inst === 'pad' ? 'pad' : 'ep', notes: state.chordPrev, d: inst === 'stab' ? Math.min(h.d, 2) : h.d, v: inst === 'pad' ? (sec.type === 'break' ? 1.1 : v * 0.9) : v });
        }
      }

      // ---- パッド（後ろで鳴らす長い和音）
      if (L.pad && st.chords !== 'pad') for (const c of chords) {
        state.padPrev = voiceChord(c.chord, state.padPrev, { lo: 55, hi: 76 });
        add({ s: bs + c.s, i: 'pad', notes: state.padPrev, d: c.len, v: sec.type === 'break' ? 0.95 : sec.type === 'intro' ? 0.55 : 0.6 });
      }

      // ---- アルペジオ（リフトで）
      if (L.arp && st.arp) {
        const step = st.arp === 16 && sec.type !== 'break' ? 1 : 2;
        const av = sec.type === 'break' ? 0.75 : 1;
        const order = [0, 1, 2, 3, 1, 2, 3, 2];
        for (const c of chords) {
          const v4 = voiceChord(c.chord, null, { lo: 62, hi: 82, size: 4 });
          for (let k = 0; k * step < c.len; k++) {
            const s = c.s + k * step;
            add({ s: bs + s, i: 'pluck', m: v4[order[k % order.length]], d: step * 1.5, v: (s % 4 === 0 ? 0.62 : 0.45) * av });
          }
        }
      }

      // ---- リフ（グルーヴの後半で、短い音型を足して少しだけ変化をつける）
      if (L.riff && st.riff) {
        const ch = at(0);
        const tones = voiceChord(ch, null, { lo: 64, hi: 79, size: 3 });
        let k = 0;
        for (let s = 0; s < 16; s++) if (riffPat[s] === 'x') { add({ s: bs + s, i: 'pluck', m: tones[k++ % tones.length], d: 2, v: 0.5 }); }
      }

      // ---- ギター（カッティング）
      if (L.gtr && st.gtr) {
        for (let s = 0; s < 16; s++) {
          const c = st.gtr[s];
          if (c === '.' || s >= fillFrom) continue;
          state.gtrPrev = voiceChord(at(s), state.gtrPrev, { lo: 60, hi: 76, size: 3 });
          add({ s: bs + s, i: 'gtr', notes: state.gtrPrev, d: c === 'm' ? 0.5 : 1, v: c === 'X' ? 0.75 : 0.45, mute: c === 'm', dir: s % 2 ? 'up' : 'down' });
        }
      }

      // ---- ブラス（ファンクのリフトで、2 小節に 1 回）
      if (L.brass && st.brass && b % 2 === 1) {
        for (const h of parseHits(R.pick(st.brass))) {
          state.brassPrev = voiceChord(at(h.s), state.brassPrev, { lo: 60, hi: 79, size: 3 });
          add({ s: bs + h.s, i: 'brass', notes: state.brassPrev, d: 2, v: 0.72 });
        }
      }
    }
  }
  events.sort((a, b) => a.s - b.s);
  kicks.sort((a, b) => a - b);
  fixClashes(events);

  // 表示用：小節ごとのコード名
  const keyName = minor ? `${noteName(homePc, keyPc)} マイナー` : `${noteName(keyPc, keyPc)} メジャー`;
  const bars = [];
  for (const sec of sections) for (let b = 0; b < sec.bars; b++) {
    bars.push({ section: sections.indexOf(sec), chords: sec.barChords[b].map((c) => ({ s: c.s, len: c.len, sym: chordSymbol(c.chord, keyPc) })) });
  }
  const lengthSteps = bar * 16;
  const { title, titleJa, words } = makeTitle(seed, 0, isBreak);

  return {
    seed, style: styleKey, styleLabel: st.label, bpm, keyPc, keyName, minor, swing: st.swing, isBreak,
    title, titleJa, words, leadPatch, loopName: loopDef.name, duck: st.duck,
    sections: sections.map((s) => ({ type: s.type, label: s.label, startBar: s.startBar, bars: s.bars, energy: s.energy })),
    bars, events, kicks, kimes: [], lengthSteps,
  };
}

/** 構成：イントロのあと「グルーヴ → メイン → リフト → ブレイク」を 3 回まわし、アウトロで終わる（約 190 小節）。 */
function makePlan(R) {
  const plan = [['intro', 16]];
  const cycles = 3;
  for (let c = 0; c < cycles; c++) {
    plan.push(['groove', c === 0 ? 16 : 8]);
    plan.push(['main', 16]);
    if (c > 0 || R.chance(0.5)) plan.push(['lift', 16]);
    if (c < cycles - 1) plan.push(['break', R.pick([4, 8, 8])]);
  }
  plan.push(['outro', 16]);
  return plan;
}

/** セクションの種類と小節の位置から、鳴らす層を決める。 */
function layersFor(type, b, bars, st) {
  const q = b / bars;
  const L = { kick: true, back: true, hat: 'main', perc: false, bass: true, chords: true, pad: false, lead: false, arp: false, riff: false, gtr: false, brass: false };
  switch (type) {
    case 'intro':
      if (st.breakOnly) { // 休憩の曲：和音から静かに始め、5 小節目からリズム
        L.kick = L.back = L.bass = b >= 4; L.chords = true; L.pad = true; L.hat = b >= 4 ? 'soft' : false;
        break;
      }
      L.back = q >= 0.25; L.bass = q >= 0.5; L.chords = q >= 0.5; L.pad = q >= 0.75;
      L.hat = q >= 0.25 ? 'main' : 'soft';
      break;
    case 'groove': L.perc = q >= 0.5; L.riff = q >= 0.5; L.gtr = q >= 0.5; break;
    case 'main': L.lead = true; L.pad = true; L.perc = true; L.gtr = true; break;
    case 'lift': L.lead = true; L.pad = true; L.perc = true; L.arp = true; L.hat = 'lift'; L.gtr = true; L.brass = true; break;
    // ブレイク：キックとベースを抜くが、ハットとシェイカーで拍は刻み続ける（拍がわからなくならないように）
    case 'break':
      L.kick = false; L.back = false; L.bass = 'long'; L.chords = true; L.pad = true; L.perc = true; L.hat = 'soft';
      L.arp = !!st.arp; L.riff = !st.arp;
      break;
    case 'outro':
      L.chords = q < 0.5; L.pad = q < 0.25; L.bass = q < 0.75; L.back = q < 0.75; L.hat = q < 0.75 ? 'main' : 'soft';
      L.gtr = q < 0.25;
      break;
  }
  return L;
}

function addFill(add, bs, kind) {
  if (kind === 'clap') for (let s = 12; s < 16; s++) add({ s: bs + s, i: 'snare', v: 0.45 + (s - 12) * 0.12, kind: 'clap' });
  else if (kind === 'snare') for (let s = 12; s < 16; s++) add({ s: bs + s, i: 'snare', v: 0.5 + (s - 12) * 0.12, kind: 'snare' });
  else if (kind === 'tom') ['1', '1', '.', '2', '2', '.', '3', '3'].forEach((c, k) => { if (c !== '.') add({ s: bs + 8 + k, i: 'tom', v: 0.55 + k * 0.05, n: +c - 1 }); });
}

// ---------------------------------------------------------------- コード進行の道具
function fillLoop(loop, bars) {
  const out = [];
  let beats = 0;
  while (beats < bars * 4) {
    for (const c of loop) {
      if (beats >= bars * 4) break;
      const l = Math.min(c.beats, bars * 4 - beats);
      out.push({ ...c, beats: l, src: c });
      beats += l;
    }
  }
  return out;
}

/** 和音の列を小節ごとの [{ s, len, chord }] に分ける（16 分音符単位）。chord は元のループの和音を指す。 */
function toBars(list, bars) {
  const out = Array.from({ length: bars }, () => []);
  let step = 0;
  for (const c of list) {
    let len = c.beats * 4;
    while (len > 0) {
      const b = Math.floor(step / 16), s = step % 16;
      if (b >= bars) break;
      const l = Math.min(len, 16 - s);
      out[b].push({ s, len: l, chord: c.src || c });
      step += l; len -= l;
    }
  }
  return out;
}

function chordAtBar(chords, s) {
  let c = chords[0];
  for (const x of chords) if (x.s <= s) c = x;
  return c.chord;
}

const rootOf = (ch) => ch.bass ?? ch.root;
const bassMidi = (pc) => 28 + pcOf(pc - 4); // E1..D♯2

function parseRhythm(str) {
  const t = str.replace('|', '');
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== 'x') continue;
    let d = 1;
    while (i + d < t.length && t[i + d] === '-') d++;
    out.push({ s: i, d });
  }
  return out;
}
const parseHits = parseRhythm;

/** 小節の途中で和音が変わるなら、そこで音を切って弾き直す。 */
function alignHits(hits, chords) {
  const changes = chords.map((c) => c.s).filter((s) => s > 0);
  if (!changes.length) return hits;
  const out = [];
  for (const h of hits) {
    let { s, d } = h;
    for (const c of changes) if (c > s && c < s + d) d = c - s;
    out.push({ s, d });
  }
  for (const c of changes) {
    if (out.some((h) => h.s === c)) continue;
    const nextOn = out.filter((h) => h.s > c).map((h) => h.s)[0] ?? 16;
    out.push({ s: c, d: Math.min(nextOn, 16) - c });
  }
  return out.sort((a, b) => a.s - b.s);
}

// ---------------------------------------------------------------- メロディ（フック）
/**
 * 8 小節のフック。2 小節のモチーフを 4 回（a a' a a''）くり返す。音は 5 音音階（長調のペンタトニック）だけを使い、
 * 強拍と長い音はその時の和音の音に寄せる。a' と a'' は終わりの 1〜2 音だけを変える（問い → 答え）。
 */
function genHook(R, loopBars, keyPc, homePc) {
  const pent = [0, 2, 4, 7, 9].map((i) => pcOf(keyPc + i));
  const chordAt = (s) => chordAtBar(loopBars[Math.floor(s / 16) % loopBars.length], s % 16);
  const rhythm = parseRhythm(R.pick(MOTIFS));
  const center = 69 + pcOf(homePc - 9); // A4..G♯5 あたり
  // 1 回目の音の高さ（音階上の段の動きとして覚える）
  const steps = [0];
  for (let i = 1; i < rhythm.length; i++) {
    const x = i / (rhythm.length - 1);
    const up = x < 0.5 ? 0.6 : 0.35;
    steps.push(R.chance(0.12) ? 0 : (R.chance(up) ? 1 : -1) * R.weighted([[1, 70], [2, 30]]));
  }
  const notes = [];
  for (let occ = 0; occ < 4; occ++) {
    const start = occ * 32;
    let cur = nearestWithPc(center, chordTonePcs(chordAt(start), false).filter((p) => pent.includes(p)).concat([homePc]));
    rhythm.forEach((r, i) => {
      const s = start + r.s;
      const ch = chordAt(s);
      let m = i === 0 ? cur : scaleMove(cur, steps[i], pent);
      const last = i === rhythm.length - 1;
      if (last && occ % 2 === 1) { // 答えのフレーズ：終わりを下げて落ち着かせる
        m = scaleMove(cur, -1, pent);
        if (occ === 3) m = nearestWithPc(m, [homePc], -1);
      }
      const strong = r.s % 8 === 0 || r.d >= 4 || last;
      if (strong) {
        const tones = chordTonePcs(ch, false);
        if (!tones.includes(pcOf(m))) m = nearestWithPc(m, tones.filter((p) => pent.includes(p)).length ? tones.filter((p) => pent.includes(p)) : tones);
      }
      while (m > center + 9) m -= 12;
      while (m < center - 7) m += 12;
      let d = r.d;
      if (last) d = Math.max(d, Math.min(32 - r.s - 2, occ === 3 ? 12 : 6));
      notes.push({ s, d, m, v: 0.72 + (r.s % 8 === 0 ? 0.1 : 0) + R.float(-0.04, 0.04) });
      cur = m;
    });
  }
  for (let i = 0; i < notes.length - 1; i++) notes[i].d = Math.min(notes[i].d, notes[i + 1].s - notes[i].s);
  return notes;
}

/** 長い音・強拍のメロディが、伴奏の和音の音の半音上に重なって濁るなら、和音の音へ寄せる。 */
function fixClashes(events) {
  const harm = events.filter((e) => e.i === 'pad' || ((e.i === 'ep' || e.i === 'stab') && e.notes.length >= 3));
  const bells = new Map(events.filter((e) => e.i === 'bell').map((e) => [e.s + ':' + e.m, e]));
  let k = 0, cur = null;
  for (const e of events) {
    if (e.i !== 'lead') continue;
    while (k < harm.length && harm[k].s <= e.s) cur = harm[k++];
    if (!cur || !(e.d >= 3 || e.s % 8 === 0)) continue;
    const pcs = cur.notes.map(pcOf);
    const p = pcOf(e.m);
    if (pcs.includes(p) || !pcs.some((c) => pcOf(p - c) === 1)) continue;
    const m = nearestWithPc(e.m, pcs, 1);
    const b = bells.get(e.s + ':' + (e.m + 12));
    if (b) b.m = m + 12;
    e.m = m;
  }
}

// ---------------------------------------------------------------- ベース
function bassBar(R, pat, chords, nextChord, slap, keyPc) {
  const scale = MAJOR.map((i) => pcOf(keyPc + i));
  const out = [];
  const at = (s) => chordAtBar(chords, s);
  const changes = new Set(chords.map((c) => c.s));
  let prev = null;
  for (let s = 0; s < 16; s++) {
    let tok = pat[s];
    if (changes.has(s) && s > 0 && !'ROFAg'.includes(tok)) tok = 'R'; // 和音が変わったら弾き直す
    if (!'ROFAg'.includes(tok)) continue;
    const ch = at(s);
    const root = bassMidi(rootOf(ch));
    const iv = ch.q;
    let m = root, art = 'finger', v = s % 4 === 0 ? 1 : 0.85;
    if (tok === 'O') { m = root + 12; art = R.chance(slap) ? 'pop' : 'finger'; }
    else if (tok === 'F') m = root + (iv === 'm7b5' || iv === 'dim7' ? 6 : 7);
    else if (tok === 'A') {
      const nextCh = s + 1 < 16 && changes.has(s + 1) ? at(s + 1) : nextChord;
      const target = bassMidi(rootOf(nextCh));
      // 次の根音のとなりの、キーの音階の音から近づく（半音の経過音は使わない）
      m = target === root ? root + 7 : R.chance(0.5) ? nearestWithPc(target - 1, scale, -1) : nearestWithPc(target + 1, scale, 1);
      v = 0.75;
    } else if (tok === 'g') { m = prev ?? root; art = 'ghost'; v = 0.35; }
    if (tok === 'R' && s % 4 === 0 && slap > 0 && R.chance(slap)) art = 'thumb';
    let d = 1;
    while (s + d < 16 && pat[s + d] === '-' && !changes.has(s + d)) d++;
    out.push({ s, m, d: tok === 'g' ? 0.5 : d === 1 && pat[s + 1] === '.' ? 0.8 : d, v, art });
    prev = m;
  }
  return out;
}
