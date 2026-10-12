// viewer.js — どの作品でも使えるモデル確認台（dev-harness スキル）
//
// 作品ごとに違うところ（モデルの作り方・動き・表情・切り替え）は dev/models/*.js のアダプターに書く。
// 書き方は references/viewer.md。URL で最初の状態を決められる：
//   viewer.html?m=<アダプター名>&mode=run&view=q3&ref=over&light=flat&clean=1
// window.__dev（devHarness.js）に加えて、確認台だけの操作も __dev に生やす：
//   setModel / setMode / setView / toggle / action / refMode / sheet / compare

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { installDevHarness, pathOf } from './devHarness.js';
import MODELS from './models/index.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const stage = $('stage');

// ---------- 描画の土台 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(25, 1, 0.01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

// 照明：studio（環境光＋キー＋リム、影あり）と flat（色だけを見る。パレットと見比べる用）
const lights = new THREE.Group();
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1);
const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
const rim = new THREE.DirectionalLight(0xdfe8ff, 1.2);
lights.add(hemi, key, key.target, rim);
scene.add(lights);
// π にすると、拡散色がそのまま画面の色になる（トーンマッピングも外す）
const flatLight = new THREE.AmbientLight(0xffffff, Math.PI);
// night：夜の場面を想定した照明（青い弱い環境光＋手前上の暖色の点光源）。白い服や肌の色が夜にどう見えるかを確かめる
const nightLights = new THREE.Group();
const nightHemi = new THREE.HemisphereLight(0x6a7fa8, 0x14161c, 0.35);
const nightLamp = new THREE.PointLight(0xffb36b, 30, 0, 2);
nightLamp.castShadow = true;
nightLights.add(nightHemi, nightLamp);
let workLights = null; // アダプターの lights() が返したもの（light: work）
const LIGHTS = ['studio', 'flat', 'night', 'work'];

const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(1, 10, 0x000000, 0x000000);
grid.material.transparent = true;
grid.material.opacity = 0.15;
const axes = new THREE.AxesHelper(1);
const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xff3366);
scene.add(grid, axes, boxHelper);

// ---------- 状態 ----------
const S = {
  modelName: null, adapter: null, model: null,
  mode: null, view: 'front', speed: 1, time: 0,
  toggles: {}, wire: false, grid: false, axes: false, bbox: false,
  light: q.get('light') || 'studio', bg: q.get('bg') || null,
  ref: q.get('ref') || 'off', refOpacity: 0.5, refs: {}, dropped: {},
  box: new THREE.Box3(), views: {},
};
let dev;

// ---------- モデルの読み込み ----------
async function setModel(name) {
  const loader = MODELS[name];
  if (!loader) throw new Error('アダプターがありません: ' + name + '（dev/models/index.js に登録）');
  if (S.model) {
    scene.remove(S.model.root);
    S.model.dispose?.();
  }
  const mod = await loader();
  const A = mod.default || mod;
  S.adapter = A;
  S.modelName = name;
  S.toggles = Object.fromEntries(Object.entries(A.toggles || {}).map(([k, t]) => [k, !!t.on]));
  const modes = modeNames();
  S.mode = q.get('mode') && modes.includes(q.get('mode')) ? q.get('mode') : modes[0] || null;
  S.refs = { ...(A.refs || {}) };
  S.time = 0;
  scene.environment = A.environment === false ? null : envTex;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  A.setup?.({ THREE, renderer, scene, camera });
  S.toneMapping = renderer.toneMapping;
  S.model = await A.create({ THREE, renderer, scene, camera });
  scene.add(S.model.root);
  if (workLights) { scene.remove(workLights); workLights = null; }
  if (A.lights) { workLights = A.lights({ THREE, scene, model: S.model }); workLights.visible = false; scene.add(workLights); }
  S.model.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = o.receiveShadow || false; } });
  for (const [k, on] of Object.entries(S.toggles)) A.toggles[k].set?.(S.model, on);
  updateModel(0);
  fitToModel();
  setView(S.views[q.get('view')] ? q.get('view') : S.view in S.views ? S.view : 'front');
  buildUI();
  buildParts();
  document.title = `${A.title || name} — Model Viewer (dev)`;
}

