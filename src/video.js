// video.js — 動画モード（?video=<分>）。作業用 BGM 動画を録るためのもの。
//
// UI を出さずに自動で再生し、時間帯を「夕暮れ → 夜 → 雨の夜 → 夜明け」と移していく。
// 曲名やタイトルは、録画に写るようにキャンバスの中（仕上げのパス）で重ねる。
// 指定の長さが近づいたら、今の曲の終わりで止め、Clawd が眠ってから暗転する。
// 録画は MediaRecorder（H.264 / AAC の MP4）で行い、開発サーバーの /__append に少しずつ書き足す。

import * as THREE from 'three';
import { JP_FONT, SCRIPT_FONT } from './scene/textures.js';

const SCHEDULE = [[0, 'day'], [0.3, 'sunset'], [0.55, 'night'], [0.8, 'rain']];
const TITLE_HOLD = 9;

// from / track：途中から録るとき（録画が途切れた続きを録ってつなぐ）。from 秒の時点から、track 曲目を頭から流す
export function setupVideoMode({ minutes, music, setEnv, post, anim, director, focus, from = 0, track = 0 }) {
  const total = minutes * 60;
  const W = 1920, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  post.film.uniforms.tOverlay.value = tex;
  post.film.uniforms.uGrain.value = 0.022; // 動画の圧縮で粒がつぶれて濁らないよう、少し控えめに

  const state = {
    ready: true, started: false, done: false, t0: 0, t: 0, phase: -1, frames: 0,
    log: [], ending: null, overlay: null, recorder: null, chain: null, recName: null,
  };

  const now = () => (performance.now() - state.t0) / 1000;

  function clear() { g.clearRect(0, 0, W, H); }

  function drawTitle() {
    clear();
    const grd = g.createLinearGradient(0, H * 0.45, 0, H);
    grd.addColorStop(0, 'rgba(8,4,18,0)'); grd.addColorStop(1, 'rgba(8,4,18,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `150px ${SCRIPT_FONT}`;
    const tg = g.createLinearGradient(120, 0, 1050, 0);
    tg.addColorStop(0, '#ffd0a0'); tg.addColorStop(0.55, '#ff7ab8'); tg.addColorStop(1, '#c08cff');
    g.shadowColor = 'rgba(255,95,162,0.7)'; g.shadowBlur = 40;
    g.fillStyle = tg;
    g.fillText('City Pop Lounge', 120, 820);
    g.shadowBlur = 12; g.shadowColor = 'rgba(0,0,0,0.6)';
    g.fillStyle = 'rgba(255,245,251,0.95)';
    g.font = `500 44px ${JP_FONT}`;
    g.fillText('Clawd の部屋 · 47F — 作業用 BGM ' + minutes + ' 分', 128, 900);
    g.fillStyle = 'rgba(255,240,250,0.72)';
    g.font = `400 30px ${JP_FONT}`;
    g.fillText('曲はすべてコードがその場で作曲・演奏しています', 130, 958);
    g.shadowBlur = 0;
    tex.needsUpdate = true;
  }

  function drawCaption(song) {
    clear();
    const x = 96, y = H - 150;
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 18;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#ff7ab8';
    g.font = `700 26px ${JP_FONT}`;
    g.fillText(`NOW PLAYING  ·  No.${String(song.no).padStart(2, '0')}`, x, y);
    g.fillStyle = 'rgba(255,245,251,0.97)';
    g.font = `700 58px ${JP_FONT}`;
    g.fillText(song.title, x, y + 66);
    g.fillStyle = 'rgba(255,240,250,0.8)';
    g.font = `500 30px ${JP_FONT}`;
    g.fillText(`${song.titleJa} — The Skyline Pincers`, x, y + 112);
    g.shadowBlur = 0;
    tex.needsUpdate = true;
  }

  function show(kind, song) {
    if (kind === 'title') drawTitle(); else drawCaption(song);
    state.overlay = { at: now(), hold: kind === 'title' ? TITLE_HOLD : 8 };
  }

  music.on((type) => {
    if ((type !== 'track' && type !== 'audible') || !state.started) return;
    const s = music.song;
    state.log.push({ no: s.no, title: s.title, titleJa: s.titleJa, style: s.styleLabel, bpm: s.bpm, key: s.keyName, at: +now().toFixed(2) });
    const t = now();
    const titleEnds = TITLE_HOLD + 1.5;
    if (state.log.length === 1) setTimeout(() => state.started && !state.ending && show('caption', s), Math.max(0, (titleEnds - t) * 1000));
    else show('caption', s);
  });

  // 指定の長さが近づいたら、次の曲へ進まずに終える
  music.onOutro = () => {
    if (now() < total - 75) return true;
    state.ending = { at: now() };
    anim.start('sleep');
    return false;
  };

  return {
    state,
    /** 録画を始める（name は shots/ の下のファイル名） */
    record(name = 'video/lounge.mp4', { vbr = 12e6 } = {}) {
      const vs = document.querySelector('#app canvas').captureStream(30);
      const as = music.recordStream();
      const stream = new MediaStream([...vs.getVideoTracks(), ...as.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', videoBitsPerSecond: vbr, audioBitsPerSecond: 256000 });
      state.recName = name;
      state.chain = fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: new Blob([]) });
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        const blob = e.data;
        state.chain = state.chain.then(() => fetch('/__append?name=' + encodeURIComponent(name), { method: 'POST', body: blob }));
      };
      rec.start(4000);
      state.recorder = rec;
    },
    /** 録画を止めて、書き出しが終わるのを待つ */
    async finish() {
      const rec = state.recorder;
      if (!rec) return;
      await new Promise((res) => { rec.onstop = res; rec.stop(); });
      await state.chain;
      state.recorder = null;
    },
    async begin() {
      let ph = 0;
      for (let i = 0; i < SCHEDULE.length; i++) if (from / total >= SCHEDULE[i][0]) ph = i;
      setEnv(SCHEDULE[ph][1], true);
      state.phase = ph;
      director.setMode('auto');
      state.t0 = performance.now() - from * 1000;
      state.started = true;
      if (from > 0) anim.snap('type'); else show('title');
      music.trackIndex = track;
      await music.play();
    },
    status() {
      const s = music.song;
      return { t: +now().toFixed(1), total, frames: state.frames, phase: SCHEDULE[state.phase]?.[1], track: s ? `${s.no} ${s.title}` : null, ending: !!state.ending, done: state.done, songs: state.log.length };
    },
    update() {
      state.frames++;
      if (!state.started) { post.film.uniforms.uFade.value = 1; return; }
      const t = now();
      // 時間帯
      const k = Math.min(0.999, t / total);
      let ph = 0;
      for (let i = 0; i < SCHEDULE.length; i++) if (k >= SCHEDULE[i][0]) ph = i;
      if (ph !== state.phase) { state.phase = ph; setEnv(SCHEDULE[ph][1], false, 45); }
      // 文字の重ね：ふわっと出て、しばらくして消える
      let a = 0;
      if (state.overlay) {
        const e = t - state.overlay.at;
        a = Math.min(1, e / 1.4) * (1 - Math.min(1, Math.max(0, e - state.overlay.hold) / 1.6));
        if (e > state.overlay.hold + 1.6) state.overlay = null;
      }
      post.film.uniforms.uOverlay.value = a;
      // 頭は黒から明ける。終わりは Clawd が眠ってから暗転
      let fade = Math.max(0, 1 - t / 2.5);
      if (state.ending) {
        const e = t - state.ending.at;
        fade = Math.min(1, Math.max(0, e - 7) / 3.5);
        if (e > 11.5) state.done = true;
      }
      post.film.uniforms.uFade.value = fade;
    },
  };
}
