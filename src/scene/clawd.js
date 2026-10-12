// clawd.js — Clawd（オレンジのカニ）の 3D モデルと動き（作業部屋版）
//
// 形は clawd-mascot スキルの SVG（150×110）をそのまま 3D にしたもの。1px = 0.007m。
//   胴体 86×66、腕 24×22（肩＝胴体側の端が回転軸）、脚 11×22 が 4 本、目 13×13。
// 腕が短いので、机では左右に分けたキーボードに手を置く。打つときは肩の軸を胴体の前寄りへずらす（armZ）。
// 3D では「腕を上げる」の符号が SVG と逆になるので、setArm() の raise（＋で先端が上がる）だけで扱う。
// 作業中はヘッドホン。休憩では椅子ごと振り返って、窓の外を眺めながらアイスコーヒーを飲む。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { zTexture, sparkleTexture } from './textures.js';

const PX = 0.007;
export const CLAWD = {
  BODY_W: 86 * PX, BODY_H: 66 * PX, BODY_D: 0.4,
  ARM_W: 24 * PX, ARM_H: 22 * PX, ARM_D: 0.15,
  LEG_W: 11 * PX, LEG_H: 22 * PX, LEG_D: 0.085,
  EYE: 13 * PX,
  COLOR: 0xc67d5f,
};
const C = CLAWD;

export function createClawd() {
  const root = new THREE.Group();
  root.name = 'clawd';
  // 映り込み（環境マップ）を弱めにして、夜の青い光でオレンジがくすまないようにする
  const mat = new THREE.MeshStandardMaterial({ name: 'clawdBody', color: C.COLOR, roughness: 0.6, metalness: 0, envMapIntensity: 0.55 });
  const eyeMat = new THREE.MeshStandardMaterial({ name: 'clawdEye', color: 0x141414, roughness: 0.75, metalness: 0, envMapIntensity: 0 });

  const hips = new THREE.Group();
  hips.name = 'hips';
  root.add(hips);

  const body = new THREE.Mesh(new RoundedBoxGeometry(C.BODY_W, C.BODY_H, C.BODY_D, 3, 0.02), mat);
  body.name = 'body';
  body.position.y = C.BODY_H / 2;
  hips.add(body);

  // 目（SVG の y=22〜35 → 胴体の上端から 14〜27px 下）
  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  eyes.position.set(0, C.BODY_H - 20.5 * PX, C.BODY_D / 2 + 0.003);
  hips.add(eyes);
  const eyeGeo = new RoundedBoxGeometry(C.EYE, C.EYE, 0.014, 2, 0.003);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.name = 'eyeL'; eyeL.position.x = -19 * PX;
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.name = 'eyeR'; eyeR.position.x = 19 * PX;
  eyes.add(eyeL, eyeR);

  // 腕：回転軸は肩（SVG の x=36 / x=114、y=46）
  const armGeo = new RoundedBoxGeometry(C.ARM_W, C.ARM_H, C.ARM_D, 2, 0.014);
  const mkArm = (side) => {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'armL' : 'armR';
    pivot.position.set(side * 39 * PX, (74 - 46) * PX, 0);
    const m = new THREE.Mesh(armGeo, mat);
    m.name = pivot.name + 'Block';
    m.position.x = side * C.ARM_W / 2;
    pivot.add(m);
    hips.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // 脚：上端が回転軸。x 中心は SVG の 37.5 / 58.5 / 91.5 / 112.5
  const legGeo = new RoundedBoxGeometry(C.LEG_W, C.LEG_H, C.LEG_D, 2, 0.01);
  const legs = [-37.5, -16.5, 16.5, 37.5].map((x, i) => {
    const pivot = new THREE.Group();
    pivot.name = 'leg' + i;
    pivot.position.x = x * PX;
    const m = new THREE.Mesh(legGeo, mat);
    m.name = 'leg' + i + 'Block';
    m.position.y = -C.LEG_H / 2;
    pivot.add(m);
    hips.add(pivot);
    return pivot;
  });

  // ヘッドホン（角ばった体に合わせて、四角いバンド）
  const phones = makeHeadphones();
  hips.add(phones.g);

  // Zzz と きらきら
  const zMat = new THREE.SpriteMaterial({ map: zTexture(), transparent: true, depthWrite: false, opacity: 0 });
  const zzz = [0, 1, 2].map(() => { const s = new THREE.Sprite(zMat.clone()); s.scale.setScalar(0.1); root.add(s); return s; });
  const spMat = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color(2, 1.8, 1.2) });
  const sparkles = [0, 1, 2, 3].map(() => { const s = new THREE.Sprite(spMat.clone()); s.scale.setScalar(0.06); root.add(s); return s; });

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, hips, body, eyes, eyeL, eyeR, armL, armR, legs, phones, zzz, sparkles, mat };
}