function modeNames() {
  const m = S.adapter?.modes;
  return Array.isArray(m) ? m : Object.keys(m || {});
}
function modeParams() {
  const m = S.adapter?.modes;
  return m && !Array.isArray(m) ? m[S.mode] || {} : {};
}

function updateModel(dt) {
  S.time += dt;
  S.model?.update?.(dt, { mode: S.mode, params: modeParams(), time: S.time, toggles: S.toggles });
}

// 大きさから、どのモデルでも使えるカメラ位置を作る（モデルは +Z を向いている前提）
function fitToModel() {
  S.box.setFromObject(S.model.root);
  const size = S.box.getSize(new THREE.Vector3());
  const c = S.box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, size.x * 0.8, size.z * 0.8, 1e-3);
  const fov = 25;
  const d = (h * 0.72) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const at = (yawDeg, pitchDeg, dist = d) => {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const p = THREE.MathUtils.degToRad(pitchDeg);
    return { pos: [c.x + Math.sin(yaw) * Math.cos(p) * dist, c.y + Math.sin(p) * dist, c.z + Math.cos(yaw) * Math.cos(p) * dist], target: c.toArray(), fov };
  };
  S.views = {
    front: at(0, 0), q3: at(35, 8), side: at(90, 0), back: at(180, 4),
    top: at(0, 82), low: at(15, -18), ...(S.adapter.views || {}),
  };
  const r = Math.max(size.x, size.z, size.y) * 1.6;
  ground.scale.setScalar(r * 3);
  ground.position.set(c.x, S.box.min.y + 0.0005, c.z);
  grid.scale.setScalar(r * 2);
  grid.position.copy(ground.position);
  axes.scale.setScalar(h * 0.5);
  key.position.set(c.x + h * 1.6, c.y + h * 4.5, c.z + h * 2.4);
  key.target.position.copy(c);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -r * 1.5; sc.right = sc.top = r * 1.5; sc.near = 0.01; sc.far = h * 10;
  sc.updateProjectionMatrix();
  rim.position.set(c.x - h * 2, c.y + h * 1.5, c.z - h * 3);
  camera.near = h / 200; camera.far = h * 60;
}

function setView(name) {
  const v = S.views[name];
  if (!v) throw new Error('カメラ位置がありません: ' + name);
  S.view = name;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  camera.fov = v.fov || 25;
  camera.updateProjectionMatrix();
  controls.update();
  applyRef();
  buildUI();
}

// ---------- 表示の切り替え ----------
function applyDisplay() {
  grid.visible = S.grid;
  axes.visible = S.axes;
  boxHelper.visible = S.bbox;
  if (S.bbox && S.model) boxHelper.box.setFromObject(S.model.root);
  if (S.light === 'work' && !S.adapter?.lights) S.light = 'studio';
  const flat = S.light === 'flat';
  lights.visible = S.light === 'studio';
  ground.visible = !flat;
  if (flat) scene.add(flatLight); else scene.remove(flatLight);
  if (S.light === 'night') {
    const c = S.box.getCenter(new THREE.Vector3());
    const h = S.box.getSize(new THREE.Vector3()).y || 1;
    nightLamp.position.set(c.x + h * 0.5, c.y + h * 0.9, c.z + h * 0.9);
    nightLamp.distance = h * 8;
    scene.add(nightLights);
  } else scene.remove(nightLights);
  if (workLights) workLights.visible = S.light === 'work';
  renderer.toneMapping = flat ? THREE.NoToneMapping : S.toneMapping;
  scene.environment = S.light !== 'studio' || S.adapter?.environment === false ? null : envTex;
  const bg = S.bg || (S.light === 'night' ? '#0d0f14' : S.light === 'work' && S.adapter?.lightsBackground) || S.adapter?.background || '#afafb4';
  document.documentElement.style.setProperty('--bg', bg);
  scene.background = new THREE.Color(bg);
  S.model?.root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m && 'wireframe' in m) m.wireframe = S.wire;
  });
}

