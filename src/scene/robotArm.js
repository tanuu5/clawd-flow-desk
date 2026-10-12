// robotArm.js — 机の上の小さなロボットアーム（アイスコーヒーを運ぶ係）
//
// 2 本の腕（肩・ひじ）を逆運動学で曲げ、手先（グリッパー）はいつも水平に保つ。
// 位置の指定は「グラスの底の中心」で行う（つかむ位置はそこから少し上）。
// 動きは小さな作業の列（move / grip / wait / hold / call）を順に実行する。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const L1 = 0.34, L2 = 0.3;  // 上腕・前腕の長さ
const H0 = 0.1;             // 台座の上面から肩までの高さ
const REACH = 0.065;        // 手首からグラスの中心まで
const GRIP_Y = 0.075;       // グラスの底からつかむ高さまで
const GLASS_R = 0.034;

const ease = (k) => k * k * (3 - 2 * k);

export class RobotArm {
  /** base：台座の位置（机の天板の上、ワールド座標） */
  constructor(base) {
    this.base = base.clone();
    this.g = new THREE.Group();
    this.g.name = 'robotArm';
    this.g.position.copy(base);
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f1f4, roughness: 0.35 });
    const coral = new THREE.MeshStandardMaterial({ color: 0xe3846a, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.4, metalness: 0.4 });
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.8, 2.2), toneMapped: false });
    const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

    add(this.g, new THREE.CylinderGeometry(0.075, 0.085, 0.03, 32), white, 0, 0.015, 0);
    this.yaw = new THREE.Group(); this.yaw.position.y = 0.03; this.g.add(this.yaw);
    add(this.yaw, new THREE.CylinderGeometry(0.06, 0.065, 0.035, 28), coral, 0, 0.0175, 0);
    add(this.yaw, rb(0.07, 0.07, 0.07, 0.015), white, 0, 0.065, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.0035, 6, 32), this.ledMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.036; this.yaw.add(ring);
    // 肩（x 軸まわりに回る）
    this.shoulder = new THREE.Group(); this.shoulder.position.y = H0 - 0.03; this.yaw.add(this.shoulder);
    add(this.shoulder, new THREE.CylinderGeometry(0.03, 0.03, 0.085, 20).rotateZ(Math.PI / 2), dark);
    add(this.shoulder, rb(0.048, 0.044, L1, 0.014), white, 0, 0, L1 / 2);
    add(this.shoulder, new THREE.BoxGeometry(0.05, 0.008, L1 * 0.6), coral, 0, 0.022, L1 / 2);
    // ひじ
    this.elbow = new THREE.Group(); this.elbow.position.z = L1; this.shoulder.add(this.elbow);
    add(this.elbow, new THREE.CylinderGeometry(0.026, 0.026, 0.07, 20).rotateZ(Math.PI / 2), dark);
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 24), this.ledMat); r.rotation.y = Math.PI / 2; r.position.x = s * 0.036; this.elbow.add(r); }
    add(this.elbow, rb(0.04, 0.038, L2, 0.012), white, 0, 0, L2 / 2);
    // 手首とグリッパー（いつも水平）
    this.wrist = new THREE.Group(); this.wrist.position.z = L2; this.elbow.add(this.wrist);
    add(this.wrist, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 16).rotateZ(Math.PI / 2), dark);
    add(this.wrist, rb(0.11, 0.03, 0.03, 0.008), coral, 0, 0, 0.022);
    this.fingers = [-1, 1].map((s) => add(this.wrist, rb(0.012, 0.05, 0.05, 0.004), dark, s * 0.05, 0, REACH));

    this.p = this.restPoint();  // 今のグラスの目標位置（グラスの底の中心）
    this.grip = 0;              // 0：開く / 1：閉じる
    this.queue = [];
    this.task = null;
    this.t = 0;
    this.tmp = new THREE.Vector3();
    this.solve();
  }

  /** 休む位置：コースターの上あたりで、腕を軽くたたんで待つ */
  restPoint() { return this.base.clone().add(new THREE.Vector3(0.08, 0.17, -0.14)); }

  get idle() { return !this.task && !this.queue.length; }
  run(tasks) { this.queue.push(...tasks); }
  clear() { this.queue = []; this.task = null; }

  /** グラスを持っているときの、グラスの底の位置 */
  glassPos(out = new THREE.Vector3()) { return out.copy(this.p); }

  update(dt) {
    this.t += dt;
    if (!this.task && this.queue.length) { this.task = this.queue.shift(); this.task.t = 0; this.task.from = this.p.clone(); this.task.g0 = this.grip; }
    const k = this.task;
    if (k) {
      k.t += dt;
      if (k.move) {
        const to = typeof k.move === 'function' ? k.move() : k.move;
        const e = ease(Math.min(1, k.t / k.dur));
        this.p.lerpVectors(k.from, to, e);
        this.p.y += Math.sin(Math.PI * e) * (k.lift ?? 0.05);
        if (k.t >= k.dur) { this.p.copy(to); this.task = null; }
      } else if (k.grip != null) {
        this.grip = k.g0 + (k.grip - k.g0) * ease(Math.min(1, k.t / (k.dur || 0.25)));
        if (k.t >= (k.dur || 0.25)) this.task = null;
      } else if (k.wait) {
        if (k.track) this.p.copy(k.track());
        if (k.wait() || k.t > (k.max ?? 10)) this.task = null;
      } else if (k.hold != null) {
        if (k.track) this.p.copy(k.track());
        if (k.t >= k.hold) this.task = null;
      } else if (k.call) {
        this.task = null;
        k.call();
      } else this.task = null;
    }
    this.solve();
    this.ledMat.color.setRGB(0.4, 1.8, 2.2).multiplyScalar(this.idle ? 0.6 : 0.9 + 0.3 * Math.sin(this.t * 10));
  }

  /** グラスの目標位置から、関節の角度を決める */
  solve() {
    const P = this.tmp.copy(this.p);
    P.y += GRIP_Y;
    const dx = P.x - this.base.x, dz = P.z - this.base.z;
    const yaw = Math.atan2(dx, dz);
    this.yaw.rotation.y = yaw;
    const r = Math.max(0.02, Math.hypot(dx, dz) - REACH);       // 手首までの水平距離
    const dy = P.y - (this.base.y + H0);
    const D = THREE.MathUtils.clamp(Math.hypot(r, dy), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const a1 = Math.atan2(dy, r) + Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const ex = Math.cos(a1) * L1, ey = Math.sin(a1) * L1;
    const a2 = Math.atan2(dy - ey, r - ex);                         // 前腕の向き（水平からの角度）
    this.shoulder.rotation.x = -a1;
    this.elbow.rotation.x = -(a2 - a1);
    this.wrist.rotation.x = a2;                                     // 手先を水平に戻す
    const open = 0.058, closed = GLASS_R + 0.007;
    const half = open + (closed - open) * this.grip;
    this.fingers[0].position.x = -half; this.fingers[1].position.x = half;
  }
}
