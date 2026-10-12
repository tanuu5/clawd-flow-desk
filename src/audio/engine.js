// engine.js — 曲を鳴らす：ミキサー、エフェクト、先読みスケジューラ、再生リスト
//
// 曲（composer.js のイベント列）を、AudioContext の時計に合わせて少し先まで予約していく。
// 曲ごとに「声部」（楽器ごとのチャンネル＋楽器）を作る。曲の終わりの時刻ちょうどに次の曲の声部を始めるので、
// 曲と曲は途切れずにつながる（作業の流れを切らないため）。古い声部は残響が消えてから片付ける。
// 集中タイマーの休憩に入るとき・戻るときは、小節の頭で新しい曲を始め、古い曲を数小節かけて絞る（クロスフェード）。

import { generateSong, makeTitle, PLAYLIST, BREAK_LIST, STYLE_KEYS, styleBpm } from './composer.js';
import { Instruments, makeResources } from './instruments.js';

// チャンネル：音量、定位、行き先（dry / chorus / bass）、センド量、duck（キックに合わせて沈める）
const CHANNELS = {
  kick:  { gain: 0.8, pan: 0, to: 'dry', rev: 0.0 },
  snare: { gain: 0.95, pan: 0.04, to: 'dry', rev: 0.1, gated: 0.32 },
  hat:   { gain: 0.5, pan: 0.26, to: 'dry', rev: 0.03 },
  perc:  { gain: 0.36, pan: -0.36, to: 'dry', rev: 0.08 },
  tom:   { gain: 0.5, pan: 0, to: 'dry', rev: 0.12, gated: 0.3 },
  crash: { gain: 0.14, pan: -0.2, to: 'dry', rev: 0.1 },
  bass:  { gain: 0.3, pan: 0, to: 'bass', rev: 0 },
  ep:    { gain: 0.36, pan: 0, to: 'chorus', rev: 0.2, autopan: 0.22, duck: true },
  stab:  { gain: 0.42, pan: -0.06, to: 'chorus', rev: 0.18, delay: 0.12, duck: true },
  gtr:   { gain: 0.46, pan: 0.42, to: 'chorus', rev: 0.1, delay: 0.06, tone: true },
  pad:   { gain: 0.34, pan: 0, to: 'chorus', rev: 0.4, duck: true },
  pluck: { gain: 0.5, pan: -0.24, to: 'dry', rev: 0.18, delay: 0.3, duck: true },
  brass: { gain: 0.7, pan: -0.18, to: 'dry', rev: 0.24 },
  lead:  { gain: 0.86, pan: 0.04, to: 'dry', rev: 0.24, delay: 0.18 },
  bell:  { gain: 0.38, pan: -0.3, to: 'dry', rev: 0.35, delay: 0.25 },
  fx:    { gain: 0.5, pan: 0, to: 'dry', rev: 0.12 },
};
export const CHANNEL_NAMES = Object.keys(CHANNELS);

// ---------------------------------------------------------------- エフェクトの部品
function makeImpulse(ctx, seconds, { decay = 2.4, pre = 0.012, gated = false } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < pre) { d[i] = 0; continue; }
      const w = Math.random() * 2 - 1;
      lp = lp * 0.6 + w * 0.4; // 少し丸めた残響
      let e;
      if (gated) e = t < seconds - 0.03 ? 0.9 : Math.max(0, (seconds - t) / 0.03); // 80 年代のゲートリバーブ
      else e = Math.pow(1 - t / seconds, decay) * Math.exp(-t * 1.2);
      const bright = gated ? lp : (t < 0.3 ? w * (1 - t / 0.3) + lp * (t / 0.3) : lp);
      d[i] = bright * e * 0.5;
    }
  }
  return buf;
}

