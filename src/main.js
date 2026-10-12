// main.js — 全体のつなぎ：描画、音楽、Clawd、カメラ、画面、集中タイマー、UI
import * as THREE from 'three';
import { MusicEngine } from './audio/engine.js';
import { createRoom, SEAT, ROOM } from './scene/room.js';
import { createCity, dropletsMaterial } from './scene/city.js';
import { createClawd, ClawdAnimator, makeIcedCoffee } from './scene/clawd.js';
import { Env, PRESETS, presetForHour } from './scene/env.js';
import { createPost } from './scene/post.js';
import { Director, SHOTS } from './scene/director.js';
import { Screens } from './scene/screens.js';
import { FocusTimer } from './focus.js';
import { createUI } from './ui.js';
import { installDevHarness } from '../dev/devHarness.js';
import { setupVideoMode } from './video.js';

const params = new URLSearchParams(location.search);
const VIDEO = params.has('video') ? (+params.get('video') || 60) : 0; // 動画モード（分）

// 設定の保存（読めない環境でも動くように）
const store = {
  get(k, d) { try { const v = localStorage.getItem('cfd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cfd.' + k, JSON.stringify(v)); } catch { /* 保存できなくてもよい */ } },
};

// ---------------------------------------------------------------- 描画の準備
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('dev') });
let pixelRatio = Math.min(devicePixelRatio || 1, 1.5); // 作業中に長く流しておくものなので、解像度は控えめに
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true; // 3D プリンタの造形（下から順に見せる）
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x271f45, 0.00055);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 12000);
camera.position.set(3, 1.5, 2.4);

const envKey = PRESETS[params.get('env')] ? params.get('env') : store.get('env', presetForHour());
const env = new Env(PRESETS[envKey] ? envKey : 'night');

const room = createRoom();
scene.add(room.room);
const city = createCity();
scene.add(city.city);
const clawd = createClawd();
clawd.root.position.set(SEAT.x, SEAT.y, SEAT.z);
scene.add(clawd.root);
const glass = makeIcedCoffee();
scene.add(glass);
const anim = new ClawdAnimator(clawd, { glass, coaster: room.A.coaster, arm: room.A.arm });

const drops = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.h), dropletsMaterial());
drops.material.uniforms.uAspect.value = (ROOM.x1 - ROOM.x0) / ROOM.h;
drops.position.set(0, ROOM.h / 2, ROOM.z0 + 0.03);
drops.name = 'droplets';
drops.renderOrder = 3;
scene.add(drops);

