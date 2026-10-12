// instruments.js — Web Audio で合成する楽器（サンプル素材は使わない）
//
// どの楽器も (時刻 t, …) を受け取り、その時刻に鳴る音のノードを組んで、曲のチャンネル（ch.xxx）へつなぐ。
// OfflineAudioContext でも同じコードで動く（音の確認用の書き出しに使う）。

import { mtof } from './theory.js';

export const LEAD_PATCHES = {
  lyricon: { w1: 'sawtooth', w2: 'square', det: 6, m1: 0.5, m2: 0.32, cut: 3.0, env: 2.2, q: 1.1, vib: 0.0065, rate: 5.3, a: 0.025, s: 0.8, r: 0.07, gain: 1.66 },
  synth:   { w1: 'sawtooth', w2: 'sawtooth', det: 9, m1: 0.45, m2: 0.45, cut: 4.2, env: 2.6, q: 1.8, vib: 0.005, rate: 5.8, a: 0.01, s: 0.7, r: 0.09, gain: 1.46 },
  soft:    { w1: 'square', w2: 'triangle', det: 4, m1: 0.32, m2: 0.65, cut: 2.3, env: 1.5, q: 0.8, vib: 0.006, rate: 5.0, a: 0.03, s: 0.85, r: 0.1, gain: 1.0 },
  whistle: { w1: 'sine', w2: 'triangle', det: 3, m1: 0.85, m2: 0.3, cut: 6.0, env: 1.2, q: 0.5, vib: 0.009, rate: 5.6, a: 0.045, s: 0.9, r: 0.12, gain: 0.95, breath: 0.07 },
};

/** 曲をまたいで使い回す素材（ノイズ、金属音、ギターの弦）。 */
export function makeResources(ctx) {
  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * 2, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // TR-808 のシンバルと同じ考え方：6 つの矩形波を重ねた金属音
  const metal = ctx.createBuffer(1, sr, sr);
  const md = metal.getChannelData(0);
  const fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.55);
  for (let i = 0; i < md.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of fr) v += (t * f) % 1 < 0.5 ? 1 : -1;
    md[i] = v / 6;
  }
  return { noise, metal, ks: new Map() };
}

/** Karplus-Strong で弾いた弦の音（音の高さごとに作って使い回す）。 */
function ksBuffer(ctx, res, midi) {
  if (res.ks.has(midi)) return res.ks.get(midi);
  const sr = ctx.sampleRate, f = mtof(midi);
  const len = Math.floor(sr * 1.4);
  const buf = ctx.createBuffer(1, len, sr);
  const y = buf.getChannelData(0);
  const P = sr / f - 0.5;
  const Pi = Math.floor(P), fr = P - Pi;
  const T60 = 1.5 * Math.sqrt(220 / f);
  const g = Math.pow(10, -3 / (f * T60));
  const exc = new Float32Array(Pi + 2);
  let lp = 0;
  for (let i = 0; i < exc.length; i++) { lp = lp * 0.45 + (Math.random() * 2 - 1) * 0.55; exc[i] = lp; }
  const pick = Math.max(1, Math.floor(P * 0.18)); // ピックの位置（ブリッジ寄り）
  for (let i = exc.length - 1; i >= pick; i--) exc[i] -= exc[i - pick] * 0.9;
  for (let n = 0; n < len; n++) {
    if (n < exc.length) { y[n] = exc[n]; continue; }
    const a = (1 - fr) * y[n - Pi] + fr * y[n - Pi - 1];
    const b = (1 - fr) * y[n - Pi - 1] + fr * y[n - Pi - 2];
    y[n] = g * 0.5 * (a + b);
  }
  let peak = 0;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(y[n]));
  const k = peak > 0 ? 0.7 / peak : 1;
  for (let n = 0; n < len; n++) y[n] *= k;
  res.ks.set(midi, buf);
  return buf;
}

const rand = (a, b) => a + Math.random() * (b - a);