function makeHeadphones() {
  const g = new THREE.Group();
  g.name = 'headphones';
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeef2, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.6 });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.8, 2.2), toneMapped: false });
  const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  const top = C.BODY_H + 0.028;
  const sx = C.BODY_W / 2 + 0.028;
  // 耳あては体の後ろ寄り（z<0）に付ける。腕を上げても耳あてに隠れないように
  const z = -0.1;
  const band = new THREE.Mesh(rb(C.BODY_W + 0.085, 0.032, 0.07, 0.014), white);
  band.position.set(0, top, z);
  const pad = new THREE.Mesh(rb(C.BODY_W * 0.7, 0.014, 0.05, 0.006), dark);
  pad.position.set(0, top - 0.02, z);
  g.add(band, pad);
  const cups = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(rb(0.026, top - 0.4 + 0.016, 0.05, 0.01), white);
    arm.position.set(s * sx, (top + 0.4) / 2, z);
    const cup = new THREE.Mesh(rb(0.05, 0.14, 0.14, 0.03), white);
    cup.position.set(s * (sx + 0.006), 0.355, z);
    const cushion = new THREE.Mesh(rb(0.02, 0.12, 0.12, 0.02), dark);
    cushion.position.set(-s * 0.028, 0, 0); cup.add(cushion);
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.0045, 6, 28), ledMat);
    led.rotation.y = Math.PI / 2; led.position.x = s * 0.026; cup.add(led);
    g.add(arm, cup);
    cups.push(cup);
  }
  return { g, ledMat, cups };
}

/** アイスコーヒー（グラスとストロー）。机の上のコースターに置いてあり、飲むときだけ手に取る。 */
export function makeIcedCoffee() {
  const g = new THREE.Group();
  g.name = 'icedCoffee';
  const h = 0.125, r = 0.034;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdff6ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.82, h, 24, 1, true), glassMat);
  cup.position.y = h / 2;
  cup.renderOrder = 2;
  const coffee = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.93, r * 0.78, h * 0.55, 24),
    new THREE.MeshStandardMaterial({ color: 0x5a3420, roughness: 0.3, transparent: true, opacity: 0.92 }));
  coffee.position.y = h * 0.29;
  const milk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.93, h * 0.2, 24),
    new THREE.MeshStandardMaterial({ color: 0xe8d2b4, roughness: 0.5, transparent: true, opacity: 0.9 }));
  milk.position.y = h * 0.66;
  const ice = new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.026, 0.026, 1, 0.005), new THREE.MeshStandardMaterial({ color: 0xf2fbff, roughness: 0.05, transparent: true, opacity: 0.55 }));
  ice.position.set(0.006, h * 0.78, 0.004); ice.rotation.set(0.4, 0.6, 0.2);
  const strawMat = new THREE.MeshStandardMaterial({ color: 0x3fb7c9, roughness: 0.4 });
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 8).translate(0, 0.5, 0), strawMat);
  straw.name = 'straw';
  const bend = new THREE.Mesh(new THREE.SphereGeometry(0.0046, 8, 6), strawMat);
  bend.name = 'strawBend';
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 8).translate(0, 0.5, 0), strawMat);
  stub.name = 'strawStub';
  g.add(coffee, milk, ice, cup, straw, bend, stub);
  g.userData.straw = { straw, bend, stub, base: new THREE.Vector3(-0.012, h * 0.55, 0.004), top: h + 0.012 };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** raise：＋で腕の先が上がる。fwd：＋で腕が体の前へ回る。 */