// 参照画像：off / over（半透明で重ねる）/ diff（差の絶対値。輪郭合わせ）/ side（横に並べる）
function refURL() { return S.dropped[S.view] || S.refs[S.view] || null; }
function applyRef() {
  const url = refURL();
  const over = $('refover');
  const css = url ? `url("${url}")` : 'none';
  over.style.backgroundImage = css;
  $('refside').style.backgroundImage = css;
  over.className = url && (S.ref === 'over' || S.ref === 'diff') ? S.ref : '';
  over.style.opacity = S.refOpacity;
  stage.classList.toggle('side', !!url && S.ref === 'side');
  onResize();
}

// ---------- 画面の UI ----------
function btn(row, label, on, fn, title) {
  const b = document.createElement('button');
  b.textContent = label;
  if (on) b.classList.add('on');
  if (title) b.title = title;
  b.onclick = () => { fn(); buildUI(); };
  row.appendChild(b);
  return b;
}
function row(label) {
  const r = document.createElement('div');
  r.className = 'row';
  if (label) { const b = document.createElement('b'); b.textContent = label; r.appendChild(b); }
  $('ui').appendChild(r);
  return r;
}
function buildUI() {
  const ui = $('ui');
  ui.innerHTML = '';
  if (!S.adapter) return;
  const names = Object.keys(MODELS);
  if (names.length > 1) { const r = row('model'); for (const n of names) btn(r, n, n === S.modelName, () => setModel(n)); }
  const modes = modeNames();
  if (modes.length) { const r = row('mode'); for (const m of modes) btn(r, m, m === S.mode, () => { S.mode = m; }); }
  { const r = row('view'); for (const v of Object.keys(S.views)) btn(r, v, v === S.view, () => setView(v)); }
  const toggles = Object.entries(S.adapter.toggles || {});
  const actions = Object.entries(S.adapter.actions || {});
  if (toggles.length || actions.length) {
    const r = row('opts');
    for (const [k] of toggles) btn(r, k, S.toggles[k], () => toggle(k));
    for (const [k, fn] of actions) btn(r, '▶ ' + k, false, () => fn(S.model, { THREE, scene }));
  }
  {
    const r = row('show');
    btn(r, dev.paused ? '▶ 再生' : '⏸ 停止', dev.paused, () => dev.pause(!dev.paused), 'スペースキー');
    btn(r, '+1 コマ', false, () => dev.advance(1 / 60), '→ キー');
    btn(r, '×¼', S.speed < 1, () => { S.speed = S.speed < 1 ? 1 : 0.25; });
    btn(r, 'wire', S.wire, () => { S.wire = !S.wire; applyDisplay(); });
    btn(r, 'grid', S.grid, () => { S.grid = !S.grid; applyDisplay(); });
    btn(r, 'axes', S.axes, () => { S.axes = !S.axes; applyDisplay(); });
    btn(r, 'bbox', S.bbox, () => { S.bbox = !S.bbox; applyDisplay(); });
    const avail = LIGHTS.filter((l) => l !== 'work' || S.adapter?.lights);
    btn(r, 'light: ' + S.light, S.light !== 'studio', () => { S.light = avail[(avail.indexOf(S.light) + 1) % avail.length]; applyDisplay(); }, 'studio → flat（色だけ）→ night（夜）→ work（作品の照明。アダプターの lights）');
    for (const c of ['#afafb4', '#ffffff', '#202024']) btn(r, '■', (S.bg || '#afafb4') === c, () => { S.bg = c; applyDisplay(); }).style.color = c;
  }
  {
    const r = row('ref');
    for (const m of ['off', 'over', 'diff', 'side']) btn(r, m, S.ref === m, () => { S.ref = m; applyRef(); });
    const s = document.createElement('input');
    Object.assign(s, { type: 'range', min: 0, max: 1, step: 0.05, value: S.refOpacity });
    s.oninput = () => { S.refOpacity = +s.value; applyRef(); };
    r.appendChild(s);
    const note = document.createElement('span');
    note.textContent = refURL() ? '' : '（この view の参照画像なし：画像をドロップ）';
    r.appendChild(note);
  }
}

