// env.js — 時間帯（朝・昼・夕暮れ・夜・雨の夜）の設定と、そのあいだをなめらかに移る値
import * as THREE from 'three';

const c = (hex) => new THREE.Color(hex);

// 部屋の明かり：pend 机の上のライト / cove 間接照明 / neon ネオンと机の下の光 / screen ホログラムの明るさ
export const PRESETS = {
  morning: {
    label: '朝',
    skyTop: c('#2f5a9a'), skyMid: c('#94b4de'), skyHorizon: c('#ffd9b4'), cloud: c('#f4dcd4'),
    sunDir: new THREE.Vector3(0.68, 0.06, -0.73), sun: 0.8, sunColor: c('#ffe2b0'),
    moonDir: new THREE.Vector3(-0.5, 0.45, -0.72), moon: 0.15, stars: 0,
    fog: c('#b0bdd6'), fogDensity: 0.0007,
    lit: 0.14, warm: 0.65, facade: c('#2a3042'), cityGlow: 0.35, streets: 0.25,
    hemiSky: c('#b8c8ea'), hemiGround: c('#3e3c48'), hemi: 0.85,
    winLight: c('#ffe0b8'), winLightI: 2.2,
    pend: 0.45, neon: 0.45, cove: c('#a8d0ff'), coveI: 0.35, down: 0.5, screen: 0.75, screenAlpha: 0.95,
    exposure: 1.0, bloom: 0.34, rain: 0, envI: 0.95,
  },
  day: {
    label: '昼',
    skyTop: c('#2d6cc8'), skyMid: c('#78aee8'), skyHorizon: c('#cfe2f4'), cloud: c('#ffffff'),
    sunDir: new THREE.Vector3(0.35, 0.62, -0.7), sun: 1, sunColor: c('#fff4e2'),
    moonDir: new THREE.Vector3(-0.5, 0.45, -0.72), moon: 0, stars: 0,
    fog: c('#b9cbe0'), fogDensity: 0.0006,
    lit: 0.05, warm: 0.5, facade: c('#5a6680'), cityGlow: 0.12, streets: 0.08,
    hemiSky: c('#d6e4f8'), hemiGround: c('#575660'), hemi: 1.15,
    winLight: c('#fff6e8'), winLightI: 3.2,
    pend: 0.3, neon: 0.3, cove: c('#cfe6ff'), coveI: 0.2, down: 0.7, screen: 0.6, screenAlpha: 1,
    exposure: 0.92, bloom: 0.22, rain: 0, envI: 1.05,
  },
  sunset: {
    label: '夕暮れ',
    skyTop: c('#22306e'), skyMid: c('#b85688'), skyHorizon: c('#ffa266'), cloud: c('#ffc0a0'),
    sunDir: new THREE.Vector3(-0.62, 0.035, -0.78), sun: 1, sunColor: c('#ffcf8a'),
    moonDir: new THREE.Vector3(0.5, 0.42, -0.75), moon: 0.25, stars: 0,
    fog: c('#b4707e'), fogDensity: 0.0006,
    lit: 0.32, warm: 0.8, facade: c('#2a2030'), cityGlow: 0.7, streets: 0.55,
    hemiSky: c('#9a86c8'), hemiGround: c('#4a2f38'), hemi: 0.75,
    winLight: c('#ffb27a'), winLightI: 2.6,
    pend: 0.65, neon: 0.75, cove: c('#ff9ac0'), coveI: 0.55, down: 0.6, screen: 0.9, screenAlpha: 0.95,
    exposure: 1.0, bloom: 0.42, rain: 0, envI: 0.9,
  },
  night: {
    label: '夜',
    skyTop: c('#05061a'), skyMid: c('#181a48'), skyHorizon: c('#4c3c7c'), cloud: c('#3a3266'),
    sunDir: new THREE.Vector3(-0.62, -0.3, -0.78), sun: 0, sunColor: c('#ffcf8a'),
    moonDir: new THREE.Vector3(0.45, 0.38, -0.8), moon: 1, stars: 1,
    fog: c('#22224a'), fogDensity: 0.0008,
    lit: 0.62, warm: 0.5, facade: c('#07070d'), cityGlow: 1, streets: 1,
    hemiSky: c('#4a5a9a'), hemiGround: c('#161722'), hemi: 0.4,
    winLight: c('#8ea0ff'), winLightI: 0.55,
    pend: 1, neon: 1, cove: c('#6cc8ff'), coveI: 1, down: 0.35, screen: 1, screenAlpha: 0.92,
    exposure: 1.08, bloom: 0.6, rain: 0, envI: 1,
  },
  rain: {
    label: '雨の夜',
    skyTop: c('#090b16'), skyMid: c('#1c2034'), skyHorizon: c('#4a4766'), cloud: c('#2e3048'),
    sunDir: new THREE.Vector3(-0.62, -0.3, -0.78), sun: 0, sunColor: c('#ffcf8a'),
    moonDir: new THREE.Vector3(0.45, 0.38, -0.8), moon: 0, stars: 0,
    fog: c('#2c3044'), fogDensity: 0.0014,
    lit: 0.55, warm: 0.6, facade: c('#080910'), cityGlow: 0.8, streets: 1.1,
    hemiSky: c('#3e4a7a'), hemiGround: c('#14121c'), hemi: 0.4,
    winLight: c('#7f93d8'), winLightI: 0.4,
    pend: 1.1, neon: 1, cove: c('#5f8cff'), coveI: 0.85, down: 0.4, screen: 1, screenAlpha: 0.92,
    exposure: 1.05, bloom: 0.64, rain: 1, envI: 0.9,
  },
};
export const PRESET_KEYS = Object.keys(PRESETS);

/** 今の値。preset を変えると、数秒かけて寄っていく。 */
export class Env {
  constructor(key = 'night') {
    this.key = key;
    this.cur = clonePreset(PRESETS[key]);
    this.from = clonePreset(PRESETS[key]);
    this.t = 1;
    this.dur = 4;
    this.changed = true;
  }
  set(key, instant = false, dur = 4) {
    if (!PRESETS[key]) return;
    this.key = key;
    this.dur = dur;
    this.from = clonePreset(this.cur);
    this.t = instant ? 1 : 0;
    if (instant) this.cur = clonePreset(PRESETS[key]);
    this.changed = true;
  }
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.dur);
    const k = this.t * this.t * (3 - 2 * this.t);
    const to = PRESETS[this.key];
    for (const name in to) {
      const a = this.from[name], b = to[name];
      if (typeof b === 'number') this.cur[name] = a + (b - a) * k;
      else if (b?.isColor) this.cur[name].copy(a).lerp(b, k);
      else if (b?.isVector3) this.cur[name].copy(a).lerp(b, k).normalize();
    }
    if (this.t >= 1) this.changed = true;
    return true;
  }
}

function clonePreset(p) {
  const o = {};
  for (const k in p) o[k] = p[k]?.clone ? p[k].clone() : p[k];
  return o;
}

/** 今の時刻に合う時間帯（はじめて開いたとき用） */
export function presetForHour(h = new Date().getHours()) {
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 9 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'sunset';
  return 'night';
}