function setArm(pivot, side, raise, fwd) {
  pivot.rotation.set(0, -side * fwd, side * raise, 'YZX');
}

const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const bump = (ph, center = 0.08, w = 0.012) => {
  let d = ph - center; d -= Math.round(d);
  return Math.exp(-(d * d) / w);
};

// armZ：肩の軸を前へずらす量。legs：脚を前へ出す角度の割合（1 で水平）。turn：π で窓のほうを向く。hold：グラスを手に持つ
const POSES = {
  sleep:   { lean: -0.17, turn: 0, armL: -0.42, armR: -0.4, fwdL: 0.25, fwdR: 0.25, armZ: 0.04, eye: 0.1, sink: 0.01, legs: 0.85, hold: 0 },
  idle:    { lean: -0.06, turn: 0, armL: -0.3, armR: -0.3, fwdL: 0.35, fwdR: 0.35, armZ: 0.06, eye: 1, sink: 0, legs: 0.8, hold: 0 },
  type:    { lean: 0.07, turn: 0, armL: -0.13, armR: -0.13, fwdL: 1.2, fwdR: 1.2, armZ: 0.13, eye: 1, sink: 0, legs: 0.62, hold: 0 },
  think:   { lean: -0.1, turn: 0, armL: -0.22, armR: 0.55, fwdL: 0.9, fwdR: 1.45, armZ: 0.1, eye: 0.85, sink: 0, legs: 0.7, hold: 0 },
  stretch: { lean: -0.2, turn: 0, armL: 1.3, armR: 1.3, fwdL: 0.12, fwdR: 0.12, armZ: 0.1, eye: 0.12, sink: -0.015, legs: 1, hold: 0 },
  sip:     { lean: 0.04, turn: 0, armL: -0.15, armR: -0.28, fwdL: 1.15, fwdR: 1.38, armZ: 0.12, eye: 0.3, sink: 0, legs: 0.65, hold: 1 },
  joy:     { lean: -0.02, turn: 0, armL: 1.05, armR: 1.0, fwdL: 0.15, fwdR: 0.15, armZ: 0.1, eye: 0.35, sink: 0, legs: 1, hold: 0 },
  wake:    { lean: -0.05, turn: 0, armL: 1.15, armR: 1.1, fwdL: 0.12, fwdR: 0.2, armZ: 0.1, eye: 0.55, sink: -0.02, legs: 0.9, hold: 0 },
  // 休憩：椅子ごと振り返って窓の外を眺める（グラスを持ったまま）
  window:  { lean: -0.04, turn: Math.PI, armL: -0.28, armR: -0.3, fwdL: 0.4, fwdR: 1.25, armZ: 0.08, eye: 1, sink: 0, legs: 0.95, hold: 1 },
  winSip:  { lean: 0.03, turn: Math.PI, armL: -0.28, armR: -0.28, fwdL: 0.4, fwdR: 1.38, armZ: 0.12, eye: 0.3, sink: 0, legs: 0.95, hold: 1 },
  // ロボットアームとグラスを受け渡すとき（右手を前に出す）
  reach:   { lean: 0.03, turn: 0, armL: -0.2, armR: -0.22, fwdL: 1.05, fwdR: 1.32, armZ: 0.12, eye: 1, sink: 0, legs: 0.7, hold: 0 },
};
const TIMED = ['wake', 'joy', 'think', 'stretch', 'winSip'];