const hemi = new THREE.HemisphereLight(0x4a4f9a, 0x1a1222, 0.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 5, bottom: -5, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.target.position.set(0, 0.6, -1);
scene.add(sun, sun.target);

// 窓の外（街の灯り）から Clawd の背中と輪郭に当たる光
const rim = new THREE.SpotLight(0xc08cff, 5, 6, 0.6, 0.8, 2);
rim.position.set(0.0, 1.8, -3.5);
rim.target.position.set(SEAT.x, 0.8, SEAT.z);
scene.add(rim, rim.target);

const post = createPost(renderer, scene, camera);
const director = new Director(camera, renderer.domElement);
if (params.get('shot') && SHOTS[params.get('shot')]) director.fixed = params.get('shot');
const music = new MusicEngine();
const screens = new Screens(room.A);

// ---------------------------------------------------------------- 集中タイマー
let ui = null;
const focus = new FocusTimer({
  preset: store.get('focusPreset', '25/5'),
  onPhase(phase, prev) {
    const resting = phase === 'rest' || phase === 'long';
    anim.setResting(resting);
    if (phase === 'off') { music.setMode('work'); ui?.toast('集中タイマーを止めました'); return; }
    if (resting) {
      music.setMode('break');
      music.chime('break');
      if (prev === 'focus') { anim.cheer(); screens.onFocusDone(focus.done); screens.addDone(`集中 #${focus.done}`, 'focus'); }
      ui?.toast(phase === 'long' ? '長めの休憩です（15 分）' : 'ひと休みしましょう');
    } else {
      music.setMode('work');
      if (prev !== 'off') music.chime('focus');
      ui?.toast(`集中 ${focus.round} 回目、はじめます`);
    }
    ui?.focusChanged();
  },
});

// ---------------------------------------------------------------- 時間帯
const lightDir = new THREE.Vector3();
function applyEnv(e) {
  scene.fog.color.copy(e.fog);
  scene.fog.density = e.fogDensity;
  hemi.color.copy(e.hemiSky);
  hemi.groundColor.copy(e.hemiGround);
  hemi.intensity = e.hemi;
  lightDir.copy(e.sunDir).multiplyScalar(e.sun).addScaledVector(e.moonDir, 1 - e.sun);
  lightDir.y = Math.max(lightDir.y, 0.1);
  lightDir.normalize();
  sun.position.copy(sun.target.position).addScaledVector(lightDir, 16);
  sun.color.copy(e.winLight);
  sun.intensity = e.winLightI;
  rim.color.copy(e.skyHorizon).lerp(e.cove, 0.35);
  rim.intensity = 4 * e.cityGlow + 1.2 * e.sun;
  const A = room.A;
  A.deskSpot.intensity = 2.2 * e.pend;
  A.faceLight.intensity = 2.2 * (0.4 + 0.6 * e.pend);
  A.pendMat.color.setRGB(2.4, 2.0, 1.6).multiplyScalar(0.35 + 0.65 * e.pend);
  A.barLight.intensity = 0.8 * e.pend;
  A.cove1.color.copy(e.cove); A.cove2.color.copy(e.cove).lerp(new THREE.Color(0xb08cff), 0.5);
  A.cove1.intensity = A.cove2.intensity = 1.3 * e.coveI;
  A.coveMat.color.copy(e.cove).multiplyScalar(1.4 * e.coveI + 0.2);
  A.downMat.color.setRGB(1.4, 1.25, 1.05).multiplyScalar(e.down);
  A.boardLight.intensity = 0.7 * e.screen;
  for (const m of A.facadeMats) m.color.setRGB(0.55, 0.52, 0.6).multiplyScalar(0.6 + 0.8 * (1 - e.cityGlow) * e.sun + 0.4);
  renderer.toneMappingExposure = e.exposure;
  post.bloom.strength = e.bloom;
  scene.environmentIntensity = e.envI;
  drops.material.uniforms.uAmt.value = e.rain;
}

const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
// 反射用の環境マップ：部屋の真ん中から一度だけ撮る。
// 前の環境マップを使ったまま撮ると、映り込みが循環して値が壊れる（NaN）ので、撮るあいだは外す。
// 点の光（遠くの橋の灯りなど）は 1 画素に重なって極端に明るくなるので入れない。
function captureEnv() {
  const hidden = [clawd.root, glass, drops, ...Object.values(room.A.screens).map((s) => s.mesh), room.A.board.mesh];
  scene.traverse((o) => { if ((o.isPoints || o.isLine) && o.visible) hidden.push(o); });
  hidden.forEach((o) => { o.visible = false; });
  const old = envRT;
  scene.environment = null;
  envRT = pmrem.fromScene(scene, 0.015, 0.05, 12000, { size: 256, position: new THREE.Vector3(0, 1.3, -0.4) });
  scene.environment = envRT.texture;
  old?.dispose();
  hidden.forEach((o) => { o.visible = true; });
}

function setEnv(key, instant = false, dur = 4) {
  env.set(key, instant, dur);
  if (!VIDEO) store.set('env', key);
  music.setRain(key === 'rain');
}

// ---------------------------------------------------------------- UI
ui = createUI({
  music, env, director, store, focus,
  onEnv: (key) => setEnv(key),
  onStart: async () => { await music.play(); },
});
if (store.get('cam', 'auto') === 'free') director.setMode('free');
document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === director.mode));
if (params.has('clean') || VIDEO) { document.body.classList.add('clean'); document.body.classList.remove('intro'); document.getElementById('start').classList.add('hide'); }