export class Instruments {
  /** ducks：キックに合わせて音量を下げるゲイン（サイドチェイン風に、パッドや和音を拍ごとに息づかせる） */
  constructor(ctx, res, ch, { ducks = [], duck = 0 } = {}) {
    this.ctx = ctx;
    this.res = res;
    this.ch = ch;
    this.openHat = null;
    this.ducks = ducks;
    this.duckDepth = duck;
  }

  // ---------------------------------------------------------------- 小道具
  osc(type, f, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    return o;
  }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  noise(t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.res.noise;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }
  metal(t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.res.metal;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }
  /** 打楽器用：すぐ立ち上がって τ で減衰する。 */
  hit(g, t, v, tau, a = 0.001) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setTargetAtTime(0, t + a, tau);
  }

  // ---------------------------------------------------------------- ドラム
  // len：胴鳴りの長さ（ハウスは長め）
  kick(t, v, len = 1) {
    const o = this.osc('sine', 170, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    const g = this.gain(0);
    g.gain.setValueAtTime(v, t);
    g.gain.setTargetAtTime(v * 0.5, t + 0.015, 0.05 * len);
    g.gain.setTargetAtTime(0, t + 0.08 * len, 0.06 * len);
    o.connect(g).connect(this.ch.kick);
    o.start(t); o.stop(t + 0.8);
    // アタックのクリック（はっきりした立ち上がり。高すぎない帯域で）
    const n = this.noise(t, 0.012);
    const bp = this.filter('bandpass', 1800, 0.9);
    const ng = this.gain(0);
    this.hit(ng, t, v * 0.45, 0.004);
    n.connect(bp).connect(ng).connect(this.ch.kick);
    if (this.duckDepth > 0) for (const d of this.ducks) {
      d.gain.setTargetAtTime(1 - this.duckDepth, t, 0.006);
      d.gain.setTargetAtTime(1, t + 0.05, 0.1);
    }
  }

  snare(t, v, kind = 'snare') {
    if (kind === 'rim') return this.rim(t, v);
    if (kind === 'clap') { this.clap(t, v * 1.5); v *= 0.45; }
    const ghost = kind === 'ghost';
    const n = this.noise(t, 0.3);
    const hp = this.filter('highpass', 900);
    const pk = this.filter('peaking', 2600, 0.8); pk.gain.value = 4;
    const lp = this.filter('lowpass', 7000, 0.6);
    const ng = this.gain(0);
    this.hit(ng, t, v * 0.9, ghost ? 0.025 : kind === 'gated' ? 0.09 : 0.065);
    n.connect(hp).connect(pk).connect(lp).connect(ng).connect(this.ch.snare);
    const o = this.osc('triangle', 200, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.04);
    const og = this.gain(0);
    this.hit(og, t, v * 0.85, ghost ? 0.02 : 0.05);
    o.connect(og).connect(this.ch.snare);
    o.start(t); o.stop(t + 0.3);
  }

  rim(t, v) {
    const n = this.noise(t, 0.05);
    const bp = this.filter('bandpass', 3200, 3);
    const g = this.gain(0);
    this.hit(g, t, v * 1.4, 0.012);
    n.connect(bp).connect(g).connect(this.ch.snare);
    const o = this.osc('triangle', 420, t);
    const og = this.gain(0);
    this.hit(og, t, v * 0.6, 0.018);
    o.connect(og).connect(this.ch.snare);
    o.start(t); o.stop(t + 0.15);
  }

  clap(t, v) {
    const n = this.noise(t, 0.35);
    const bp = this.filter('bandpass', 1200, 1.1);
    const g = this.gain(0);
    const p = g.gain;
    p.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const tk = t + k * 0.011;
      p.setValueAtTime(v * 0.9, tk);
      p.setTargetAtTime(0.0001, tk + 0.0005, 0.004);
    }
    p.setValueAtTime(v * 0.8, t + 0.033);
    p.setTargetAtTime(0, t + 0.034, 0.07);
    n.connect(bp).connect(g).connect(this.ch.snare);
  }

  hat(t, v, open = false) {
    if (this.openHat && this.openHat.t < t) { // クローズで開いたハットを止める
      this.openHat.g.gain.setTargetAtTime(0, t, 0.01);
      this.openHat = null;
    }
    // 作業用：高い音が目立たないよう、ハットは 5〜8kHz あたりに寄せて丸める
    const dur = open ? 0.5 : 0.12;
    const m = this.metal(t, dur);
    const n = this.noise(t, dur);
    const hp = this.filter('highpass', 4800, 0.8);
    const bp = this.filter('peaking', 6500, 1); bp.gain.value = 3;
    const lp = this.filter('lowpass', 8500, 0.7);
    const g = this.gain(0);
    this.hit(g, t, v, open ? 0.1 : 0.016);
    const mg = this.gain(0.6), ngn = this.gain(0.45);
    m.connect(mg).connect(hp);
    n.connect(ngn).connect(hp);
    hp.connect(bp).connect(lp).connect(g).connect(this.ch.hat);
    if (open) this.openHat = { g, t };
  }

  crash(t, v) {
    const m = this.metal(t, 3, 0.85);
    const n = this.noise(t, 2.5, 0.9);
    const hp = this.filter('highpass', 3000, 0.7);
    const lp = this.filter('lowpass', 8000, 0.6);
    hp.connect(lp);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.004);
    g.gain.setTargetAtTime(v * 0.35, t + 0.004, 0.12);
    g.gain.setTargetAtTime(0, t + 0.2, 0.75);
    const mg = this.gain(0.5);
    m.connect(mg).connect(hp);
    n.connect(hp);
    lp.connect(g).connect(this.ch.crash);
  }

  tom(t, v, which = 0) {
    const f0 = [200, 150, 110][which] || 150;
    const o = this.osc('sine', f0 * 1.7, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
    const g = this.gain(0);
    this.hit(g, t, v, 0.13);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = [-0.35, 0, 0.35][which] || 0;
    o.connect(g).connect(pan).connect(this.ch.tom);
    o.start(t); o.stop(t + 0.8);
    const n = this.noise(t, 0.05);
    const bp = this.filter('bandpass', 700, 1);
    const ng = this.gain(0);
    this.hit(ng, t, v * 0.3, 0.01);
    n.connect(bp).connect(ng).connect(pan);
  }

  perc(t, v, kind = 'shaker') {
    const n = this.noise(t, 0.15);
    const f = kind === 'tamb' ? this.filter('bandpass', 6000, 1.4) : this.filter('bandpass', 5200, 0.9);
    const g = this.gain(0);
    if (kind === 'tamb') this.hit(g, t, v, 0.035);
    else this.hit(g, t, v * 0.8, 0.022, 0.012);
    n.connect(f).connect(g).connect(this.ch.perc);
    if (kind === 'tamb') {
      const m = this.metal(t, 0.15, 2.2);
      const mg = this.gain(0);
      this.hit(mg, t, v * 0.4, 0.03);
      const hp = this.filter('highpass', 6000);
      m.connect(hp).connect(mg).connect(this.ch.perc);
    }
  }

  // ---------------------------------------------------------------- ベース
  bass(t, m, dur, v, art = 'finger') {
    const f = mtof(m);
    const ghost = art === 'ghost';
    const end = t + (ghost ? 0.045 : Math.max(0.06, dur));
    const o1 = this.osc('sawtooth', f, t);
    const o2 = this.osc('sine', f, t);
    const lp = this.filter('lowpass', 900, art === 'pop' ? 4 : 1.4);
    const base = 160 + f * 1.6;
    const peak = art === 'pop' ? 3600 : art === 'thumb' ? 2300 : ghost ? 450 : 800 + v * 700;
    lp.frequency.setValueAtTime(peak, t);
    lp.frequency.setTargetAtTime(base, t + 0.004, art === 'pop' ? 0.07 : 0.11);
    const g1 = this.gain(0.6), g2 = this.gain(ghost ? 0.15 : 0.5);
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v, t + 0.004);
    amp.gain.setTargetAtTime(v * 0.6, t + 0.004, 0.22);
    amp.gain.setTargetAtTime(0, end, ghost ? 0.01 : 0.025);
    o1.connect(g1).connect(lp).connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(this.ch.bass);
    o1.start(t); o2.start(t);
    o1.stop(end + 0.25); o2.stop(end + 0.25);
    if (art === 'pop' || art === 'thumb' || ghost) {
      const n = this.noise(t, 0.012);
      const hp = this.filter('highpass', art === 'pop' ? 2500 : 1200);
      const ng = this.gain(0);
      this.hit(ng, t, v * (ghost ? 0.25 : 0.18), 0.004);
      n.connect(hp).connect(ng).connect(this.ch.bass);
    }
  }

  // ---------------------------------------------------------------- エレピ（DX 系の FM）
  ep(t, notes, dur, v) {
    for (const m of notes) this.epNote(t + rand(0, 0.007), m, dur, v * rand(0.85, 1));
  }
  epNote(t, m, dur, v) {
    const f = mtof(m);
    const end = t + Math.max(0.08, dur);
    const car = this.osc('sine', f, t);
    const mod = this.osc('sine', f, t);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * (0.5 + 1.5 * v), t);
    mg.gain.setTargetAtTime(f * 0.16, t, 0.3);
    mod.connect(mg).connect(car.frequency);
    const tine = this.osc('sine', f * 14, t);
    const tg = this.gain(0);
    tg.gain.setValueAtTime(f * 1.4 * v, t);
    tg.gain.setTargetAtTime(0, t, 0.012);
    tine.connect(tg).connect(car.frequency);
    const amp = this.gain(0);
    const tau = Math.min(2, Math.max(0.6, 1.9 - (m - 48) * 0.03));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * 0.42, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.003, tau);
    amp.gain.setTargetAtTime(0, end, 0.07);
    car.connect(amp).connect(this.ch.ep);
    const stop = end + 0.5;
    for (const o of [car, mod, tine]) { o.start(t); o.stop(stop); }
  }

  // ---------------------------------------------------------------- ギター（カッティング）
  gtr(t, notes, dur, v, mute = false, dir = 'down') {
    const order = dir === 'up' ? notes.slice().reverse() : notes;
    order.forEach((m, k) => {
      const tt = t + k * (mute ? 0.004 : 0.007);
      const src = this.ctx.createBufferSource();
      src.buffer = ksBuffer(this.ctx, this.res, m);
      const g = this.gain(0);
      const len = mute ? 0.025 : Math.max(0.05, dur * 0.9);
      g.gain.setValueAtTime(v * (mute ? 0.3 : 0.8) * (dir === 'up' ? 0.85 : 1), tt);
      g.gain.setTargetAtTime(0, tt + len, mute ? 0.006 : 0.02);
      src.connect(g).connect(this.ch.gtr);
      src.start(tt);
      src.stop(tt + len + 0.15);
    });
    if (mute) {
      const n = this.noise(t, 0.03);
      const bp = this.filter('bandpass', 2400, 1.5);
      const ng = this.gain(0);
      this.hit(ng, t, v * 0.35, 0.006);
      n.connect(bp).connect(ng).connect(this.ch.gtr);
    }
  }

  // ---------------------------------------------------------------- パッド（ストリングス）
  pad(t, notes, dur, v) {
    const end = t + dur;
    const lp = this.filter('lowpass', 900, 0.6);
    lp.frequency.setValueAtTime(800, t);
    lp.frequency.linearRampToValueAtTime(2000, t + Math.min(dur, 2.5));
    const amp = this.gain(0);
    const level = (v * 0.5) / Math.max(1, notes.length);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + Math.min(0.35, dur * 0.4));
    amp.gain.setTargetAtTime(0, end, 0.25);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner();
    pl.pan.value = -0.6; pr.pan.value = 0.6;
    pl.connect(lp); pr.connect(lp);
    lp.connect(amp).connect(this.ch.pad);
    for (const m of notes) {
      const f = mtof(m);
      for (const [det, pan] of [[-8, pl], [8, pr]]) {
        const o = this.osc('sawtooth', f, t);
        o.detune.value = det + rand(-2, 2);
        o.connect(pan);
        o.start(t); o.stop(end + 1.6);
      }
    }
  }

  // ---------------------------------------------------------------- ブラス（シンセブラス）
  brass(t, notes, dur, v, swell = false) {
    const end = t + dur;
    const lp = this.filter('lowpass', 500, 2);
    const amp = this.gain(0);
    const level = (v * 0.55) / Math.max(1, notes.length);
    if (swell) {
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.linearRampToValueAtTime(2200, t + dur * 0.6);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + dur * 0.5);
      amp.gain.setTargetAtTime(0, end, 0.15);
    } else {
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.linearRampToValueAtTime(3400, t + 0.025);
      lp.frequency.setTargetAtTime(1400, t + 0.025, 0.1);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.012);
      amp.gain.setTargetAtTime(level * 0.7, t + 0.012, 0.08);
      amp.gain.setTargetAtTime(0, end, 0.045);
    }
    lp.connect(amp).connect(this.ch.brass);
    for (const m of notes) {
      const f = mtof(m);
      for (const det of [-7, 7]) {
        const o = this.osc('sawtooth', f, t);
        o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(end + 0.8);
      }
    }
  }

  // ---------------------------------------------------------------- リード
  lead(t, m, dur, v, patch = 'lyricon', glideFrom = null) {
    const P = LEAD_PATCHES[patch] || LEAD_PATCHES.lyricon;
    const f = mtof(m);
    const end = t + Math.max(0.06, dur);
    const o1 = this.osc(P.w1, f, t), o2 = this.osc(P.w2, f, t);
    o2.detune.value = P.det;
    if (glideFrom != null) {
      const f0 = mtof(glideFrom);
      for (const o of [o1, o2]) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.055); }
    }
    if (dur > 0.28) {
      const lfo = this.osc('sine', P.rate, t);
      const vg = this.gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.setValueAtTime(0, t + 0.18);
      vg.gain.linearRampToValueAtTime(f * P.vib, t + 0.55);
      lfo.connect(vg);
      vg.connect(o1.frequency); vg.connect(o2.frequency);
      lfo.start(t); lfo.stop(end + 0.4);
    }
    const cut = Math.min(4500, f * P.cut + 500);
    const lp = this.filter('lowpass', cut, P.q);
    lp.frequency.setValueAtTime(Math.min(6500, cut * P.env), t);
    lp.frequency.setTargetAtTime(cut, t, 0.1);
    const amp = this.gain(0);
    const lv = v * P.gain * 0.5;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(lv, t + (glideFrom != null ? 0.01 : P.a));
    amp.gain.setTargetAtTime(lv * P.s, t + P.a, 0.2);
    amp.gain.setTargetAtTime(0, end, P.r / 3);
    const g1 = this.gain(P.m1), g2 = this.gain(P.m2);
    o1.connect(g1).connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(amp).connect(this.ch.lead);
    o1.start(t); o2.start(t);
    o1.stop(end + 0.4); o2.stop(end + 0.4);
    if (P.breath) {
      const n = this.noise(t, end - t + 0.2);
      const bp = this.filter('bandpass', f * 2, 2);
      const ng = this.gain(0);
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(v * P.breath, t + 0.03);
      ng.gain.setTargetAtTime(v * P.breath * 0.4, t + 0.03, 0.1);
      ng.gain.setTargetAtTime(0, end, 0.04);
      n.connect(bp).connect(ng).connect(this.ch.lead);
    }
  }

  // ---------------------------------------------------------------- ベル（FM）
  bell(t, m, dur, v) {
    const f = mtof(m);
    const end = t + Math.max(0.25, dur);
    const car = this.osc('sine', f, t);
    const mod = this.osc('sine', f * 3.5, t);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 1.5 * v, t);
    mg.gain.setTargetAtTime(f * 0.12, t, 0.2);
    mod.connect(mg).connect(car.frequency);
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * 0.4, t + 0.002);
    amp.gain.setTargetAtTime(0, t + 0.002, 0.65);
    amp.gain.setTargetAtTime(0, end, 0.25);
    car.connect(amp).connect(this.ch.bell);
    car.start(t); mod.start(t);
    car.stop(end + 1.5); mod.stop(end + 1.5);
  }

  // ---------------------------------------------------------------- プラック（アルペジオ・リフ）
  pluck(t, m, dur, v) {
    const f = mtof(m);
    const end = t + Math.max(0.08, dur);
    const o1 = this.osc('sawtooth', f, t), o2 = this.osc('square', f, t);
    o2.detune.value = 7;
    const lp = this.filter('lowpass', 900, 2.2);
    lp.frequency.setValueAtTime(Math.min(4200, f * 5 + 600), t);
    lp.frequency.setTargetAtTime(f * 1.2 + 250, t + 0.002, 0.07);
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * 0.32, t + 0.003);
    amp.gain.setTargetAtTime(v * 0.08, t + 0.003, 0.12);
    amp.gain.setTargetAtTime(0, end, 0.05);
    const g2 = this.gain(0.5);
    o1.connect(lp); o2.connect(g2).connect(lp);
    lp.connect(amp).connect(this.ch.pluck);
    o1.start(t); o2.start(t); o1.stop(end + 0.4); o2.stop(end + 0.4);
  }

  // ---------------------------------------------------------------- オルガンのスタブ（ハウスの和音）
  stab(t, notes, dur, v) {
    const end = t + Math.max(0.08, dur);
    const lp = this.filter('lowpass', 1800, 1.2);
    lp.frequency.setValueAtTime(3400, t);
    lp.frequency.setTargetAtTime(1300, t + 0.004, 0.09);
    const amp = this.gain(0);
    const level = (v * 0.5) / Math.max(1, notes.length);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + 0.003);
    amp.gain.setTargetAtTime(level * 0.35, t + 0.003, 0.08);
    amp.gain.setTargetAtTime(0, end, 0.04);
    lp.connect(amp).connect(this.ch.stab);
    for (const m of notes) {
      const f = mtof(m);
      const a = this.osc('square', f, t), b = this.osc('sine', f * 2, t), c = this.osc('sine', f / 2, t);
      const gb = this.gain(0.45), gc = this.gain(0.6), ga = this.gain(0.55);
      a.connect(ga).connect(lp); b.connect(gb).connect(lp); c.connect(gc).connect(lp);
      for (const o of [a, b, c]) { o.start(t); o.stop(end + 0.3); }
    }
  }

  // ---------------------------------------------------------------- ライザー（ブレイクの終わりに上がっていくノイズ）
  riser(t, dur, v) {
    const n = this.noise(t, dur);
    const bp = this.filter('bandpass', 400, 2.5);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.5, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    n.connect(bp).connect(g).connect(this.ch.fx);
  }

  // ---------------------------------------------------------------- 効果音：タイマーの合図、キーを打つ音
  chime(t, kind = 'break') {
    const seq = kind === 'break' ? [79, 76, 72, 67] : kind === 'done' ? [72, 76, 79, 84, 88] : [67, 72, 76, 79];
    seq.forEach((m, i) => this.bell(t + i * 0.16, m, 0.9, 0.5));
  }

  key(t, v = 1, big = false) {
    const n = this.noise(t, 0.03);
    const bp = this.filter('bandpass', big ? 900 : 1700 + rand(-250, 250), 1.3);
    const g = this.gain(0);
    this.hit(g, t, v * 0.5, big ? 0.012 : 0.006);
    n.connect(bp).connect(g).connect(this.ch.fx);
    const o = this.osc('sine', big ? 110 : 190 + rand(-20, 20), t);
    const og = this.gain(0);
    this.hit(og, t + 0.004, v * 0.22, 0.012);
    o.connect(og).connect(this.ch.fx);
    o.start(t); o.stop(t + 0.08);
  }

  // ---------------------------------------------------------------- 効果音
  needle(t) {
    const n = this.noise(t, 0.08);
    const lp = this.filter('lowpass', 900);
    const g = this.gain(0);
    this.hit(g, t, 0.5, 0.02);
    n.connect(lp).connect(g).connect(this.ch.fx);
    const o = this.osc('sine', 70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const og = this.gain(0);
    this.hit(og, t, 0.4, 0.05);
    o.connect(og).connect(this.ch.fx);
    o.start(t); o.stop(t + 0.4);
  }
}