export class ClawdAnimator {
  /**
   * glass：アイスコーヒー（シーン直下に置く）。coaster：机の上の置き場所（ワールド座標）。arm：運ぶロボットアーム
   * グラスはいつも「コースター」「ロボットアーム」「Clawd の右手」のどれかにある（owner）。
   *   作業中に飲む：アームがコースターから口元の前まで運び、Clawd は打ちながらストローで飲む
   *   休憩：アームが右手に手渡し、Clawd はグラスを持ったまま振り返る。休憩が終わると、アームが受け取ってコースターへ戻す
   */
  constructor(parts, { glass = null, coaster = null, arm = null } = {}) {
    this.p = parts;
    this.glass = glass;
    this.arm = arm;
    this.owner = 'coaster';
    this.sipping = false;
    this.stateT = 0;
    this.coaster = coaster ? coaster.clone() : new THREE.Vector3();
    this.state = 'sleep';
    this.timer = 0;
    this.t = 0;
    this.idleTime = 99;
    this.coolSip = 14;
    this.coolThink = 24;
    this.coolStretch = 70;
    this.coolBreakSip = 6;
    this.blinkT = 2;
    this.blink = 0;
    this.energy = 0.4;
    this.look = new THREE.Vector2();
    this.lookTarget = new THREE.Vector2();
    this.lookHold = 0;
    this.cur = { ...POSES.sleep };
    this.jump = 0;
    this.resting = false;   // 集中タイマーの休憩中
    this.taps = [0, 0];     // 左右の手の打鍵（1 → 0 に減る）
    this.nextKey = null;    // 次に打つステップ（16 分音符）
    this.burst = 0;
    this.onKey = null;      // (side, big) キーを打ったとき
    this.holdK = 0;
    this.sipK = 0;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.inv = new THREE.Matrix4();
  }

  start(state, dur = 0) { this.state = state; this.timer = dur; }

  /** クリックされたとき */
  poke() { if (this.resting) { this.jump = 0.6; return; } this.start('joy', 1.6); this.jump = 1; }

  /** 喜ぶ（集中の 1 回が終わったとき） */
  cheer() { this.start('joy', 2.2); this.jump = 1; }

  /** 集中タイマー：休憩に入る／戻る */
  setResting(on) {
    if (on === this.resting) return;
    this.resting = on;
    if (on) { this.start('stretch', 2.6); this.coolBreakSip = 7; }
  }

  /** その状態のポーズへ一気に移る（録画の途中から始めるとき）。休憩中ならグラスも右手に */
  snap(state) {
    this.state = state; this.cur = { ...POSES[state] }; this.amt = 1; this.idleTime = 0;
    if (this.arm) { this.arm.clear(); this.arm.p.copy(this.arm.restPoint()); this.arm.grip = 0; }
    this.owner = POSES[state].hold ? 'claw' : 'coaster';
  }

