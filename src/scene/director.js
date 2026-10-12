// director.js — カメラ：オート（曲のセクションの変わり目でカットを切り替える）と、自由（ドラッグで見回す）
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ROOM } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// from → to へゆっくり動くショット。[カメラ位置, 注視点]
export const SHOTS = {
  wide:   { a: [V(3.1, 1.52, 1.45), V(0.65, 1.0, -1.6)], b: [V(2.5, 1.45, 1.85), V(0.8, 1.0, -1.6)], fov: 42 },
  room:   { a: [V(3.6, 1.62, 2.35), V(0.6, 0.98, -1.6)], b: [V(3.0, 1.5, 2.8), V(0.8, 0.98, -1.6)], fov: 42 },
  front:  { a: [V(0.87, 1.12, 0.95), V(0.75, 0.98, -1.9)], b: [V(0.57, 1.06, 0.72), V(0.75, 0.98, -1.9)], fov: 40 },
  clawd:  { a: [V(0.02, 0.98, -0.52), V(0.8, 0.82, -1.78)], b: [V(0.28, 0.94, -0.64), V(0.78, 0.82, -1.78)], fov: 34 },
  keys:   { a: [V(1.42, 1.04, -0.62), V(0.75, 0.7, -1.55)], b: [V(0.1, 1.0, -0.66), V(0.78, 0.7, -1.55)], fov: 34 },
  nixie:  { a: [V(0.33, 0.86, -0.52), V(-0.05, 0.72, -1.02)], b: [V(0.53, 0.82, -0.6), V(0.0, 0.72, -1.02)], fov: 30 },
  side:   { a: [V(-2.15, 1.12, -0.75), V(0.85, 0.92, -1.6)], b: [V(-2.05, 1.2, -0.15), V(0.85, 0.92, -1.6)], fov: 40 },
  over:   { a: [V(0.15, 1.28, -2.78), V(0.9, 1.0, -0.6)], b: [V(1.3, 1.32, -2.82), V(0.65, 1.0, -0.6)], fov: 48 },
  board:  { a: [V(0.6, 1.45, 0.75), V(4.3, 1.45, -1.35)], b: [V(0.9, 1.5, 0.35), V(4.3, 1.45, -1.55)], fov: 46 },
  high:   { a: [V(3.15, 2.78, 1.1), V(0.75, 0.6, -1.4)], b: [V(2.45, 2.8, 1.5), V(0.65, 0.6, -1.4)], fov: 44 },
  drone:  { a: [V(1.65, 1.72, -4.7), V(0.75, 0.95, -1.5)], b: [V(0.9, 1.62, -4.4), V(0.75, 0.95, -1.5)], fov: 32 },
};
const ORDER = ['wide', 'clawd', 'keys', 'front', 'nixie', 'room', 'side', 'over', 'board', 'clawd', 'high'];
const REST_ORDER = ['drone', 'room', 'side', 'drone', 'high'];

const ease = (k) => k * k * (3 - 2 * k);

export class Director {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 'auto';
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 5.5;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.target.set(0.75, 0.9, -1.5);
    this.controls.rotateSpeed = 0.6;
    this.shot = 'wide';
    this.elapsed = 0;
    this.dur = 16;
    this.order = 0;
    this.restOrder = 0;
    this.lastSection = -1;
    this.target = new THREE.Vector3();
    this.fixed = null; // 撮影用：ショットを固定する
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.onCut = null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'free') {
      this.controls.enabled = true;
      this.controls.target.copy(this.target);
      this.controls.update();
    } else {
      this.controls.enabled = false;
      this.cut(this.nextShot());
    }
  }

  nextShot(resting = false) {
    if (resting) { this.restOrder = (this.restOrder + 1) % REST_ORDER.length; return REST_ORDER[this.restOrder]; }
    this.order = (this.order + 1) % ORDER.length;
    return ORDER[this.order];
  }

  cut(name, at = 0) {
    this.shot = name;
    this.elapsed = at;
    this.onCut?.(name);
  }

  update(dt, t, music, { resting = false } = {}) {
    if (this.mode === 'free') {
      this.controls.update();
      const p = this.camera.position;
      p.x = THREE.MathUtils.clamp(p.x, ROOM.x0 + 0.25, ROOM.x1 - 0.25);
      p.y = THREE.MathUtils.clamp(p.y, 0.15, ROOM.h - 0.15);
      p.z = THREE.MathUtils.clamp(p.z, ROOM.z0 + 0.25, ROOM.z1 - 0.25);
      this.target.copy(this.controls.target);
      return;
    }
    this.elapsed += dt;
    if (!this.fixed && !this.reduced) {
      const sec = music.playing ? music.sectionIndex : -1;
      const sectionChanged = sec !== this.lastSection;
      this.lastSection = sec;
      if (resting !== this.wasResting) { this.wasResting = resting; if (this.elapsed > 1.5) this.cut(this.nextShot(resting)); }
      else if ((sectionChanged && music.playing && this.elapsed > 5) || this.elapsed > (music.playing ? 17 : 22)) this.cut(this.nextShot(resting));
    }
    const S = SHOTS[this.fixed || this.shot];
    const k = ease(Math.min(1, this.elapsed / (this.reduced ? 60 : this.dur)));
    this.camera.position.lerpVectors(S.a[0], S.b[0], k);
    this.target.lerpVectors(S.a[1], S.b[1], k);
    // 縦長の画面では少し広く撮り、下の再生カードに隠れないよう被写体を上に寄せる
    const aspect = this.camera.aspect;
    const narrow = aspect < 1 ? Math.min(1, (1 - aspect) / 0.55) : 0;
    const fov = narrow ? Math.min(78, S.fov / Math.pow(Math.max(aspect, 0.3), 0.6)) : S.fov;
    if (narrow) {
      const d = this.camera.position.distanceTo(this.target);
      this.target.y -= Math.min(0.45, d * 0.12) * narrow;
    }
    // 手持ちのような、ごく小さな揺れ
    this.camera.position.x += Math.sin(t * 0.63) * 0.006;
    this.camera.position.y += Math.sin(t * 0.47 + 1) * 0.005;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.target);
  }
}
