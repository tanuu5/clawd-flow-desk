// devHarness.js — window.__dev：開発・撮影用フックの共通の約束事（dev-harness スキル v1）
//
// 作品ごとに __game / __dbg / __shot … とばらばらだった開発用フックを、1つの形にそろえる。
// 撮影スクリプト（このスキルの shoot.mjs、readme-showcase、motion-reel、game-jikkyo）は
// window.__dev があればそれを使うので、作品ごとの撮影ドライバーを短く書ける。
//
//   import { installDevHarness } from './dev/devHarness.js';
//   const dev = installDevHarness({
//     renderer, scene, camera,               // camera / scene は関数でもよい（切り替わる作品向け）
//     step: (dt) => game.step(dt),           // 描画せずに dt だけ進める（必須）
//     render: () => game.render(),           // ポストエフェクトがあるならその描画（省略時 renderer.render）
//     resize: (w, h) => game.resize(w, h),   // composer があるなら必須（省略時 renderer＋camera だけ）
//     state: () => ({ mode: game.mode, score: game.score }),  // JSON にできる値だけ
//     input: { down, up, tap },              // 任意：キー名（KeyboardEvent.code）で操作
//     goto: (name, opts) => game.goto(name, opts), // 任意：場面・ステージへ飛ぶ（opts で日・時刻・ステージなど）
//   });
//   // ループ側：一時停止中は進めない（描画は続けてよい）
//   function frame() { if (!dev?.paused) game.step(dt); game.render(); requestAnimationFrame(frame); }
//   // 読み込みが終わり、最初の1コマを描いたら
//   dev?.markReady();
//
// 有効になる条件：Vite の開発サーバー（import.meta.env.DEV）か、URL に ?dev が付いているとき。
// それ以外では何もせず null を返すので、本番の動作は変わらない。

export const DEV_HARNESS_VERSION = 1;

export function devEnabled() {
  let viteDev = false;
  try { viteDev = !!import.meta.env?.DEV; } catch { /* Vite 以外 */ }
  return viteDev || new URLSearchParams(location.search).has('dev');
}