  update(dt, { music, camera }) {
    const p = this.p;
    this.t += dt;
    const playing = !!music.playing;
    this.idleTime = playing || this.resting ? 0 : this.idleTime + dt;
    this.energy = smooth(this.energy, playing ? music.energy : 0.3, 1.5, dt);
    const sec = music.section?.type;

    // ---- 状態の切り替え
    if (this.timer > 0) this.timer -= dt;
    // グラスの受け渡しが要るときは、右手を前に出して待つ
    const handoff = this.resting ? this.owner !== 'claw' : this.owner === 'claw';
    const base = handoff ? 'reach' : this.resting ? 'window' : playing ? 'type' : 'idle';
    const prevState = this.state;
    if (this.state === 'sleep') { if (playing || this.resting) this.start('wake', 2.2); }
    else if (!playing && !this.resting && !handoff && this.idleTime > 30) this.start('sleep');
    else if (TIMED.includes(this.state)) { if (this.timer <= 0) this.state = base; }
    else if (this.state !== base) this.state = base;
    if (this.state === 'type') {
      this.coolSip -= dt; this.coolThink -= dt; this.coolStretch -= dt;
      const calm = sec === 'break' || sec === 'intro' || sec === 'outro';
      if (this.coolThink < 0 && !this.sipping && (calm || Math.random() < 0.3)) { this.start('think', 3 + Math.random() * 2.5); this.coolThink = 26 + Math.random() * 24; }
      else if (this.coolSip < 0 && this.arm?.idle && this.owner === 'coaster') { this.serveSip(); this.coolSip = 35 + Math.random() * 30; }
      else if (this.coolStretch < 0 && calm && !this.sipping) { this.start('stretch', 2.8); this.coolStretch = 90 + Math.random() * 90; }
    }
    this.stateT = this.state === prevState ? this.stateT + dt : 0;
    this.driveArm();
    if (this.state === 'window') {
      this.coolBreakSip -= dt;
      if (this.coolBreakSip < 0) { this.start('winSip', 2.6); this.coolBreakSip = 14 + Math.random() * 10; }
    }

    // ---- ポーズへなめらかに寄せる
    const target = POSES[this.state];
    const rate = this.state === 'joy' || this.state === 'wake' ? 9 : 6;
    for (const k in target) this.cur[k] = smooth(this.cur[k], target[k], k === 'turn' ? 2.2 : k === 'hold' ? 3 : rate, dt);
    const c = this.cur;

    // ---- 拍に合わせた動き（足し算）
    const beat = music.beat || 0;
    const ph = ((beat % 1) + 1) % 1;
    const active = playing && this.state !== 'sleep';
    this.amt = smooth(this.amt ?? 0, active ? 1 : 0, 3, dt);
    const nod = bump(ph) * this.amt;
    const groove = THREE.MathUtils.smoothstep(this.energy, 0.8, 1);
    const sway = Math.sin((beat / 4) * Math.PI * 2) * (0.015 + 0.02 * groove) * this.amt;
    const breathe = Math.sin(this.t * (this.state === 'sleep' ? 1.3 : 2.1)) * (this.state === 'sleep' ? 0.014 : 0.006);

    this.jump = Math.max(0, this.jump - dt * 1.4);
    const jumpY = this.jump > 0 ? Math.sin((1 - this.jump) * Math.PI * 2.2) ** 2 * 0.07 * this.jump : 0;

    p.hips.position.y = -c.sink - nod * 0.006 + jumpY;
    p.hips.rotation.set(c.lean + nod * (0.035 + 0.03 * groove), c.turn, sway, 'YXZ');
    p.body.scale.set(1 - breathe * 0.4, 1 + breathe, 1);

    // ---- タイピング：曲の 16 分音符に合わせて、ひと続きずつ打つ
    const typing = this.state === 'type';
    this.typeK = smooth(this.typeK ?? 0, typing ? 1 : 0, 8, dt);
    if (typing) this.tickTyping(music, sec);
    else this.nextKey = null;
    this.taps[0] = Math.max(0, this.taps[0] - dt * 9);
    this.taps[1] = Math.max(0, this.taps[1] - dt * 9);
    const press = (k) => Math.sin(Math.min(1, k) * Math.PI) * this.typeK;

    let raiseL = c.armL - press(this.taps[0]) * 0.11;
    let raiseR = c.armR - press(this.taps[1]) * 0.11;
    if (active && this.state === 'joy') { raiseL += Math.sin(this.t * 14) * 0.08; raiseR -= Math.sin(this.t * 14) * 0.08; }
    if (this.state === 'think') raiseR += Math.sin(this.t * 2.2) * 0.04;
    setArm(p.armL, -1, raiseL, c.fwdL);
    setArm(p.armR, 1, raiseR, c.fwdR);
    p.armL.position.z = p.armR.position.z = c.armZ;

    // ---- 脚：座っているので前に出す。机では少し下げる。拍で軽く揺らす
    const tapA = active ? bump(ph, 0.06, 0.02) * (Math.floor(beat) % 2 === 0 ? 1 : 0) : 0;
    const tapB = active ? bump(ph, 0.06, 0.02) * (Math.floor(beat) % 2 === 1 ? 1 : 0) : 0;
    p.legs.forEach((leg, i) => {
      const tap = i % 2 === 0 ? tapA : tapB;
      leg.rotation.x = -Math.PI / 2 * c.legs + tap * 0.12 + (this.state === 'joy' ? Math.sin(this.t * 18 + i) * 0.2 : 0);
      leg.position.y = C.LEG_D / 2;
      leg.position.z = C.BODY_D / 2 - C.LEG_D / 2 - 0.01;
    });

    // ---- ヘッドホンの光（キックで光る）
    const kick = music.kick || 0;
    p.phones.ledMat.color.setRGB(0.4, 1.8, 2.2).multiplyScalar(0.35 + kick * 1.2 * this.amt);

    // ---- グラス：飲むときと休憩中は手に、ふだんは机のコースターに
    this.updateGlass(dt);

    // ---- まばたきと目線
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt * 9);
    const blinkClose = this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0;
    this.sipEye = smooth(this.sipEye ?? 0, this.sipping && this.sipK > 0.5 ? 1 : 0, 6, dt);
    const open = Math.max(0.08, c.eye * (1 - 0.6 * this.sipEye) * (1 - blinkClose * 0.9));
    this.lookHold -= dt;
    if (this.lookHold < 0) {
      this.lookHold = 0.8 + Math.random() * 2.2;
      if (this.state === 'type') { // 画面を見る（ほとんどはコード、ときどきターミナルと上の画面）
        const r = Math.random();
        this.lookTarget.set(r < 0.62 ? -0.75 + Math.random() * 0.25 : r < 0.88 ? 0.75 : 0.05, r < 0.88 ? 0.45 : 1);
      } else if (camera && Math.random() < 0.6) {
        p.eyes.updateWorldMatrix(true, false);
        this.tmp.copy(camera.position);
        this.inv.copy(p.eyes.matrixWorld).invert();
        this.tmp.applyMatrix4(this.inv);
        if (this.tmp.z > 0.2) this.lookTarget.set(THREE.MathUtils.clamp(this.tmp.x / this.tmp.z, -1, 1), THREE.MathUtils.clamp(this.tmp.y / this.tmp.z, -1, 1));
        else this.lookTarget.set(0, 0);
      } else this.lookTarget.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.4) * 0.8);
    }
    if (this.state === 'think') this.lookTarget.set(0.6, 1);
    if (this.state === 'reach') this.lookTarget.set(0.7, -0.4);
    if (this.state === 'window') this.lookTarget.set(Math.sin(this.t * 0.4) * 0.8, 0.15);
    this.look.x = smooth(this.look.x, this.lookTarget.x, 12, dt);
    this.look.y = smooth(this.look.y, this.lookTarget.y, 12, dt);
    const lx = this.look.x * 0.016, ly = this.look.y * 0.011;
    p.eyeL.position.set(-19 * PX + lx, ly, 0);
    p.eyeR.position.set(19 * PX + lx, ly, 0);
    p.eyeL.scale.y = p.eyeR.scale.y = open;

    // ---- Zzz
    const sleeping = this.state === 'sleep';
    p.zzz.forEach((s, i) => {
      const f = (this.t * 0.32 + i / 3) % 1;
      s.position.set(0.24 + f * 0.14 + Math.sin(f * 6 + i) * 0.02, 0.62 + f * 0.36, 0.05);
      s.material.opacity = smooth(s.material.opacity, sleeping ? Math.sin(f * Math.PI) * 0.95 : 0, 4, dt);
      s.scale.setScalar(0.06 + f * 0.07);
      s.visible = s.material.opacity > 0.01;
    });
    // ---- きらきら
    const joyful = this.state === 'joy';
    p.sparkles.forEach((s, i) => {
      const a = i * 1.7 + this.t * 0.8;
      s.position.set(Math.cos(a) * 0.36, 0.78 + Math.sin(this.t * 3 + i * 2) * 0.05 + (i % 2) * 0.08, 0.05 + Math.sin(a) * 0.12);
      s.material.opacity = smooth(s.material.opacity, joyful ? 0.5 + 0.5 * Math.sin(this.t * 10 + i * 1.3) : 0, 8, dt);
      s.material.rotation = this.t * 1.5 + i;
      s.visible = s.material.opacity > 0.01;
    });
  }

  /** 次の打鍵を決めて、時刻が来たら打つ。ひと続き（4〜14 打）→ 小休止、をくり返す。 */
  tickTyping(music, sec) {
    const step = music.playing ? music.step : this.t * 8; // 曲がないときは 1 秒に 8 打くらい
    if (this.nextKey == null || this.nextKey < step - 8) { this.nextKey = Math.ceil(step); this.burst = 0; }
    let guard = 0;
    while (step >= this.nextKey && guard++ < 4) {
      const big = this.burst === 1 && Math.random() < 0.35; // ひと続きの終わりに Enter
      const side = big ? 1 : Math.random() < 0.5 ? 0 : 1;
      this.taps[side] = 1;
      this.onKey?.(side, big);
      if (this.burst <= 1) {
        // 小休止（曲が盛り上がっているほど短い）
        const e = this.energy;
        const rest = sec === 'break' ? 8 + Math.floor(Math.random() * 12) : Math.round(2 + Math.random() * (e > 0.9 ? 4 : 9));
        this.nextKey += rest;
        this.burst = 4 + Math.floor(Math.random() * (e > 0.9 ? 12 : 8));
      } else {
        this.burst--;
        this.nextKey += this.energy > 0.9 && Math.random() < 0.6 ? 1 : 2;
      }
    }
  }

  /** 右手の先（グラスを持つ位置、グラスの底の中心）をワールド座標で */
  handPos(out = new THREE.Vector3()) {
    this.p.root.updateMatrixWorld(true);
    out.set(C.ARM_W - 0.03, -0.035, C.ARM_D / 2 + 0.034);
    this.p.armR.localToWorld(out);
    out.y -= 0.06;
    return out;
  }

  /** 作業中に飲む：アームがグラスを口元の前まで運び、しばらく持っていてくれる */
  serveSip() {
    const A = this.arm;
    const above = () => this.coaster.clone().add(new THREE.Vector3(0, 0.1, 0));
    // Clawd の前（左右のキーボードのあいだ）。机から少し浮かせて持つ
    const serve = () => { const h = this.p.root.position; return new THREE.Vector3(h.x + 0.1, this.coaster.y + 0.035, h.z + 0.36); };
    A.run([
      { move: above, dur: 0.7, lift: 0.04 },
      { move: () => this.coaster, dur: 0.4, lift: 0 },
      { grip: 1, dur: 0.3 },
      { call: () => { this.owner = 'arm'; } },
      { move: serve, dur: 1.1, lift: 0.14 },
      { call: () => { this.sipping = true; } },
      { hold: 2.6, track: serve },
      { call: () => { this.sipping = false; } },
      { move: above, dur: 1.0, lift: 0.1 },
      { move: () => this.coaster, dur: 0.4, lift: 0 },
      { grip: 0, dur: 0.3 },
      { call: () => { this.owner = 'coaster'; } },
      { move: () => A.restPoint(), dur: 0.8, lift: 0.06 },
    ]);
  }

  /** 休憩の手渡し・受け取りを、グラスのある場所と休憩かどうかから決めて、アームに頼む */
  driveArm() {
    const A = this.arm;
    if (!A || !A.idle) return;
    const settled = () => this.state === 'reach' && this.stateT > 0.7 && Math.abs(this.cur.turn) < 0.08;
    const above = () => this.coaster.clone().add(new THREE.Vector3(0, 0.1, 0));
    const hand = () => this.handPos();
    if (this.resting && this.owner !== 'claw') {
      const pick = this.owner === 'coaster' ? [
        { move: above, dur: 0.7, lift: 0.04 },
        { move: () => this.coaster, dur: 0.4, lift: 0 },
        { grip: 1, dur: 0.3 },
        { call: () => { this.owner = 'arm'; } },
      ] : [];
      // 手渡しの手前で待つ（伸びをしているあいだは、手を追いかけない）
      const near = () => { const h = this.p.root.position; return new THREE.Vector3(h.x + 0.42, this.coaster.y + 0.06, h.z + 0.42); };
      A.run([
        ...pick,
        { move: near, dur: 1.0, lift: 0.1 },
        { wait: () => !this.resting || this.state === 'reach', track: near, max: 10 },
        { move: hand, dur: 0.7, lift: 0.03 },
        { wait: () => !this.resting || settled(), track: hand, max: 8 },
        { call: () => {
          if (!this.resting) return; // 休憩がすぐ終わった：持ったまま、次の判断でコースターへ戻す
          this.owner = 'claw';
          A.run([{ grip: 0, dur: 0.25 }, { move: () => A.restPoint(), dur: 0.9, lift: 0.08 }]);
        } },
      ]);
    } else if (!this.resting && this.owner === 'claw') {
      A.run([
        { wait: () => this.resting || (this.state === 'reach' && Math.abs(this.cur.turn) < 0.3), max: 8 },
        { move: hand, dur: 1.0, lift: 0.1 },
        { wait: () => this.resting || settled(), track: hand, max: 8 },
        { call: () => {
          if (this.resting) { A.run([{ move: () => A.restPoint(), dur: 0.8, lift: 0.06 }]); return; }
          A.run([
            { grip: 1, dur: 0.3 },
            { call: () => { this.owner = 'arm'; } },
            { move: above, dur: 1.0, lift: 0.1 },
            { move: () => this.coaster, dur: 0.4, lift: 0 },
            { grip: 0, dur: 0.3 },
            { call: () => { this.owner = 'coaster'; } },
            { move: () => A.restPoint(), dur: 0.8, lift: 0.06 },
          ]);
        } },
      ]);
    } else if (this.owner === 'arm') {
      // 途中で取りやめになった：コースターへ戻す
      A.run([
        { move: above, dur: 1.0, lift: 0.1 },
        { move: () => this.coaster, dur: 0.4, lift: 0 },
        { grip: 0, dur: 0.3 },
        { call: () => { this.owner = 'coaster'; } },
        { move: () => A.restPoint(), dur: 0.8, lift: 0.06 },
      ]);
    }
  }

  updateGlass(dt) {
    const g = this.glass;
    if (!g) return;
    this.arm?.update(dt);
    const sipT = this.state === 'winSip' ? Math.min(1, (2.6 - this.timer) / 0.6) * Math.min(1, this.timer / 0.5) : this.sipping ? 1 : 0;
    this.sipK = smooth(this.sipK, sipT, this.sipping ? 4 : 10, dt);
    if (this.owner === 'arm') this.arm.glassPos(g.position);
    else if (this.owner === 'claw') this.handPos(g.position);
    else g.position.copy(this.coaster);
    g.rotation.set(0, 0, 0);
    this.aimStraw(this.sipK);
  }

  /** ストローの向き。k=0 でふつう（上に斜め）、k=1 で口（目の下の真ん中）まで伸びる。 */
  aimStraw(k) {
    const g = this.glass;
    const S = g.userData.straw;
    this._a ??= new THREE.Vector3(); this._b ??= new THREE.Vector3(); this._c ??= new THREE.Vector3(); this._m ??= new THREE.Vector3(); this._inv ??= new THREE.Matrix4();
    const A = this._a.set(S.base.x, S.top, S.base.z);
    const up = this._b.set(-0.045, 0.085, 0).add(A);
    g.updateMatrixWorld(true);
    this._inv.copy(g.matrixWorld).invert();
    const mouth = this._m.set(0.0, 0.235, C.BODY_D / 2 + 0.006);
    this.p.hips.localToWorld(mouth);
    mouth.applyMatrix4(this._inv);
    const rise = this._c.copy(A).setY(Math.max(A.y + 0.02, mouth.y + 0.004));
    const bendAt = rise.clone().lerp(up, 1 - k);
    const tip = up.clone().lerp(mouth, k);
    const seg = (mesh, from, to) => {
      const d = to.clone().sub(from);
      const len = Math.max(1e-4, d.length());
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len));
      mesh.scale.set(1, len, 1);
    };
    seg(S.stub, S.base, k > 0.01 ? bendAt : A);
    seg(S.straw, k > 0.01 ? bendAt : A, tip);
    S.bend.position.copy(k > 0.01 ? bendAt : A);
  }

  state_() { return { state: this.state, energy: +this.energy.toFixed(2), resting: this.resting }; }
}