// 動画モード：録画スクリプトが __video.begin() を呼ぶ。手で見るときは、クリックか Space で始まる
const video = VIDEO ? setupVideoMode({ minutes: VIDEO, music, setEnv, post, anim, director, focus, from: +params.get('from') || 0, track: +params.get('track') || 0 }) : null;
if (video) {
  window.__video = video;
  const go = (e) => { if (video.state.started) return; e.preventDefault(); e.stopImmediatePropagation(); video.begin(); };
  addEventListener('pointerdown', go, { capture: true });
  addEventListener('keydown', go, { capture: true });
}
music.setRain(env.key === 'rain');

// Clawd がキーを打った：画面の文字が進み、キーボードが光り、（有効なら）音が鳴る
anim.onKey = (side, big) => {
  screens.type(big);
  const kb = room.A.keyboards[side];
  if (kb) kb.flash = 1;
  music.keyClick(big ? 1.2 : 0.8 + Math.random() * 0.3, big);
};

// Clawd をクリック（ドラッグと区別する）
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.intersectObject(clawd.root, true).length) { anim.poke(); music.blip(); }
});

// 曲の切り替わり：前の曲が最後まで流れたらコミットする
let shownSong = null;
music.on((type) => {
  if (type !== 'audible' && type !== 'track') return;
  const s = music.song;
  if (type === 'audible' && shownSong && shownSong !== s && !shownSong.isBreak) screens.onSongEnd(shownSong);
  shownSong = s;
});

// ---------------------------------------------------------------- ループ
let T = 0;
let info = music.info();
let fake = null; // 撮影用：音を鳴らさずに拍だけ進める
let drawT = 0, boardT = 0;
let lastSec = null;
function fakeInfo() {
  const song = fake.brk ? music.breakSongFor(fake.track ?? 0) : music.songFor(fake.track ?? 0);
  const step = (fake.t0 + T - fake.start) * (song.bpm / 60) * 4;
  const bar = Math.max(0, Math.min(song.bars.length - 1, Math.floor(step / 16)));
  const b = song.bars[bar];
  const sec = song.sections[b.section];
  return {
    state: 'playing', mode: fake.brk ? 'break' : 'work', playing: true, song, step, beat: step / 4, bar, section: sec, sectionIndex: b.section, chord: b.chords[0].sym,
    energy: fake.energy ?? sec.energy, kick: Math.exp(-((step % 4) * (60 / song.bpm / 4)) * 9), kimeAge: 99,
    levelL: 0.12 + 0.05 * Math.sin(T * 7), levelR: 0.12 + 0.05 * Math.cos(T * 6), level: 0.12, time: step * 15 / song.bpm, duration: 360,
  };
}

const nixieDigits = [0, 0, 0, 0];
function updateNixie(fv) {
  const N = room.A.nixie;
  let digits, colon;
  if (fv.active) { digits = [Math.floor(fv.mm / 10) % 10, fv.mm % 10, Math.floor(fv.ss / 10), fv.ss % 10]; colon = !fv.running || fv.ss % 2 === 0 || true; }
  else { const d = new Date(); digits = [Math.floor(d.getHours() / 10), d.getHours() % 10, Math.floor(d.getMinutes() / 10), d.getMinutes() % 10]; colon = d.getSeconds() % 2 === 0; }
  digits.forEach((d, i) => { if (nixieDigits[i] !== d) { nixieDigits[i] = d; N.tubes[i].map = N.digitTex[d]; N.tubes[i].needsUpdate = true; } });
  const blink = fv.active && !fv.running ? Math.floor(T * 2) % 2 : 1;
  for (const m of N.tubes) m.color.setRGB(2.2, 1.2, 0.5).multiplyScalar(0.5 + 0.5 * blink);
  N.dots.forEach((d) => { d.visible = colon; });
  N.light.intensity = 0.06 * (0.5 + 0.5 * blink);
}