// 部品の一覧（チェックで表示・非表示）。NaN の犯人探しは「半分ずつ消す」が速い
function buildParts() {
  const box = $('parts');
  box.innerHTML = '';
  const walk = (o, depth) => {
    if (depth > 6) return;
    for (const c of o.children) {
      const l = document.createElement('label');
      l.style.paddingLeft = depth * 10 + 'px';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.visible;
      cb.onchange = () => { c.visible = cb.checked; };
      l.append(cb, ' ' + (c.name || c.type));
      l.dataset.uuid = c.uuid;
      box.appendChild(l);
      walk(c, depth + 1);
    }
  };
  walk(S.model.root, 0);
}

function runNaNCheck() {
  const bad = dev.checkNaN(S.model.root);
  $('nan').textContent = bad.length ? `NaN / Infinity が ${bad.length} 件:\n` + bad.slice(0, 30).map((b) => `${b.path} … ${b.what}${b.index != null ? '[' + b.index + ']' : ''}`).join('\n') : 'NaN なし（頂点と行列）';
  return bad;
}

// クリック（ドラッグではなく）で部品の名前を出す
const ray = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !S.model) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  let hit;
  try { hit = ray.intersectObject(S.model.root, true).find((h) => h.object.visible); }
  catch (err) { $('nan').textContent = 'クリック判定に失敗（NaN が入っていると起きる。NaN チェックを）: ' + err.message; return; }
  document.querySelectorAll('#parts label.hit').forEach((l) => l.classList.remove('hit'));
  if (!hit) return;
  $('nan').textContent = `クリック: ${pathOf(hit.object, S.model.root)}\n材質: ${[].concat(hit.object.material).map((m) => m.name || m.type).join(', ')}`;
  const l = document.querySelector(`#parts label[data-uuid="${hit.object.uuid}"]`);
  if (l) { l.classList.add('hit'); l.scrollIntoView({ block: 'nearest' }); }
});

$('nanbtn').onclick = runNaNCheck;
$('allon').onclick = () => { S.model.root.traverse((o) => { o.visible = true; }); buildParts(); };
$('hidebtn').onclick = () => document.body.classList.toggle('clean');
if (q.get('clean')) document.body.classList.add('clean');

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { dev.pause(!dev.paused); buildUI(); e.preventDefault(); }
  else if (e.code === 'ArrowRight') dev.advance(1 / 60);
  else if (e.code === 'KeyH') document.body.classList.toggle('clean');
  else if (/^Digit[1-9]$/.test(e.code)) { const v = Object.keys(S.views)[+e.code.slice(5) - 1]; if (v) setView(v); }
});

// 参照画像のドロップ：今の view の参照にする（ページを開き直すと消える。残すならアダプターの refs に書く）
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = e.dataTransfer.files[0];
  if (!f || !f.type.startsWith('image/')) return;
  S.dropped[S.view] = URL.createObjectURL(f);
  if (S.ref === 'off') S.ref = 'over';
  applyRef();
  buildUI();
});

// ---------- 大きさとループ ----------
function viewSize() {
  const side = stage.classList.contains('side');
  return [Math.max(1, Math.floor(side ? innerWidth / 2 : innerWidth)), innerHeight];
}
function onResize() {
  const [w, h] = viewSize();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.model && !dev.paused) updateModel(dt * S.speed);
  controls.update();
  if (S.bbox && S.model) boxHelper.box.setFromObject(S.model.root);
  renderer.render(scene, camera);
  const i = renderer.info.render;
  $('info').textContent = `${S.modelName}  mode=${S.mode}  view=${S.view}  t=${S.time.toFixed(2)}s  tris=${i.triangles}  calls=${i.calls}${dev.paused ? '  ⏸' : ''}`;
  requestAnimationFrame(frame);
}

// ---------- 撮影用の操作（__dev に足す） ----------
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
function drawContain(ctx, im, x, y, w, h) {
  const s = Math.min(w / im.width, h / im.height);
  ctx.drawImage(im, x + (w - im.width * s) / 2, y + (h - im.height * s) / 2, im.width * s, im.height * s);
}
function label(ctx, text, x, y) {
  ctx.font = '600 15px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = '#000a';
  ctx.fillRect(x + 6, y + 6, w, 22);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x + 12, y + 22);
}

