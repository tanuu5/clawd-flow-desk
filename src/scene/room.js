// room.js — 62 階の作業部屋（床・壁・窓・机・椅子・ホログラムの画面・ガジェット・照明）
//
// 単位はメートル。床 y=0、窓（奥の壁）z=-3.2、左の壁も途中までガラス（角部屋）。
// Clawd は窓を背にして机に向かう（+z 向き）。画面は机の上に浮かぶ半透明のホログラムで、カメラ側から読める向きにしてある。
// 動かすもの（キーボードの光、タイマー、スピーカー、3D プリンタ、ロボット掃除機…）は update() でまとめて動かす。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';
import { RobotArm } from './robotArm.js';

export const ROOM = { x0: -4.5, x1: 4.5, z0: -3.2, z1: 3.8, h: 3.1 };
export const SEAT = { x: 0.75, y: 0.52, z: -1.82 };   // Clawd が座る位置（椅子の座面の上）
export const DESK = { x: 0.75, y: 0.625, z: -1.2, w: 2.1, d: 0.76 }; // 天板の上面の高さと中心
export const KEYS = { dx: 0.335, z: -1.5, y: 0.647 }; // 分割キーボード（左右の中心は SEAT.x ± dx）

const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const rbox = (w, h, d, r = 0.02, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (name) m.name = name;
  if (parent) parent.add(m);
  return m;
}