export function installDevHarness(opts) {
  const enabled = opts.enabled ?? devEnabled();
  if (!enabled) return null;

  const get = (v) => (typeof v === 'function' ? v() : v);
  const renderer = opts.renderer;
  const scene = () => get(opts.scene);
  const camera = () => get(opts.camera);
  const render = opts.render || (() => renderer.render(scene(), camera()));

  function resize(w, h) {
    if (opts.resize) return opts.resize(w, h);
    renderer.setSize(w, h, false);
    const cam = camera();
    if (cam?.isPerspectiveCamera) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }

  const dev = {
    version: DEV_HARNESS_VERSION,
    ready: false,
    paused: false,
    frames: 0,      // advance() で進めたコマ数の合計
    time: 0,        // advance() で進めた秒数の合計

    markReady() { dev.ready = true; },
    pause(on = true) { dev.paused = !!on; return dev.paused; },

    /** 一時停止してから sec 秒ぶんを dt 刻みで進め、最後に1回だけ描く。 */
    advance(sec, dt = 1 / 60) {
      dev.paused = true;
      const n = Math.max(0, Math.round(sec / dt));
      for (let i = 0; i < n; i++) opts.step(dt);
      dev.frames += n;
      dev.time += n * dt;
      render();
      return n;
    },

    render() { render(); },

    /**
     * キャンバスだけを画像にする（HTML の UI は写らない。UI ごと撮るならページのスクリーンショット）。
     * w, h を渡すとその大きさで描き直してから撮り、元に戻す。
     */
    snapshot({ w, h, type = 'image/png', quality = 0.92 } = {}) {
      const canvas = renderer.domElement;
      const resized = w && h;
      let prev;
      if (resized) {
        prev = { pr: renderer.getPixelRatio(), w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight };
        renderer.setPixelRatio(1);
        resize(w, h);
      }
      render();
      const url = canvas.toDataURL(type, quality);
      if (resized) {
        renderer.setPixelRatio(prev.pr);
        resize(prev.w, prev.h);
        render();
      }
      return url;
    },

    /** snapshot() を開発サーバーの /__shot に送り、プロジェクトの shots/ に保存する。保存先を返す。 */
    async shot(name = 'shot', o = {}) {
      const url = dev.snapshot(o);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
      if (!r.ok) throw new Error('/__shot に保存できません（vite-plugin-dev-shot か dev-server.mjs で開いていますか）: ' + r.status);
      return r.text();
    },

    /** 作品の状態（JSON にできる値）。 */
    state() { return opts.state ? opts.state() : {}; },

    /** 描画の統計と状態をまとめて返す（確認ログ用）。 */
    info() {
      const i = renderer.info;
      return {
        version: DEV_HARNESS_VERSION,
        ready: dev.ready, paused: dev.paused, frames: dev.frames, time: +dev.time.toFixed(4),
        tris: i.render.triangles, calls: i.render.calls,
        geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0,
        size: [renderer.domElement.width, renderer.domElement.height], pixelRatio: renderer.getPixelRatio(),
        state: dev.state(),
      };
    },

    /** カメラを置く。controls（OrbitControls など）を渡してあれば注視点も合わせる。 */
    look({ pos, target, fov } = {}) {
      const cam = camera();
      if (pos) cam.position.set(...pos);
      if (fov && cam.isPerspectiveCamera) { cam.fov = fov; cam.updateProjectionMatrix(); }
      if (target) {
        if (opts.controls) { opts.controls.target.set(...target); opts.controls.update(); }
        else cam.lookAt(...target);
      }
      render();
      return { pos: cam.position.toArray(), fov: cam.fov };
    },

    /** シーンの中の頂点・行列に NaN / Infinity がないか調べる。見つかったものの一覧を返す。 */
    checkNaN(root = scene()) {
      const bad = [];
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.matrixWorld.elements.every(Number.isFinite)) bad.push({ path: pathOf(o, root), what: 'matrixWorld' });
        const g = o.geometry;
        if (!g?.attributes) return;
        for (const [key, attr] of Object.entries(g.attributes)) {
          const a = attr.array;
          if (!a) continue;
          for (let k = 0; k < a.length; k++) {
            if (!Number.isFinite(a[k])) { bad.push({ path: pathOf(o, root), what: key, index: Math.floor(k / attr.itemSize) }); break; }
          }
        }
      });
      return bad;
    },

    /** 部品の一覧（名前のパス、種類、表示中か）。NaN の犯人探しや見た目の確認に使う。 */
    parts(root = scene(), depth = 4) {
      const out = [];
      const walk = (o, d) => {
        if (o !== root) out.push({ path: pathOf(o, root), type: o.type, visible: o.visible });
        if (d < depth) o.children.forEach((c) => walk(c, d + 1));
      };
      walk(root, 0);
      return out;
    },

    /** parts() のパス（または名前）で部品を表示・非表示にする。 */
    setVisible(path, on, root = scene()) {
      const o = findByPath(root, path);
      if (!o) throw new Error('見つかりません: ' + path);
      o.visible = !!on;
      render();
      return o.visible;
    },

    /** コンソールから直接さわる用（撮影スクリプトでは使わず、上の操作を使う）。 */
    scene,
    camera,

    input: opts.input || null,
    goto: opts.goto || null,
  };

  Object.assign(dev, opts.extra || {});
  window.__dev = dev;
  return dev;
}

/** root から o までの名前のパス（名前がなければ 種類#番号）。 */
export function pathOf(o, root) {
  const names = [];
  for (let p = o; p && p !== root; p = p.parent) {
    const i = p.parent ? p.parent.children.indexOf(p) : 0;
    names.unshift(p.name || `${p.type}#${i}`);
  }
  return names.join('/');
}

function findByPath(root, path) {
  let hit = null;
  root.traverse((o) => { if (!hit && (pathOf(o, root) === path || (o.name && o.name === path))) hit = o; });
  return hit;
}