/** いくつもの mode × view を1枚の一覧にする。refs: true なら参照画像を隣に並べる。dataURL を返す。 */
// settle：mode を切り替えたあと、姿勢がなじむまで進める秒数（なめらかに切り替わるアニメーター向け）
async function sheet({ views = ['front', 'q3', 'side', 'back'], modes = [S.mode], w = 360, h = 480, cols, refs = false, settle = 0.5 } = {}) {
  const keep = { mode: S.mode, view: S.view, paused: dev.paused };
  const cells = [];
  for (const m of modes) {
    const changed = m != null && m !== S.mode;
    if (m != null) S.mode = m;
    if (changed && settle) dev.advance(settle);
    else { updateModel(0); dev.paused = true; }
    for (const v of views) {
      setView(v);
      cells.push({ label: `${m ?? ''} ${v}`.trim(), url: dev.snapshot({ w, h }) });
      const r = refURL();
      if (refs && r) cells.push({ label: `ref ${v}`, url: r, ref: true });
    }
  }
  // 既定は「1 行に 1 つの mode」（参照画像を並べるときはその分だけ広げる）
  const n = cols || Math.min(cells.length, Math.ceil(cells.length / modes.length));
  const rows = Math.ceil(cells.length / n);
  const cv = document.createElement('canvas');
  cv.width = n * w;
  cv.height = rows * h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let k = 0; k < cells.length; k++) {
    const x = (k % n) * w;
    const y = Math.floor(k / n) * h;
    drawContain(ctx, await loadImage(cells[k].url), x, y, w, h);
    label(ctx, cells[k].label, x, y);
  }
  S.mode = keep.mode;
  dev.paused = keep.paused;
  setView(keep.view);
  return cv.toDataURL('image/png');
}

/** 今の view の参照画像と、同じ大きさのレンダーを左右に並べる。dataURL を返す。 */
async function compare({ view = S.view, w = 540, h = 720 } = {}) {
  setView(view);
  const r = refURL();
  if (!r) throw new Error('この view の参照画像がありません: ' + view);
  const ref = await loadImage(r);
  const shot = await loadImage(dev.snapshot({ w, h }));
  const cv = document.createElement('canvas');
  cv.width = w * 2;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  drawContain(ctx, ref, 0, 0, w, h);
  drawContain(ctx, shot, w, 0, w, h);
  label(ctx, 'ref ' + view, 0, 0);
  label(ctx, 'model ' + view, w, 0);
  return cv.toDataURL('image/png');
}

function toggle(k, on) {
  S.toggles[k] = on ?? !S.toggles[k];
  S.adapter.toggles[k].set?.(S.model, S.toggles[k]);
  return S.toggles[k];
}

dev = installDevHarness({
  enabled: true, // 確認台そのものが開発用なので常に有効
  renderer, scene, camera, controls,
  step: (dt) => updateModel(dt),
  resize: (w, h) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
  state: () => ({ model: S.modelName, mode: S.mode, view: S.view, time: +S.time.toFixed(4), toggles: S.toggles, ref: S.ref, light: S.light }),
  extra: {
    viewer: true,
    models: () => Object.keys(MODELS),
    modes: () => modeNames(),
    views: () => Object.keys(S.views),
    setModel: async (n) => { dev.ready = false; await setModel(n); applyDisplay(); dev.ready = true; return n; },
    setMode: (m) => { S.mode = m; updateModel(0); buildUI(); dev.render(); return m; },
    setView: (v) => { setView(v); dev.render(); return v; },
    toggle: (k, on) => { const v = toggle(k, on); buildUI(); return v; },
    action: (k) => S.adapter.actions[k](S.model, { THREE, scene }),
    refMode: (m) => { S.ref = m; applyRef(); buildUI(); return m; },
    light: (m) => { S.light = m; applyDisplay(); buildUI(); return m; },
    nan: () => runNaNCheck(),
    sheet, compare,
  },
});

onResize();
await setModel(q.get('m') && MODELS[q.get('m')] ? q.get('m') : Object.keys(MODELS)[0]);
applyDisplay();
if (q.get('pause')) dev.pause(true);
requestAnimationFrame((t) => { last = t; frame(t); dev.markReady(); });