export function createRoom() {
  const room = new THREE.Group();
  room.name = 'room';
  const A = {}; // 動かすもの
  const { x0, x1, z0, z1, h } = ROOM;

  // ---------------------------------------------------------------- 床・壁・天井
  const floorMat = new THREE.MeshStandardMaterial({ map: TX.concrete(), color: 0x9a98a4, roughness: 0.32, metalness: 0, envMapIntensity: 0.9 });
  const floor = mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), floorMat, (x0 + x1) / 2, 0, (z0 + z1) / 2, room, 'floor');
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;

  const wallMat = std(0x3b3f4c, 0.92);
  const rightWall = mesh(new THREE.PlaneGeometry(z1 - z0, h), wallMat, x1, h / 2, (z0 + z1) / 2, room, 'wallRight');
  rightWall.rotation.y = -Math.PI / 2;
  const frontWall = mesh(new THREE.PlaneGeometry(x1 - x0, h), wallMat, 0, h / 2, z1, room, 'wallFront');
  frontWall.rotation.y = Math.PI;
  const leftWall = mesh(new THREE.PlaneGeometry(z1 - 0.6, h), wallMat, x0, h / 2, (0.6 + z1) / 2, room, 'wallLeft');
  leftWall.rotation.y = Math.PI / 2;
  const ceil = mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), std(0x15161c, 0.95), 0, h, (z0 + z1) / 2, room, 'ceiling');
  ceil.rotation.x = Math.PI / 2;
  const baseMat = std(0x1d1e24, 0.6);
  mesh(new THREE.BoxGeometry(0.03, 0.08, z1 - z0), baseMat, x1 - 0.015, 0.04, (z0 + z1) / 2, room);
  mesh(new THREE.BoxGeometry(x1 - x0, 0.08, 0.03), baseMat, 0, 0.04, z1 - 0.015, room);

  // 右の壁：木のルーバー（吸音パネル）
  const slat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, h - 0.3, 0.045), std(0x8a6a4c, 0.62), 44);
  slat.name = 'woodSlats';
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 44; i++) { m4.makeTranslation(x1 - 0.03, (h - 0.3) / 2 + 0.15, -2.95 + i * 0.075); slat.setMatrixAt(i, m4); }
  slat.castShadow = false; slat.receiveShadow = true;
  room.add(slat);
  mesh(new THREE.BoxGeometry(0.01, h - 0.3, 44 * 0.075), std(0x1a1712, 0.9), x1 - 0.005, (h - 0.3) / 2 + 0.15, -2.95 + 22 * 0.075 - 0.0375, room);

  // 天井の間接照明（下がり天井のふち）
  const coveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 1.6), toneMapped: false });
  A.coveMat = coveMat;
  const drop = new THREE.Group(); drop.name = 'cove'; room.add(drop);
  const dw = 6.6, dd = 4.6, dy = h - 0.16, dz = 0.1;
  mesh(new THREE.BoxGeometry(dw, 0.12, dd), std(0x1a1b22, 0.9), 0, dy + 0.06, dz, drop);
  for (const [w, d, x, z] of [[dw, 0.03, 0, dz - dd / 2], [dw, 0.03, 0, dz + dd / 2], [0.03, dd, -dw / 2, dz], [0.03, dd, dw / 2, dz]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), coveMat);
    strip.position.set(x, dy - 0.005, z);
    drop.add(strip);
  }
  const dlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.25, 1.05), toneMapped: false });
  A.downMat = dlMat;
  for (const [x, z] of [[-2.2, -0.8], [2.2, -0.8], [-2.2, 1.6], [2.2, 1.6]]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), dlMat);
    d.rotation.x = Math.PI / 2; d.position.set(x, dy - 0.001, z); drop.add(d);
  }

  // ---------------------------------------------------------------- 窓（奥と左のガラス）
  const frameMat = std(0x16161b, 0.4, { metalness: 0.6 });
  const win = new THREE.Group(); win.name = 'windows'; room.add(win);
  for (let x = x0; x <= x1 + 0.01; x += 1.5) mesh(new THREE.BoxGeometry(0.07, h, 0.12), frameMat, x, h / 2, z0, win);
  mesh(new THREE.BoxGeometry(x1 - x0, 0.09, 0.16), frameMat, 0, 0.045, z0, win);
  mesh(new THREE.BoxGeometry(x1 - x0, 0.12, 0.16), frameMat, 0, h - 0.06, z0, win);
  for (let z = z0 + 1.2; z <= 0.61; z += 1.27) mesh(new THREE.BoxGeometry(0.12, h, 0.07), frameMat, x0, h / 2, z, win);
  mesh(new THREE.BoxGeometry(0.16, 0.09, 0.6 - z0), frameMat, x0, 0.045, (z0 + 0.6) / 2, win);
  mesh(new THREE.BoxGeometry(0.16, 0.12, 0.6 - z0), frameMat, x0, h - 0.06, (z0 + 0.6) / 2, win);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb8d8, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.07, depthWrite: false, envMapIntensity: 1.6 });
  A.glassMat = glassMat;
  const g1 = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), glassMat); g1.position.set(0, h / 2, z0 - 0.01); g1.name = 'glassBack'; win.add(g1);
  const g2 = new THREE.Mesh(new THREE.PlaneGeometry(0.6 - z0, h), glassMat); g2.position.set(x0 - 0.01, h / 2, (z0 + 0.6) / 2); g2.rotation.y = Math.PI / 2; g2.name = 'glassLeft'; win.add(g2);
  A.glassPanes = [g1, g2];

  // 外から見たときの建物の壁（上下の階・となりの部屋）
  const facade = new THREE.Group(); facade.name = 'facade'; room.add(facade);
  const fz = z0 - 0.14;
  const facadePlane = (w, hh, cx, cy, cz, ry, seed) => {
    const t = TX.facadeWindows(seed);
    t.repeat.set(w / 12, hh / 10.2);
    t.offset.set(cx / 12, cy / 10.2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.55, 0.52, 0.6) }));
    m.position.set(cx, cy, cz); m.rotation.y = ry;
    facade.add(m);
    A.facadeMats ??= [];
    A.facadeMats.push(m.material);
    return m;
  };
  facadePlane(60, 60, 25.5, h + 30.4, fz, Math.PI, 1);
  facadePlane(60, 60, 25.5, -30.3, fz, Math.PI, 2);
  facadePlane(50.6, h + 0.7, 29.8, h / 2, fz, Math.PI, 3);
  facadePlane(60, 60, x0 - 0.14, h + 30.4, z0 + 30, -Math.PI / 2, 4);
  facadePlane(60, 60, x0 - 0.14, -30.3, z0 + 30, -Math.PI / 2, 5);
  facadePlane(60, h + 0.7, x0 - 0.14, h / 2, 0.6 + 30.05, -Math.PI / 2, 6);
  const slabMat = std(0x0c0c12, 0.6, { metalness: 0.4 });
  mesh(new THREE.BoxGeometry(x1 - x0 + 0.3, 0.3, 0.3), slabMat, 0, -0.15, z0 - 0.05, facade);
  mesh(new THREE.BoxGeometry(x1 - x0 + 0.3, 0.4, 0.3), slabMat, 0, h + 0.2, z0 - 0.05, facade);

  // ---------------------------------------------------------------- ラグ（机の下）
  const rug = mesh(rbox(3.0, 0.012, 2.2, 0.006), new THREE.MeshStandardMaterial({ color: 0x2c3550, roughness: 0.95 }), DESK.x, 0.006, -1.45, room, 'rug');
  rug.castShadow = false;
  const rugEdge = mesh(rbox(2.86, 0.014, 2.06, 0.006), new THREE.MeshStandardMaterial({ color: 0x3a4870, roughness: 0.95 }), DESK.x, 0.007, -1.45, room);
  rugEdge.castShadow = false;

  // ---------------------------------------------------------------- 机（昇降デスク）
  const desk = new THREE.Group(); desk.name = 'desk'; room.add(desk);
  desk.position.set(DESK.x, 0, DESK.z);
  const oak = new THREE.MeshStandardMaterial({ color: 0xb89c78, roughness: 0.5 });
  const metalW = std(0xe9e9ee, 0.35, { metalness: 0.4 });
  mesh(rbox(DESK.w, 0.04, DESK.d, 0.012, 3), oak, 0, DESK.y - 0.02, 0, desk, 'deskTop');
  for (const s of [-1, 1]) {
    mesh(rbox(0.07, DESK.y - 0.06, 0.07, 0.01), metalW, s * (DESK.w / 2 - 0.22), (DESK.y - 0.06) / 2 + 0.02, 0, desk, 'deskLeg');
    mesh(rbox(0.09, 0.03, DESK.d - 0.08, 0.01), metalW, s * (DESK.w / 2 - 0.22), 0.015, 0, desk);
    mesh(rbox(0.07, 0.04, DESK.d - 0.12, 0.01), metalW, s * (DESK.w / 2 - 0.22), DESK.y - 0.06, 0, desk);
  }
  mesh(rbox(DESK.w - 0.5, 0.05, 0.06, 0.01), metalW, 0, DESK.y - 0.07, 0, desk);
  // 天板の下の LED（光の帯）
  const underMat = glow(0.3, 1.6, 2.0);
  A.underMat = underMat;
  const under = new THREE.Mesh(new THREE.BoxGeometry(DESK.w - 0.1, 0.006, 0.01), underMat);
  under.position.set(0, DESK.y - 0.045, DESK.d / 2 - 0.03); desk.add(under);
  // 高さの表示パネル（昇降デスクのボタン）
  const panel = mesh(rbox(0.12, 0.03, 0.05, 0.008), std(0x24252c, 0.4), DESK.w / 2 - 0.25, DESK.y - 0.055, DESK.d / 2 - 0.02, desk);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.016), glow(0.4, 1.8, 2.2));
  lcd.position.set(0, 0, 0.026); panel.add(lcd);

  // ---------------------------------------------------------------- 分割キーボード（左右）
  const kbMat = std(0x26272e, 0.45, { metalness: 0.2 });
  const capTex = TX.keycaps(3);
  A.keyboards = [];
  for (const side of [-1, 1]) {
    const kb = new THREE.Group(); kb.name = side < 0 ? 'keyboardL' : 'keyboardR';
    kb.position.set(SEAT.x + side * KEYS.dx, DESK.y, KEYS.z);
    kb.rotation.y = side * 0.18;
    room.add(kb);
    mesh(rbox(0.27, 0.018, 0.13, 0.008), kbMat, 0, 0.009, 0, kb);
    const capsMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.55, emissive: new THREE.Color(0, 0, 0), emissiveMap: capTex });
    const caps = mesh(new THREE.BoxGeometry(0.25, 0.008, 0.115), [kbMat, kbMat, capsMat, kbMat, kbMat, kbMat], 0, 0.022, 0, kb);
    caps.rotation.y = side < 0 ? 0 : Math.PI; // 右手側は並びを反転して、同じ絵に見えないように
    const rgbMat = glow(1, 0.4, 1.6);
    const rgb = new THREE.Mesh(new THREE.BoxGeometry(0.272, 0.004, 0.132), rgbMat);
    rgb.position.y = 0.002; kb.add(rgb);
    A.keyboards.push({ kb, capsMat, rgbMat, flash: 0, side });
  }

  // ---------------------------------------------------------------- ホログラムの画面（3 枚）
  // 机の奥の投影バーから浮かぶ。左＝コード、右＝ターミナル、上＝音楽と集中タイマー。
  const projMat = std(0x1c1d24, 0.3, { metalness: 0.6 });
  const projBar = mesh(rbox(1.0, 0.025, 0.05, 0.01), projMat, DESK.x, DESK.y + 0.012, -0.96, room, 'projector');
  const emitMat = glow(0.4, 2.0, 2.4);
  const emit = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.004, 0.012), emitMat);
  emit.position.y = 0.013; projBar.add(emit);
  A.emitMat = emitMat;
  const mkScreen = (name, w, hh, cw, ch, x, y, z, ry, rx = 0) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.25, 1.25, 1.25), toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.name = name; m.renderOrder = 4;
    room.add(m);
    // 光の幕（投影バーから画面の下端まで）
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.2), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    return { mesh: m, canvas: c, tex: t, mat, beamMat, w, h: hh };
  };
  A.screens = {
    code: mkScreen('screenCode', 0.8, 0.5, 1024, 640, DESK.x - 0.5, 1.13, -1.06, -0.32),
    term: mkScreen('screenTerm', 0.6, 0.46, 768, 588, DESK.x + 0.55, 1.1, -1.08, 0.34),
    top: mkScreen('screenTop', 0.86, 0.26, 1024, 310, DESK.x + 0.02, 1.53, -1.14, 0, -0.12),
  };

  // ---------------------------------------------------------------- ニキシー管の集中タイマー（机の左手前）
  const nixie = new THREE.Group(); nixie.name = 'nixieTimer'; room.add(nixie);
  nixie.position.set(DESK.x - 0.86, DESK.y, -0.93);
  nixie.rotation.y = 0.35;
  const walnut = std(0x4a2c1a, 0.45);
  mesh(rbox(0.3, 0.045, 0.085, 0.01), walnut, 0, 0.0225, 0, nixie, 'nixieBase');
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 1 });
  const tubeGlass = new THREE.MeshStandardMaterial({ color: 0xffe8d0, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false });
  const digitTex = Array.from({ length: 11 }, (_, d) => nixieDigit(d === 10 ? ' ' : String(d)));
  A.nixie = { tubes: [], digitTex, dots: [] };
  [-0.105, -0.045, 0.045, 0.105].forEach((x) => {
    mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 20), brass, x, 0.051, 0, nixie);
    const glassTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.085, 20, 1, true), tubeGlass);
    glassTube.position.set(x, 0.1, 0); glassTube.renderOrder = 3; nixie.add(glassTube);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tubeGlass);
    cap.position.set(x, 0.1425, 0); nixie.add(cap);
    const dmat = new THREE.MeshBasicMaterial({ map: digitTex[0], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 1.2, 0.5), toneMapped: false });
    const digit = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.054), dmat);
    digit.position.set(x, 0.1, 0.004); nixie.add(digit);
    A.nixie.tubes.push(dmat);
  });
  for (const y of [0.088, 0.112]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), glow(2.4, 1.2, 0.45));
    dot.position.set(0, y, 0.004); nixie.add(dot); A.nixie.dots.push(dot);
  }
  const nixieLight = new THREE.PointLight(0xff8a3a, 0.06, 0.6, 2);
  nixieLight.position.set(0, 0.22, 0.12); nixie.add(nixieLight);
  A.nixie.light = nixieLight;

  // ---------------------------------------------------------------- 音楽のオーブ（机の右奥の小さなスピーカー）
  const orb = new THREE.Group(); orb.name = 'musicOrb'; room.add(orb);
  orb.position.set(DESK.x - 0.76, DESK.y, -1.3);
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 32), std(0xe8e8ee, 0.35), 0, 0.015, 0, orb);
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x20222a, roughness: 0.25, metalness: 0.3, emissive: new THREE.Color(0.3, 0.8, 1.0), emissiveIntensity: 0.4 });
  const orbBall = mesh(new THREE.SphereGeometry(0.07, 32, 20), orbMat, 0, 0.1, 0, orb, 'orbBall');
  const orbRingMat = glow(0.5, 2, 2.4);
  const orbRing = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.004, 8, 48), orbRingMat);
  orbRing.rotation.x = Math.PI / 2; orbRing.position.y = 0.032; orb.add(orbRing);
  Object.assign(A, { orbBall, orbMat, orbRingMat });

  // ---------------------------------------------------------------- 机の上の小物
  // 多肉植物
  const succ = new THREE.Group(); succ.name = 'succulent'; room.add(succ);
  succ.position.set(DESK.x - 0.95, DESK.y, -1.5);
  mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 20), std(0xf0ebe2, 0.6), 0, 0.035, 0, succ);
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 20), std(0x2a1d14, 1), 0, 0.066, 0, succ);
  const leafMat = std(0x6f9a6a, 0.6);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const lf = mesh(new THREE.SphereGeometry(0.018, 10, 8), leafMat, Math.cos(a) * 0.025, 0.08, Math.sin(a) * 0.025, succ);
    lf.scale.set(0.7, 1.6, 0.7); lf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
  }
  // ノートとペン
  const note = mesh(rbox(0.15, 0.012, 0.21, 0.004), std(0x2d4a6e, 0.7), DESK.x + 0.9, DESK.y + 0.006, -0.95, room, 'notebook');
  note.rotation.y = -0.25;
  const pen = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), std(0xe3846a, 0.4), DESK.x + 0.93, DESK.y + 0.016, -0.94, room);
  pen.rotation.set(Math.PI / 2, 0, 0.5);
  // コースター（アイスコーヒーを置く場所）
  A.coaster = new THREE.Vector3(DESK.x + 0.86, DESK.y + 0.006, -1.42);
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.006, 24), std(0xb98e5e, 0.8), A.coaster.x, DESK.y + 0.003, A.coaster.z, room, 'coaster');
  // アイスコーヒーを運ぶロボットアーム（Clawd の手はキーボードでふさがっているので）
  A.arm = new RobotArm(new THREE.Vector3(DESK.x + 0.65, DESK.y, -1.28));
  room.add(A.arm.g);

  // ---------------------------------------------------------------- 椅子（座面は回る）
  const chair = new THREE.Group(); chair.name = 'chair'; room.add(chair);
  chair.position.set(SEAT.x, 0, SEAT.z);
  const shellMat = std(0xf1f0f4, 0.4);
  const cushionMat = new THREE.MeshPhysicalMaterial({ color: 0x2c2f3a, roughness: 0.8, sheen: 0.6, sheenColor: new THREE.Color(0x6a7bb0) });
  const accentMat = std(0xe3846a, 0.5);
  const darkMetal = std(0x2a2b31, 0.4, { metalness: 0.6 });
  for (let k = 0; k < 5; k++) { // 脚と車輪
    const a = (k / 5) * Math.PI * 2;
    const leg = mesh(rbox(0.32, 0.03, 0.05, 0.012), darkMetal, Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16, chair);
    leg.rotation.y = -a;
    mesh(new THREE.SphereGeometry(0.03, 12, 8), darkMetal, Math.cos(a) * 0.31, 0.03, Math.sin(a) * 0.31, chair);
  }
  mesh(new THREE.CylinderGeometry(0.03, 0.035, SEAT.y - 0.14, 16), std(0x9a9ba3, 0.25, { metalness: 0.9 }), 0, (SEAT.y - 0.14) / 2 + 0.08, 0, chair, 'chairPost');
  const swivel = new THREE.Group(); swivel.name = 'chairSwivel'; chair.add(swivel);
  mesh(rbox(0.66, 0.06, 0.56, 0.03, 3), shellMat, 0, SEAT.y - 0.07, -0.02, swivel, 'chairSeatShell');
  mesh(rbox(0.62, 0.05, 0.5, 0.03, 3), cushionMat, 0, SEAT.y - 0.025, -0.01, swivel, 'chairSeat');
  // 背もたれは低め（Clawd は背が低いので、後ろからも見えるように）。座面のシェルから立ち上がるひと続きの形
  const back = new THREE.Group(); back.position.set(0, SEAT.y - 0.09, -0.27); back.rotation.x = -0.1; swivel.add(back);
  mesh(rbox(0.66, 0.4, 0.07, 0.035, 4), shellMat, 0, 0.2, 0, back, 'chairBack');
  mesh(rbox(0.56, 0.2, 0.035, 0.03, 4), cushionMat, 0, 0.27, 0.045, back);
  mesh(rbox(0.3, 0.02, 0.008, 0.004), accentMat, 0, 0.3, -0.038, back);
  // 座面の後ろの角と背もたれのすき間を埋める
  mesh(rbox(0.66, 0.08, 0.12, 0.03, 3), shellMat, 0, SEAT.y - 0.07, -0.25, swivel);
  A.chair = { chair, swivel };

  // ---------------------------------------------------------------- 右の壁ぎわ：棚（3D プリンタ、ミニサーバー、VR ゴーグル）
  const cab = new THREE.Group(); cab.name = 'cabinet'; room.add(cab);
  cab.position.set(3.95, 0, -1.4);
  cab.rotation.y = -Math.PI / 2;
  mesh(rbox(2.2, 0.62, 0.48, 0.012), std(0xeeeae4, 0.55), 0, 0.33, 0, cab, 'cabinetBody');
  for (const x of [-0.55, 0.55]) mesh(new THREE.BoxGeometry(0.004, 0.5, 0.002), std(0xc8c2b8, 0.6), x, 0.33, 0.241, cab);
  mesh(new THREE.BoxGeometry(2.1, 0.012, 0.002), glow(0.3, 1.4, 1.8), 0, 0.04, 0.241, cab);
  // 3D プリンタ（集中の 1 回ぶんで、小さな Clawd が 1 体できあがる）
  const pr = new THREE.Group(); pr.name = 'printer3d'; cab.add(pr);
  pr.position.set(-0.55, 0.64, 0);
  const frame = std(0x2b2c33, 0.4, { metalness: 0.5 });
  for (const [x, z] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) mesh(new THREE.BoxGeometry(0.025, 0.46, 0.025), frame, x, 0.23, z, pr);
  mesh(rbox(0.42, 0.04, 0.38, 0.008), frame, 0, 0.02, 0, pr);
  mesh(rbox(0.42, 0.03, 0.38, 0.008), frame, 0, 0.46, 0, pr);
  const bed = mesh(new THREE.BoxGeometry(0.3, 0.008, 0.28), std(0x3a3d4a, 0.5), 0, 0.06, 0, pr, 'printBed');
  const gantry = new THREE.Group(); pr.add(gantry);
  mesh(new THREE.BoxGeometry(0.38, 0.016, 0.02), frame, 0, 0, 0, gantry);
  const head = new THREE.Group(); gantry.add(head);
  mesh(rbox(0.05, 0.05, 0.05, 0.008), std(0xe3846a, 0.5), 0, 0, 0, head);
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 10), std(0xc9a25a, 0.3, { metalness: 1 }));
  nozzle.rotation.x = Math.PI; nozzle.position.y = -0.034; head.add(nozzle);
  const hotMat = glow(2.2, 0.8, 0.3);
  const hot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), hotMat); hot.position.y = -0.045; head.add(hot);
  // できていく小さな Clawd（下から順に見せる）
  const fig = new THREE.Group(); fig.position.set(0, 0.064, 0); pr.add(fig);
  const figMat = new THREE.MeshStandardMaterial({ color: 0xc67d5f, roughness: 0.55, clippingPlanes: [] });
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.07);
  figMat.clippingPlanes = [clip];
  const S = 0.0016; // SVG の 1px
  mesh(new THREE.BoxGeometry(86 * S, 66 * S, 0.06), figMat, 0, 22 * S + 33 * S, 0, fig);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(24 * S, 22 * S, 0.025), figMat, s * 55 * S, 22 * S + 39 * S, 0, fig);
  for (const x of [-37.5, -16.5, 16.5, 37.5]) mesh(new THREE.BoxGeometry(11 * S, 22 * S, 0.014), figMat, x * S, 11 * S, 0, fig);
  const eyeM = std(0x141414, 0.7);
  eyeM.clippingPlanes = [clip];
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(13 * S, 13 * S, 0.004), eyeM, s * 19 * S, 22 * S + 47 * S, 0.031, fig);
  A.printer = { gantry, head, clip, hotMat, figH: 88 * S, baseY: pr.position.y }; // clip はワールド座標なので、棚の高さを足す
  // ミニサーバー（LED が点滅する）
  const srv = new THREE.Group(); srv.name = 'miniServer'; cab.add(srv);
  srv.position.set(0.2, 0.64, -0.02);
  mesh(rbox(0.26, 0.42, 0.34, 0.01), std(0x1f2027, 0.4, { metalness: 0.4 }), 0, 0.21, 0, srv, 'serverBody');
  const ledGeo = new THREE.BoxGeometry(0.012, 0.006, 0.002);
  A.serverLeds = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.8, 0.8), toneMapped: false });
    const led = new THREE.Mesh(ledGeo, m); led.position.set(-0.08 + c * 0.03, 0.08 + r * 0.05, 0.171); srv.add(led);
    A.serverLeds.push({ m, phase: Math.random() * 10, rate: 2 + Math.random() * 6, hue: Math.random() });
  }
  for (let r = 0; r < 6; r++) mesh(new THREE.BoxGeometry(0.22, 0.002, 0.002), std(0x3a3c46, 0.5), 0, 0.105 + r * 0.05, 0.171, srv);
  // VR ゴーグル
  const vr = new THREE.Group(); vr.name = 'vrHeadset'; cab.add(vr);
  vr.position.set(0.72, 0.64, 0.02);
  mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 16), std(0xe8e8ee, 0.4), 0, 0.11, 0, vr);
  const goggle = mesh(rbox(0.19, 0.1, 0.1, 0.03, 3), std(0xf4f4f6, 0.35), 0, 0.27, 0.02, vr);
  const visor = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.07), new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.1, metalness: 0.8 }));
  visor.position.set(0, 0, 0.051); goggle.add(visor);

  // 右の壁：ホログラムのタスクボード
  const boardC = document.createElement('canvas'); boardC.width = 1024; boardC.height = 640;
  const boardT = new THREE.CanvasTexture(boardC); boardT.colorSpace = THREE.SRGBColorSpace;
  const boardMat = new THREE.MeshBasicMaterial({ map: boardT, transparent: true, depthWrite: false, color: new THREE.Color(1.2, 1.2, 1.2), toneMapped: false });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), boardMat);
  board.position.set(x1 - 0.08, 1.75, -1.35); board.rotation.y = -Math.PI / 2; board.name = 'taskBoard'; board.renderOrder = 4;
  room.add(board);
  A.board = { canvas: boardC, tex: boardT, mat: boardMat, mesh: board };

  // ネオン
  const neonA = new THREE.MeshBasicMaterial({ map: TX.neonText('flow', '#48e4ff', { size: 210 }), transparent: true, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false, blending: THREE.AdditiveBlending });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.39), neonA);
  neon.position.set(x1 - 0.06, 2.55, 0.65); neon.rotation.y = -Math.PI / 2; neon.name = 'neonFlow';
  room.add(neon);
  const neonB = new THREE.MeshBasicMaterial({ map: TX.neonText('62F', '#ff7ab8', { w: 512, h: 256, size: 150, font: '"Zen Kaku Gothic New", sans-serif' }), transparent: true, depthWrite: false, color: new THREE.Color(2, 2, 2), toneMapped: false, blending: THREE.AdditiveBlending });
  const neon2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), neonB);
  neon2.position.set(x1 - 0.06, 2.1, 1.1); neon2.rotation.y = -Math.PI / 2; neon2.name = 'neon62F';
  room.add(neon2);
  A.neons = [neonA, neonB];

  // ---------------------------------------------------------------- 左の窓ぎわ：休憩用のラウンジチェアと植物
  const lounge = new THREE.Group(); lounge.name = 'loungeChair'; room.add(lounge);
  lounge.position.set(-3.3, 0, -1.6); lounge.rotation.y = 0.9;
  const velvet = new THREE.MeshPhysicalMaterial({ color: 0xd9845f, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffc6a8) });
  mesh(rbox(0.8, 0.22, 0.78, 0.08, 4), velvet, 0, 0.3, 0, lounge, 'loungeSeat');
  const lb = mesh(rbox(0.8, 0.6, 0.18, 0.08, 4), velvet, 0, 0.62, -0.32, lounge);
  lb.rotation.x = -0.25;
  for (const [x, z] of [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]]) mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.2, 10), std(0x2a1a12, 0.45), x, 0.1, z, lounge);
  const potMat = std(0xf1ece2, 0.5);
  const mkPlant = (x, z, kind, count, height, spread, scale) => {
    const pl = new THREE.Group(); pl.name = kind; room.add(pl); pl.position.set(x, 0, z);
    mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.46, 32, 1, true), potMat, 0, 0.23, 0, pl, kind + 'Pot');
    mesh(new THREE.CircleGeometry(0.19, 32), potMat, 0, 0.001, 0, pl).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.222, 0.18, 0.44, 32, 1, true), std(0xd9d2c6, 0.6, { side: THREE.BackSide }), 0, 0.24, 0, pl);
    const rim = mesh(new THREE.RingGeometry(0.222, 0.24, 40), potMat, 0, 0.46, 0, pl);
    rim.rotation.x = -Math.PI / 2;
    const soil = mesh(new THREE.CircleGeometry(0.215, 32), std(0x2a1d14, 1), 0, 0.4, 0, pl, kind + 'Soil');
    soil.rotation.x = -Math.PI / 2;
    const lm = new THREE.MeshStandardMaterial({ map: TX.leaf(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    const stemMat = std(0x55703c, 0.8);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (k % 2) * 0.4;
      const tilt = 0.25 + (k % 3) * 0.18;
      const H = height * (0.75 + (k % 4) * 0.1);
      const stem = new THREE.Group(); stem.position.y = 0.4; stem.rotation.set(0, a, 0); pl.add(stem);
      const s = mesh(new THREE.CylinderGeometry(0.008, 0.012, H, 6), stemMat, 0, H / 2, 0, stem);
      s.rotation.z = tilt * 0.6; s.position.x = -Math.sin(tilt * 0.6) * H / 2;
      const lf = new THREE.Mesh(new THREE.PlaneGeometry(spread * 0.5 * scale, spread * scale), lm);
      lf.position.set(-Math.sin(tilt * 0.6) * H - 0.05, H + spread * 0.25 * scale, 0);
      lf.rotation.set(0.2, Math.PI / 2, -tilt - 0.6);
      lf.castShadow = true;
      stem.add(lf);
    }
    return pl;
  };
  A.palm = mkPlant(-3.85, -2.6, 'palm', 9, 1.25, 1.1, 1);
  A.monstera = mkPlant(3.95, 0.35, 'monstera', 7, 0.55, 0.62, 1);
  A.monstera2 = mkPlant(-2.35, -2.75, 'monstera', 6, 0.45, 0.55, 0.9);

  // ---------------------------------------------------------------- 手前の壁：コーヒースタンド
  const bar = new THREE.Group(); bar.name = 'coffeeStand'; room.add(bar);
  bar.position.set(-1.6, 0, 3.45);
  mesh(rbox(2.4, 0.92, 0.55, 0.02), std(0x2b2d36, 0.5), 0, 0.46, 0, bar);
  mesh(rbox(2.5, 0.04, 0.62, 0.01), new THREE.MeshStandardMaterial({ map: TX.marble(), roughness: 0.2 }), 0, 0.94, 0, bar);
  const machine = mesh(rbox(0.42, 0.42, 0.36, 0.03), std(0xd8dade, 0.25, { metalness: 0.8 }), -0.5, 1.17, 0.02, bar, 'espresso');
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), std(0x1d1e24, 0.4), 0, -0.12, 0.2, machine);
  for (let k = 0; k < 4; k++) mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 16), std([0xf4efe6, 0xe3846a, 0x3b5fa8, 0xf4efe6][k], 0.4), 0.2 + k * 0.12, 1.005, 0.08, bar);

  // ---------------------------------------------------------------- ロボット掃除機
  const vac = new THREE.Group(); vac.name = 'robotVacuum'; room.add(vac);
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 36), std(0xf2f2f5, 0.35), 0, 0.045, 0, vac);
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 24), std(0x22232a, 0.3), 0, 0.085, -0.05, vac);
  const vacLed = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.004, 6, 40), glow(0.3, 1.6, 2.2));
  vacLed.rotation.x = Math.PI / 2; vacLed.position.y = 0.081; vac.add(vacLed);
  A.vac = { g: vac, t: 0 };

  // ---------------------------------------------------------------- 照明
  const lights = new THREE.Group(); lights.name = 'lights'; room.add(lights);
  // 机の上の細長いペンダントライト
  const pend = new THREE.Group(); pend.name = 'pendant'; room.add(pend);
  pend.position.set(DESK.x, 2.12, -1.25);
  mesh(rbox(1.3, 0.035, 0.07, 0.015), std(0x1c1d24, 0.4, { metalness: 0.5 }), 0, 0, 0, pend);
  const pendMat = glow(2.4, 2.0, 1.6);
  const pendGlow = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.004, 0.04), pendMat);
  pendGlow.position.y = -0.019; pend.add(pendGlow);
  for (const s of [-1, 1]) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, h - 2.12 - 0.16, 4), std(0x111, 0.5));
    wire.position.set(s * 0.55, (h - 2.12 - 0.16) / 2, 0); pend.add(wire);
  }
  A.pendMat = pendMat;
  const deskSpot = new THREE.SpotLight(0xffd6a8, 2.2, 4.5, 1.0, 0.75, 2);
  deskSpot.position.set(DESK.x, 2.08, -1.25);
  deskSpot.target.position.set(DESK.x, 0.6, -1.25);
  deskSpot.castShadow = true;
  deskSpot.shadow.mapSize.set(1024, 1024);
  deskSpot.shadow.bias = -0.0004;
  deskSpot.shadow.radius = 4;
  lights.add(deskSpot, deskSpot.target);
  // 顔を照らす、ごく弱い暖色のスポット（夜に Clawd の色がくすまないように）
  const faceLight = new THREE.SpotLight(0xffae78, 2.2, 3.5, 0.32, 1, 2);
  faceLight.position.set(DESK.x + 0.15, 1.95, -0.55);
  faceLight.target.position.set(SEAT.x, 0.82, SEAT.z);
  lights.add(faceLight, faceLight.target);
  // 画面の光（Clawd の顔を照らす）
  const screenLight = new THREE.PointLight(0x5fd8ff, 0.35, 2.2, 2);
  screenLight.position.set(DESK.x, 1.05, -1.25);
  lights.add(screenLight);
  const neonLight = new THREE.PointLight(0x48e4ff, 1.6, 4.5, 2);
  neonLight.position.set(x1 - 0.5, 2.3, 0.65);
  lights.add(neonLight);
  const boardLight = new THREE.PointLight(0x7fb8ff, 0.7, 2.6, 2);
  boardLight.position.set(x1 - 0.5, 1.7, -1.35);
  lights.add(boardLight);
  const cove1 = new THREE.PointLight(0x6cc8ff, 1.3, 6, 2); cove1.position.set(-2.4, 2.75, 0.2);
  const cove2 = new THREE.PointLight(0xb08cff, 1.3, 6, 2); cove2.position.set(2.4, 2.75, 0.2);
  lights.add(cove1, cove2);
  const barLight = new THREE.PointLight(0xffc27a, 0.8, 3, 2); barLight.position.set(-1.6, 1.8, 3.1);
  lights.add(barLight);
  Object.assign(A, { deskSpot, faceLight, screenLight, neonLight, boardLight, cove1, cove2, barLight });

  // ---------------------------------------------------------------- 動かす
  let flick = 1, flickT = 0;
  const tmp = new THREE.Vector3();
  const update = (dt, t, music, env, ctx = {}) => {
    const playing = !!music.playing;
    const kick = music.kick || 0;
    // キーボード：打ったところが光り、RGB は拍で色が回る
    for (const k of A.keyboards) {
      k.flash = Math.max(0, k.flash - dt * 7);
      const hue = (t * 0.05 + (k.side < 0 ? 0 : 0.15) + (music.beat || 0) * 0.02) % 1;
      k.rgbMat.color.setHSL(hue, 1, 0.5).multiplyScalar(1.2 + kick * 0.8);
      k.capsMat.emissive.setRGB(0.15, 0.5, 0.9).multiplyScalar(k.flash * 0.9 + 0.08 * env.screen);
    }
    // オーブ
    const lv = Math.min(1, (music.level || 0) * 3.5);
    A.orbBall.scale.setScalar(1 + kick * 0.06);
    A.orbMat.emissiveIntensity = 0.25 + lv * 1.2 + kick * 0.6;
    A.orbMat.emissive.setHSL((t * 0.03) % 1, 0.8, 0.55);
    A.orbRingMat.color.setRGB(0.5, 2, 2.4).multiplyScalar(0.5 + kick * 0.8);
    // 投影バーと画面のゆらぎ
    A.emitMat.color.setRGB(0.4, 2.0, 2.4).multiplyScalar(0.7 + 0.3 * Math.sin(t * 3));
    for (const s of Object.values(A.screens)) s.mat.opacity = (0.93 + Math.sin(t * 37 + s.w * 10) * 0.03) * env.screenAlpha;
    A.screenLight.intensity = 0.35 * env.screen;
    // ネオン（たまに瞬く）
    flickT -= dt;
    if (flickT < 0) { flick = Math.random() < 0.5 ? 0.3 : 1; flickT = flick < 1 ? 0.06 + Math.random() * 0.08 : 4 + Math.random() * 10; }
    A.neons[0].color.setScalar(2.2 * env.neon * flick);
    A.neons[1].color.setScalar(2.0 * env.neon);
    A.neonLight.intensity = 1.6 * env.neon * (0.6 + 0.4 * flick);
    A.underMat.color.setRGB(0.3, 1.6, 2.0).multiplyScalar(0.4 + 0.6 * env.neon);
    // サーバーの LED
    for (const l of A.serverLeds) {
      const on = Math.sin(t * l.rate + l.phase) > (playing ? -0.2 : 0.6) ? 1 : 0.15;
      l.m.color.setHSL(l.hue < 0.7 ? 0.38 : 0.08, 1, 0.5).multiplyScalar(on * 2.2);
    }
    // 3D プリンタ：focus（0〜1、集中の進み）に合わせて下から造形する
    const prog = ctx.printProgress ?? ((t / 600) % 1);
    const P = A.printer;
    const layerY = 0.064 + prog * P.figH;
    P.clip.constant = P.baseY + layerY + 0.0005 + (prog >= 0.999 ? 1 : 0);
    const printing = prog > 0.001 && prog < 0.999;
    const ph = t * (printing ? 3.1 : 0.4);
    P.gantry.position.set(0, Math.max(0.09, layerY + 0.05), 0);
    P.head.position.set(printing ? Math.sin(ph) * 0.045 : -0.15, 0, printing ? Math.sin(ph * 1.37 + 1) * 0.03 : 0.12);
    P.hotMat.color.setRGB(2.2, 0.8, 0.3).multiplyScalar(printing ? 1 : 0.15);
    // ロボット掃除機：部屋の手前を、ゆっくり 8 の字に回る
    const V = A.vac;
    V.t += dt * 0.05;
    const vx = Math.sin(V.t * 2) * 2.4 - 0.4, vz = 1.5 + Math.sin(V.t) * 1.2;
    tmp.set(vx, 0, vz);
    const dx = tmp.x - V.g.position.x, dz = tmp.z - V.g.position.z;
    if (dx * dx + dz * dz > 1e-8) V.g.rotation.y = Math.atan2(dx, dz);
    V.g.position.copy(tmp);
  };
  return { room, A, update, glassPanes: A.glassPanes };
}

/** ニキシー管の数字（オレンジの細い線で光る）。 */
function nixieDigit(ch) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 144;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 96, 144);
  // 奥にうっすら見える、ほかの数字の電極
  g.strokeStyle = 'rgba(255,170,90,0.08)'; g.lineWidth = 2;
  g.font = '300 120px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const d of '0123456789') g.strokeText(d, 48, 76);
  if (ch.trim()) {
    g.shadowColor = '#ff7a20'; g.shadowBlur = 16;
    g.strokeStyle = '#ffb060'; g.lineWidth = 5;
    g.strokeText(ch, 48, 76);
    g.shadowBlur = 4; g.strokeStyle = '#fff1d8'; g.lineWidth = 2;
    g.strokeText(ch, 48, 76);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