function step(dt) {
  T += dt;
  info = fake ? fakeInfo() : music.info();
  const fv = focus.view();
  env.update(dt);
  applyEnv(env.cur);
  if (env.changed && env.t >= 1 && rendered > 2) { env.changed = false; captureEnv(); }
  // セクションが変わったら、ターミナルでテストやビルドを走らせる
  const secKey = info.playing ? `${info.song?.seed}:${info.sectionIndex}` : null;
  if (secKey !== lastSec) { if (secKey && !info.song.isBreak) screens.onSection(info.section.type, info.song); lastSec = secKey; }
  director.update(dt, T, info, { resting: anim.resting });
  anim.update(dt, { music: info, camera });
  // 椅子は Clawd と一緒に回る
  room.A.chair.swivel.rotation.y = anim.cur.turn;
  const printProgress = fv.active ? (fv.phase === 'focus' ? fv.progress : 1) : ((T / 480) % 1.12);
  room.update(dt, T, info, env.cur, { printProgress: Math.min(1, printProgress) });
  city.update(dt, T, env.cur, camera);
  drops.material.uniforms.uTime.value = T;
  screens.update(dt);
  drawT += dt; boardT += dt;
  if (drawT > 1 / 12) { drawT = 0; screens.draw({ music: info, spectrum: fake ? null : music.spectrum(), focus: fv, env: env.cur }); updateNixie(fv); }
  if (boardT > 0.5) { boardT = 0; screens.drawBoard(fv); }
  ui.update(info, T, fv);
  video?.update();
}

const dbg = {
  noPost: false,
  captureEnv: () => captureEnv(),
  /** 環境マップの中身に NaN / Inf がないか数える（デバッグ用） */
  scanEnv() {
    const rt = envRT; const w = rt.width, h = rt.height;
    const buf = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    let nan = 0, inf = 0, max = 0;
    for (const v of buf) { const e = (v >> 10) & 31; if (e === 31) { if (v & 1023) nan++; else inf++; } else max = Math.max(max, THREE.DataUtils.fromHalfFloat(v)); }
    return { w, h, nan, inf, max };
  },
};
let rendered = 0; // 最初の数コマを描くまで環境マップを撮らない（影のマップが空のまま撮ると値が壊れる）
function render() {
  rendered++;
  if (dbg.noPost) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  else post.render(T);
}

function resize(w = innerWidth, h = innerHeight) {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  post.setSize(w, h);
}
addEventListener('resize', () => resize());
resize();

// 重いときは解像度を少し下げる
let slow = 0;
function adapt(dt) {
  if (dt > 0.024) slow += dt; else slow = Math.max(0, slow - dt * 0.5);
  if (slow > 2 && pixelRatio > 0.8) {
    pixelRatio = Math.max(0.75, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slow = 0;
  }
}

const dev = installDevHarness({
  renderer, scene, camera,
  step: (dt) => step(dt),
  render,
  resize: (w, h) => resize(w, h),
  state: () => ({ env: env.key, cam: director.mode, shot: director.fixed || director.shot, clawd: anim.state, track: music.trackIndex, mode: music.mode, playing: !!info.playing, section: info.section?.label, chord: info.chord, focus: focus.view().clock, phase: focus.phase }),
  goto: (name, opts = {}) => {
    if (PRESETS[name]) { setEnv(name, true); applyEnv(env.cur); render(); captureEnv(); env.changed = false; }
    if (SHOTS[name]) { director.fixed = name; director.cut(name, opts.at ?? 6); }
    return dev.state();
  },
  extra: {
    music, anim, env, director, clawd, room, city, dbg, screens, focus, glass,
    /** 音なしで拍だけ進める（撮影用）。{ track, energy, t0, brk } */
    fakeMusic(o = {}) { fake = { track: 0, t0: 30, ...o, start: T }; document.getElementById('start').classList.add('hide'); document.body.classList.remove('intro'); return true; },
    stopFake() { fake = null; },
    poke() { anim.poke(); },
    /** 集中タイマーを sec 秒進める（確認用） */
    skipAhead(sec) { focus.offset += sec * 1000; focus.update(); return focus.view(); },
  },
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!dev?.paused) { step(dt); if (!VIDEO) adapt(dt); }
  render();
  requestAnimationFrame(frame);
}
applyEnv(env.cur);
step(0);
render();
dev?.markReady();
requestAnimationFrame(frame);