function tanhCurve(k = 1.5, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

/** 共用のミキサー（曲をまたいで使う）。dest は AudioContext の出口か録音先。 */
export function buildMixer(ctx, dest, { measure = false } = {}) {
  const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const mix = g(1);
  if (measure) { // 音量の測定用：コンプ・飽和を通さず、耳の感度に近い重み（K 特性に近いもの）をかける
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60; hp.Q.value = 0.5;
    const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1500; sh.gain.value = 4;
    mix.connect(hp).connect(sh).connect(dest);
  }
  // 作業用の音づくり：低域はしっかり、高域（6kHz より上）はなだらかに落とす → 軽い飽和 → コンプ → リミッター
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 110; low.gain.value = 1.5;
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 320; mud.Q.value = 0.9; mud.gain.value = -2;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500; high.gain.value = -2.5;
  const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 11000; air.Q.value = 0.5;
  const pre = g(0.7);
  const sat = ctx.createWaveShaper(); sat.curve = tanhCurve(1.1); sat.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  // DynamicsCompressor は自動でメイクアップゲインをかける（しきい値と比率から決まる）ので、ここでは足さない
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 2; comp.attack.value = 0.02; comp.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
  const vol = g(0.75);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
  const split = ctx.createChannelSplitter(2);
  const anL = ctx.createAnalyser(), anR = ctx.createAnalyser();
  anL.fftSize = anR.fftSize = 512;
  const sub = ctx.createBiquadFilter(); sub.type = 'highpass'; sub.frequency.value = 32; sub.Q.value = 0.6;
  mix.connect(sub).connect(low).connect(mud).connect(high).connect(air).connect(pre).connect(sat).connect(comp).connect(lim).connect(vol);
  vol.connect(analyser);
  if (!measure) analyser.connect(dest);
  vol.connect(split); split.connect(anL, 0); split.connect(anR, 1);

  // ホールリバーブ
  const revIn = g(1);
  const revHp = ctx.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 220;
  const revLp = ctx.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 5000;
  const reverb = ctx.createConvolver(); reverb.buffer = makeImpulse(ctx, 2.6);
  const revOut = g(0.85);
  revIn.connect(revHp).connect(revLp).connect(reverb).connect(revOut).connect(mix);
  // ゲートリバーブ（スネア用）
  const gatedIn = g(1);
  const gated = ctx.createConvolver(); gated.buffer = makeImpulse(ctx, 0.26, { gated: true, pre: 0.004 });
  const gatedOut = g(0.5);
  gatedIn.connect(gated).connect(gatedOut).connect(mix);
  // ピンポンディレイ
  const delayIn = g(1);
  const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
  const fbLR = g(0.3), fbRL = g(0.3);
  const lpL = ctx.createBiquadFilter(); lpL.type = 'lowpass'; lpL.frequency.value = 2800;
  const lpR = ctx.createBiquadFilter(); lpR.type = 'lowpass'; lpR.frequency.value = 2400;
  const panL = ctx.createStereoPanner(); panL.pan.value = -0.75;
  const panR = ctx.createStereoPanner(); panR.pan.value = 0.75;
  const delayOut = g(0.7);
  delayIn.connect(dL);
  dL.connect(lpL).connect(fbLR).connect(dR);
  dR.connect(lpR).connect(fbRL).connect(dL);
  lpL.connect(panL).connect(delayOut);
  lpR.connect(panR).connect(delayOut);
  delayOut.connect(mix);
  // コーラス（エレピ・ギター・パッド）
  const chorusIn = g(1);
  const dry = g(0.75);
  chorusIn.connect(dry).connect(mix);
  const lfos = [];
  for (const [base, rate, depth, pan] of [[0.013, 0.43, 0.0028, -0.7], [0.018, 0.61, 0.0034, 0.7]]) {
    const d = ctx.createDelay(0.05); d.delayTime.value = base;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
    const lg = g(depth);
    lfo.connect(lg).connect(d.delayTime);
    lfo.start();
    lfos.push(lfo);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    chorusIn.connect(d).connect(p).connect(g(0.5)).connect(mix);
  }
  // ベースのバス（少し歪ませてコンプ）
  const bassIn = g(1);
  const bassLp = ctx.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 3600;
  const bassSat = ctx.createWaveShaper(); bassSat.curve = tanhCurve(1.8); bassSat.oversample = '2x';
  const bassHp = ctx.createBiquadFilter(); bassHp.type = 'highpass'; bassHp.frequency.value = 36; bassHp.Q.value = 0.7;
  const bassComp = ctx.createDynamicsCompressor();
  bassComp.threshold.value = -14; bassComp.ratio.value = 3; bassComp.attack.value = 0.006; bassComp.release.value = 0.12; bassComp.knee.value = 6;
  bassIn.connect(bassHp).connect(bassLp).connect(g(0.8)).connect(bassSat).connect(bassComp).connect(g(0.55)).connect(mix);

  return {
    mix, vol, analyser, anL, anR, lfos,
    buses: { dry: mix, chorus: chorusIn, bass: bassIn, rev: revIn, gated: gatedIn, delay: delayIn },
    setDelayTime(sec) { dL.delayTime.value = sec; dR.delayTime.value = sec; },
  };
}

/** 曲ごとのチャンネル。out.* を絞れば、その曲の音（予約済みも含め）が全部消える。 */
export function makeChannels(ctx, mixer, { solo = null, startAt = 0, level = 1 } = {}) {
  const out = {};
  for (const k of ['dry', 'chorus', 'bass', 'rev', 'gated', 'delay']) {
    out[k] = ctx.createGain();
    out[k].connect(mixer.buses[k]);
  }
  const inputs = {};
  const ducks = [];
  const extras = [];
  for (const [name, c] of Object.entries(CHANNELS)) {
    const input = ctx.createGain();
    input.gain.value = solo && !solo.includes(name) ? 0 : c.gain * level;
    let node = input;
    if (c.duck) { const d = ctx.createGain(); node.connect(d); node = d; ducks.push(d); }
    if (c.tone) { // ギターの音色
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2400; pk.gain.value = 3; pk.Q.value = 0.8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      node.connect(hp).connect(pk).connect(lp);
      node = lp;
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    if (c.autopan) { // スーツケース型エレピのトレモロ風
      const lfo = ctx.createOscillator(); lfo.frequency.value = 3.2;
      const lg = ctx.createGain(); lg.gain.value = c.autopan;
      lfo.connect(lg).connect(pan.pan);
      lfo.start(startAt);
      extras.push(lfo);
    }
    node.connect(pan);
    pan.connect(out[c.to]);
    for (const s of ['rev', 'gated', 'delay']) {
      if (!c[s]) continue;
      const sg = ctx.createGain(); sg.gain.value = c[s];
      pan.connect(sg).connect(out[s]);
    }
    inputs[name] = input;
  }
  return {
    inputs, out, ducks, extras,
    fade(t0, t1, from = 1, to = 0) {
      for (const g of Object.values(out)) { g.gain.setValueAtTime(from, t0); g.gain.linearRampToValueAtTime(to, t1); }
    },
    release(when, tau = 0.06) {
      for (const g of Object.values(out)) { g.gain.cancelScheduledValues(when); g.gain.setTargetAtTime(0, when, tau); }
      const wait = Math.max(0, (when - (ctx.currentTime || 0)) * 1000) + tau * 8000 + 300;
      setTimeout(() => {
        for (const g of Object.values(out)) g.disconnect();
        for (const o of extras) { try { o.stop(); } catch { /* 止まっている */ } }
      }, wait);
    },
  };
}

/** 曲のステップ（16 分音符）を秒に。奇数ステップはスウィングで少し遅らせる。 */
export function stepTime(song, s) {
  const sd = 60 / song.bpm / 4;
  const whole = Math.floor(s);
  return s * sd + (whole % 2 === 1 ? song.swing * sd : 0);
}

/** イベント 1 つを鳴らす。 */
export function playEvent(inst, song, ev, t) {
  const sd = 60 / song.bpm / 4;
  const hum = ev.i === 'kick' || ev.i === 'snare' || ev.i === 'hat' ? 0 : (Math.random() - 0.5) * 0.005;
  const tt = t + hum;
  switch (ev.i) {
    case 'kick': inst.kick(tt, ev.v, ev.len); break;
    case 'snare': inst.snare(tt, ev.v, ev.kind); break;
    case 'hat': inst.hat(tt, ev.v, ev.open); break;
    case 'crash': inst.crash(tt, ev.v); break;
    case 'tom': inst.tom(tt, ev.v, ev.n); break;
    case 'perc': inst.perc(tt, ev.v, ev.kind); break;
    case 'bass': inst.bass(tt, ev.m, ev.d * sd * 0.95, ev.v, ev.art); break;
    case 'ep': inst.ep(tt, ev.notes, ev.d * sd * 0.97, ev.v); break;
    case 'stab': inst.stab(tt, ev.notes, ev.d * sd * 0.9, ev.v); break;
    case 'gtr': inst.gtr(tt, ev.notes, ev.d * sd, ev.v, ev.mute, ev.dir); break;
    case 'pad': inst.pad(tt, ev.notes, ev.d * sd, ev.v); break;
    case 'pluck': inst.pluck(tt, ev.m, ev.d * sd, ev.v); break;
    case 'brass': inst.brass(tt, ev.notes, ev.d * sd * 0.9, ev.v, ev.swell); break;
    case 'lead': inst.lead(tt, ev.m, ev.d * sd * (ev.d >= 2 ? 0.94 : 0.8), ev.v, ev.patch, ev.glide); break;
    case 'bell': inst.bell(tt, ev.m, ev.d * sd, ev.v); break;
    case 'riser': inst.riser(tt, ev.d * sd, ev.v); break;
  }
}

/** 作業用の i 曲目。9 曲目からは、前の曲とのテンポの差が 4 BPM 以内になるように選ぶ。 */
export function trackAt(i, prevBpm = 120) {
  if (i < PLAYLIST.length) return { minor: false, ...PLAYLIST[i], no: i + 1 };
  const seed = 40011 + i * 977;
  const style = STYLE_KEYS[(i * 3 + Math.floor(i / 4)) % STYLE_KEYS.length];
  const wobble = ((seed * 2654435761) >>> 0) % 7 - 3; // -3..+3
  // そのスタイルの速さの範囲の中で、前の曲に近い（差は 4 BPM まで）テンポ
  const [lo, hi] = styleBpm(style);
  const want = Math.max(112, Math.min(122, prevBpm + wobble));
  const bpm = Math.max(lo, Math.min(hi, Math.max(prevBpm - 4, Math.min(prevBpm + 4, want))));
  return { seed, style, bpm, no: i + 1 };
}
/** 休憩用の j 曲目。 */
export function breakAt(j) {
  if (j < BREAK_LIST.length) return { minor: false, ...BREAK_LIST[j], no: j + 1 };
  return { seed: 50021 + j * 613, style: 'lounge', no: j + 1 };
}

// ---------------------------------------------------------------- 再生エンジン
export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.state = 'idle'; // idle | playing | paused
    this.mode = 'work';  // work | break（集中タイマーの休憩中）
    this.trackIndex = 0;
    this.breakIndex = 0;
    this.song = null;    // いま聞こえている曲
    this.voices = [];    // 鳴っている（予約中の）曲
    this.volume = 0.75;
    this.rain = false;
    this.typing = false;
    this.listeners = new Set();
    this.songCache = new Map();
    this.breakCache = new Map();
    this.onOutro = null; // 曲のアウトロに入ったとき呼ぶ。false を返すと、その曲で終わる（動画モード）
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { for (const fn of this.listeners) fn(type, this); }

  songFor(i) {
    if (!this.songCache.has(i)) {
      for (let j = 0; j < i; j++) this.songFor(j); // テンポと曲名を前の曲とくらべるので、前から順に作る
      const t = trackAt(i, i > 0 ? this.songCache.get(i - 1).bpm : 120);
      const s = generateSong(t.seed, t);
      s.no = t.no;
      s.index = i;
      this.retitle(s, [...this.songCache.values()]);
      this.songCache.set(i, s);
    }
    return this.songCache.get(i);
  }

  breakSongFor(j) {
    if (!this.breakCache.has(j)) {
      for (let k = 0; k < j; k++) this.breakSongFor(k);
      const t = breakAt(j);
      const s = generateSong(t.seed, t);
      s.no = t.no;
      s.index = j;
      this.retitle(s, [...this.breakCache.values()]);
      this.breakCache.set(j, s);
    }
    return this.breakCache.get(j);
  }

  /** 前の曲と曲名が重ならず、直前の 5 曲と同じ単語も使わない曲名を選ぶ。 */
  retitle(s, prev) {
    const usedT = new Set(prev.map((p) => p.title)), usedJ = new Set(prev.map((p) => p.titleJa));
    const recent = new Set(prev.slice(-5).flatMap((p) => p.words));
    if (!usedT.has(s.title) && !usedJ.has(s.titleJa) && !s.words.some((w) => recent.has(w))) return;
    for (let a = 1; a < 200; a++) {
      const t = makeTitle(s.seed, a, s.isBreak);
      if (usedT.has(t.title) || (!s.isBreak && usedJ.has(t.titleJa))) continue;
      if (a < 150 && t.words.some((w) => recent.has(w))) continue;
      Object.assign(s, t);
      return;
    }
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'playback' });
    this.res = makeResources(ctx);
    this.mixer = buildMixer(ctx, ctx.destination);
    this.mixer.vol.gain.value = this.volume;
    this.ambience = this.buildAmbience(ctx);
    // 効果音（タイマーの合図、キーを打つ音）は曲とは別のチャンネル
    this.sfx = new Instruments(ctx, this.res, makeChannels(ctx, this.mixer).inputs);
    this.timer = setInterval(() => this.tick(), 25);
    document.addEventListener('visibilitychange', () => this.tick());
    this.spec = new Uint8Array(this.mixer.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.mixer.anL.fftSize);
  }

  buildAmbience(ctx) {
    const sr = ctx.sampleRate;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(ctx.destination);
    // 雨の音：ノイズを帯域で削り、ぱらぱらした粒を足す
    const rainBuf = ctx.createBuffer(2, sr * 4, sr);
    for (let c = 0; c < 2; c++) {
      const d = rainBuf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        lp = lp * 0.85 + (Math.random() * 2 - 1) * 0.15;
        d[i] = lp * 0.9 + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.8 : 0);
      }
    }
    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = rainBuf; rainSrc.loop = true;
    const rainHp = ctx.createBiquadFilter(); rainHp.type = 'highpass'; rainHp.frequency.value = 250;
    const rainLp = ctx.createBiquadFilter(); rainLp.type = 'lowpass'; rainLp.frequency.value = 3800;
    const rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rainHp).connect(rainLp).connect(rainGain).connect(out);
    rainSrc.start();
    return { out, rainGain };
  }

  updateAmbience() {
    if (!this.ctx || this.faded) return;
    const t = this.ctx.currentTime;
    this.ambience.out.gain.setTargetAtTime(this.volume, t, 0.05);
    this.ambience.rainGain.gain.setTargetAtTime(this.rain ? 0.2 : 0, t, 0.8);
  }

  async play() {
    this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.voices.length) this.load(this.mode === 'break' ? this.breakIndex : this.trackIndex, 0, { mode: this.mode });
    this.state = 'playing';
    this.updateAmbience();
    this.emit('state');
  }

  async pause() {
    if (!this.ctx || this.state !== 'playing') return;
    this.state = 'paused';
    this.updateAmbience();
    this.emit('state');
    await new Promise((r) => setTimeout(r, 120));
    if (this.state === 'paused') await this.ctx.suspend();
  }

  toggle() { return this.state === 'playing' ? this.pause() : this.play(); }

  /**
   * 曲を読み込んで鳴らし始める。
   *   at：始める時刻（省略時はすぐ）。crossfade：古い曲を at から何秒かけて絞るか（0 ならすぐ消す）
   *   offset：曲の途中から（確認用・動画の続き用）
   */
  load(i, offset = 0, { mode = this.mode, at = null, crossfade = 0 } = {}) {
    this.ensure();
    const ctx = this.ctx;
    const song = mode === 'break' ? this.breakSongFor(Math.max(0, i)) : this.songFor(Math.max(0, i));
    if (mode === 'break') this.breakIndex = song.index; else this.trackIndex = song.index;
    this.mode = mode;
    const start = (at ?? ctx.currentTime + 0.25) - offset;
    const t0 = Math.max(ctx.currentTime, start + offset);
    for (const v of this.voices) {
      if (v.stopAt <= t0) continue;
      if (crossfade > 0) { v.chans.fade(t0, t0 + crossfade); v.stopAt = t0 + crossfade; }
      else { v.chans.release(t0, 0.05); v.stopAt = t0; }
    }
    const voice = this.makeVoice(song, start, offset);
    this.voices.push(voice);
    this.mixer.setDelayTime((60 / song.bpm) * 0.75);
    if (mode === 'break') this.breakPlayed = true;
    this.song = song;
    if (at == null) this.emit('track'); // 予約した曲は、聞こえ始めたときに 'audible' で知らせる
    return voice;
  }

  makeVoice(song, start, offset = 0) {
    const ctx = this.ctx;
    // 休憩の曲は少し小さめに（作業の曲より 2dB ほど下げる）
    const chans = makeChannels(ctx, this.mixer, { startAt: Math.max(ctx.currentTime, start + offset), level: song.isBreak ? 0.78 : 1 });
    const inst = new Instruments(ctx, this.res, chans.inputs, { ducks: chans.ducks, duck: song.duck });
    let ptr = 0;
    while (offset > 0 && ptr < song.events.length && stepTime(song, song.events[ptr].s) < offset) ptr++;
    const end = start + stepTime(song, song.lengthSteps);
    const outro = song.sections.find((s) => s.type === 'outro');
    return { song, chans, inst, start, ptr, end, stopAt: Infinity, outroAt: start + stepTime(song, outro.startBar * 16), checked: false, final: false, queued: false };
  }

  /** 曲を送る（すぐ切り替える） */
  next() { this.load((this.mode === 'break' ? this.breakIndex : this.trackIndex) + 1); if (this.state !== 'playing') this.play(); }
  prev() {
    const v = this.audible();
    const pos = v && this.ctx ? this.ctx.currentTime - v.start : 0;
    const cur = this.mode === 'break' ? this.breakIndex : this.trackIndex;
    this.load(pos > 4 || cur === 0 ? cur : cur - 1);
    if (this.state !== 'playing') this.play();
  }

  /** 集中タイマーから：休憩（break）と作業（work）を切り替える。鳴っていれば小節の頭でクロスフェード。 */
  setMode(mode) {
    if (mode === this.mode && this.voices.length) return;
    const nextIndex = mode === 'break' ? this.breakIndex + (this.breakPlayed ? 1 : 0) : this.trackIndex + (this.voices.length ? 1 : 0);
    if (!this.ctx || this.state !== 'playing' || !this.voices.length) {
      this.mode = mode;
      if (this.voices.length) { for (const v of this.voices) v.chans.release(this.ctx.currentTime); this.voices = []; }
      if (mode === 'break') { this.breakIndex = nextIndex; this.breakPlayed = false; } else this.trackIndex = nextIndex;
      this.song = mode === 'break' ? this.breakSongFor(this.breakIndex) : this.songFor(this.trackIndex);
      this.emit('track');
      return;
    }
    const v = this.audible();
    const sd = 60 / v.song.bpm;
    const barSec = sd * 4;
    const pos = this.ctx.currentTime + 0.35 - v.start;
    const at = v.start + Math.ceil(pos / barSec) * barSec;
    this.load(nextIndex, 0, { mode, at, crossfade: barSec * (mode === 'break' ? 3 : 1) });
  }

  /** 録画用：出力（曲＋環境音）を MediaStream で取り出す。 */
  recordStream() {
    this.ensure();
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.mixer.vol.connect(this.recDest);
      this.ambience.out.connect(this.recDest);
    }
    return this.recDest.stream;
  }

  /** 止める（動画の終わり）。予約済みの音は絞って消す。 */
  stop() {
    if (!this.ctx) return;
    for (const v of this.voices) v.chans.release(this.ctx.currentTime, 0.3);
    this.voices = [];
    this.song = null;
    this.state = 'idle';
    this.updateAmbience();
    this.emit('state');
  }

  /** 音（曲と環境音）を sec 秒かけて消してから止める（動画の終わり）。 */
  fadeOut(sec = 6) {
    if (!this.ctx) return;
    this.faded = true; // 止めたあとに環境音（雨）が戻らないように
    const t = this.ctx.currentTime;
    for (const g of [this.mixer.vol.gain, this.ambience.out.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + sec);
    }
    setTimeout(() => this.stop(), sec * 1000 + 300);
  }

  /** 効果音が鳴らせる状態にする（一時停止中でも鳴らしたいとき）。 */
  async sfxReady() {
    this.ensure();
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
      clearTimeout(this.sfxSuspend);
      this.sfxSuspend = setTimeout(() => { if (this.state !== 'playing') this.ctx.suspend(); }, 3500);
    }
  }

  /** タイマーの合図。kind：break（休憩へ）/ focus（作業へ）/ done */
  async chime(kind) {
    await this.sfxReady();
    this.sfx.chime(this.ctx.currentTime + 0.02, kind);
  }

  /** Clawd がキーを打った音（タイピング音を有効にしているときだけ）。 */
  keyClick(v = 1, big = false) {
    if (!this.typing || !this.ctx || this.ctx.state !== 'running') return;
    this.sfx.key(this.ctx.currentTime + 0.005, v * 0.55, big);
  }

  /** Clawd をつついたときの小さな音。 */
  blip() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    [79, 84, 88, 91].forEach((m, i) => this.sfx.bell(t + i * 0.06, m, 0.25, 0.5));
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) { this.mixer.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04); this.updateAmbience(); }
  }
  setRain(on) { this.rain = on; this.updateAmbience(); }
  setTyping(on) { this.typing = on; }

  /** いま聞こえている曲の声部（始まっている中でいちばん新しいもの）。 */
  audible() {
    if (!this.voices.length) return null;
    const now = this.ctx ? this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0;
    let best = this.voices[0];
    for (const v of this.voices) if (v.start <= now + 0.02) best = v;
    return best;
  }

  tick() {
    if (!this.ctx || this.state !== 'playing' || !this.voices.length) return;
    const now = this.ctx.currentTime;
    const ahead = document.hidden ? 1.6 : 0.3;
    for (const v of this.voices) {
      const ev = v.song.events;
      while (v.ptr < ev.length) {
        const e = ev[v.ptr];
        const t = v.start + stepTime(v.song, e.s);
        if (t > now + ahead || t >= v.stopAt) break;
        if (t >= now - 0.02) playEvent(v.inst, v.song, e, t);
        v.ptr++;
      }
    }
    const last = this.voices[this.voices.length - 1];
    // アウトロに入ったら、この曲で終えるか聞く（動画の終わり）。終えるなら後半を絞る
    if (!last.checked && now >= last.outroAt) {
      last.checked = true;
      if (this.onOutro && this.onOutro(last.song) === false) {
        last.final = true;
        last.chans.fade(Math.max(now, last.outroAt + (last.end - last.outroAt) * 0.4), last.end);
      }
    }
    // 曲の終わりの時刻ちょうどに次の曲を始める（途切れずにつながる）
    if (!last.queued && !last.final && now + ahead + 0.6 >= last.end) {
      last.queued = true;
      last.stopAt = last.end; // 予約は終わっている。残響が消えるのを待ってから片付ける
      last.chans.release(last.end + 3, 0.5);
      this.load(last.song.index + 1, 0, { mode: last.song.isBreak ? 'break' : 'work', at: last.end });
    }
    if (last.final && now > last.end + 0.3) { this.stop(); this.emit('ended'); return; }
    // 終わった声部を片付ける
    this.voices = this.voices.filter((v) => !(v.stopAt < now - 4 && v !== last));
    const a = this.audible();
    if (a && a.song !== this.shown) { this.shown = a.song; this.emit('audible'); }
  }

  /** 画面側が毎フレーム読む情報（拍・セクション・コード・キック・音量）。 */
  info() {
    const v = this.audible();
    const song = v?.song || this.song;
    if (!this.ctx || !v) return { state: this.state, mode: this.mode, playing: false, step: 0, beat: 0, bar: 0, energy: 0.4, kick: 0, level: 0, song };
    const lat = (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    const now = this.ctx.currentTime - lat;
    const sd = 60 / song.bpm / 4;
    const step = (now - v.start) / sd;
    const inSong = step >= 0 && step < song.lengthSteps;
    const bar = Math.max(0, Math.min(song.bars.length - 1, Math.floor(step / 16)));
    const barInfo = song.bars[bar];
    const sec = song.sections[barInfo.section];
    const sInBar = step - bar * 16;
    let chord = barInfo.chords[0];
    for (const c of barInfo.chords) if (c.s <= sInBar) chord = c;
    const k = lastBefore(song.kicks, step);
    const kick = k == null || !inSong ? 0 : Math.exp(-(step - k) * sd * 9);
    // 出力レベル（メーター用）
    this.mixer.anL.getFloatTimeDomainData(this.wave);
    let l = 0; for (const x of this.wave) l += x * x;
    const levelL = Math.sqrt(l / this.wave.length);
    this.mixer.anR.getFloatTimeDomainData(this.wave);
    let r = 0; for (const x of this.wave) r += x * x;
    const levelR = Math.sqrt(r / this.wave.length);
    return {
      state: this.state, mode: this.mode, playing: this.state === 'playing' && inSong, song,
      step, beat: step / 4, bar, section: sec, sectionIndex: barInfo.section, chord: chord.sym,
      energy: inSong ? sec.energy : 0.3, kick, kimeAge: 99, levelL, levelR, level: (levelL + levelR) / 2,
      time: Math.max(0, now - v.start), duration: v.end - v.start,
    };
  }

  spectrum() {
    if (!this.ctx) return null;
    this.mixer.analyser.getByteFrequencyData(this.spec);
    return this.spec;
  }
}

function lastBefore(arr, x) {
  let lo = 0, hi = arr.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { ans = arr[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** 確認用：曲の一部を OfflineAudioContext で書き出す（画面には鳴らさない）。 */
export async function renderOffline(song, { from = 0, seconds = 20, solo = null, sampleRate = 44100, measure = false } = {}) {
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * seconds), sampleRate);
  const res = makeResources(ctx);
  const mixer = buildMixer(ctx, ctx.destination, { measure });
  const chans = makeChannels(ctx, mixer, { solo, level: song.isBreak ? 0.78 : 1 });
  const inst = new Instruments(ctx, res, chans.inputs, { ducks: chans.ducks, duck: song.duck });
  mixer.setDelayTime((60 / song.bpm) * 0.75);
  const t0 = stepTime(song, from) - 0.05;
  for (const e of song.events) {
    if (e.s < from) continue;
    const t = stepTime(song, e.s) - t0;
    if (t > seconds) break;
    playEvent(inst, song, e, t);
  }
  return ctx.startRendering();
}
