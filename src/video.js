// video.js — 動画モード（?video=<分>）。YouTube 用の「ポモドーロ付き作業用 BGM」を録るためのもの。
//
// UI を出さずに自動で再生し、集中タイマーを「集中 25 分 → 休憩 5 分」×2 で回す（60 分の場合）。
// 分を変えると同じ割合で縮む（?video=6 なら集中 2.5 分・休憩 30 秒。確認用）。
// 時間帯は 朝 → 昼 →（休憩 1）夕暮れ → 夜 →（休憩 2）雨の夜 と移る。
// 画面の右上にタイマー、曲が変わると左下に曲名を出す。文字は録画に写るよう、キャンバスの中（仕上げのパス）で重ねる。
// 終わる 10 秒前に、タイマーを止めて「おつかれさまでした」を出し、音と画面をゆっくり消す。
// 録画は MediaRecorder（H.264 / AAC の MP4）で行い、開発サーバーの /__append に少しずつ書き足す。

import * as THREE from 'three';
import { JP_FONT } from './scene/textures.js';

const TECH = '"Chakra Petch", "Zen Kaku Gothic New", sans-serif';
const SCHEDULE = [[0, 'morning'], [0.13, 'day'], [0.43, 'sunset'], [0.67, 'night'], [0.92, 'rain']];
const TITLE_HOLD = 9;
const ARTIST = 'Pincer Protocol';

export function setupVideoMode({ minutes, music, setEnv, post, anim, director, focus, from = 0, track = 0 }) {
  const total = minutes * 60;
  const scale = minutes / 60;
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
    ready: true, started: false, done: false, t0: 0, phase: -1, frames: 0,
    log: [], ending: null, caption: null, title: null, recorder: null, chain: null, recName: null, drawnAt: -9,
  };
  const now = () => (performance.now() - state.t0) / 1000;

  // 集中タイマー：25 分・5 分（分の指定に合わせて縮める）を 2 回。長い休憩はなし
  focus.cfg = { focus: 25 * scale, rest: 5 * scale, long: 5 * scale, every: 99 };
  focus.presetKey = 'video';

  // ---------------------------------------------------------------- 文字
  function roundRect(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

  function drawTimer() {
    const v = focus.view();
    if (!v.active) return;
    const rest = v.phase === 'rest';
    const x = W - 96 - 380, y = 64, w = 380, h = 132;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 24;
    g.fillStyle = 'rgba(8,14,30,0.55)';
    roundRect(x, y, w, h, 22); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = rest ? 'rgba(143,227,160,0.55)' : 'rgba(255,122,184,0.55)'; g.lineWidth = 2;
    roundRect(x, y, w, h, 22); g.stroke();
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = rest ? '#8fe3a0' : '#ff9fcc';
    g.font = `700 26px ${TECH}`;
    g.fillText(rest ? 'BREAK' : `FOCUS ${Math.min(2, v.round)} / 2`, x + 28, y + 44);
    g.font = `500 22px ${JP_FONT}`; g.fillStyle = 'rgba(234,246,255,0.75)';
    g.fillText(rest ? '休憩' : '集中', x + 28, y + 80);
    g.textAlign = 'right'; g.fillStyle = '#f2f8ff';
    g.font = `700 64px ${TECH}`;
    g.fillText(v.clock, x + w - 26, y + 84);
    // 進み具合
    g.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(x + 28, y + h - 30, w - 56, 6, 3); g.fill();
    g.fillStyle = rest ? '#8fe3a0' : '#ff7ab8';
    roundRect(x + 28, y + h - 30, Math.max(6, (w - 56) * Math.min(1, v.progress)), 6, 3); g.fill();
    g.restore();
  }

  function drawCaption(c, a) {
    const s = c.song;
    const x = 96, y = H - 150;
    g.save();
    g.globalAlpha = a;
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 18;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = s.isBreak ? '#8fe3a0' : '#48e4ff';
    g.font = `700 26px ${TECH}`;
    g.fillText(s.isBreak ? 'NOW PLAYING  ·  BREAK' : `NOW PLAYING  ·  No.${String(s.no).padStart(2, '0')}`, x, y);
    g.fillStyle = 'rgba(244,250,255,0.97)';
    g.font = `700 58px ${JP_FONT}`;
    g.fillText(s.title, x, y + 66);
    g.fillStyle = 'rgba(234,246,255,0.8)';
    g.font = `500 30px ${JP_FONT}`;
    g.fillText(`${s.titleJa} — ${ARTIST}  ·  ${s.styleLabel} · ${s.bpm} BPM`, x, y + 112);
    g.restore();
  }

  function drawTitle(a) {
    g.save();
    g.globalAlpha = a;
    const grd = g.createLinearGradient(0, H * 0.45, 0, H);
    grd.addColorStop(0, 'rgba(4,8,20,0)'); grd.addColorStop(1, 'rgba(4,8,20,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `700 132px ${TECH}`;
    const tg = g.createLinearGradient(120, 0, 1000, 0);
    tg.addColorStop(0, '#9ff3ff'); tg.addColorStop(0.5, '#48e4ff'); tg.addColorStop(1, '#ff9fcc');
    g.shadowColor = 'rgba(72,228,255,0.6)'; g.shadowBlur = 40;
    g.fillStyle = tg;
    g.letterSpacing = '14px';
    g.fillText('FLOW DESK', 116, 800);
    g.letterSpacing = '0px';
    g.shadowBlur = 12; g.shadowColor = 'rgba(0,0,0,0.6)';
    g.fillStyle = 'rgba(244,250,255,0.95)';
    g.font = `500 44px ${JP_FONT}`;
    g.fillText(`Clawd の作業部屋 · 62F — 作業用 BGM ${minutes} 分（集中 ${fmtMin(25 * scale)}＋休憩 ${fmtMin(5 * scale)} ×2）`, 124, 884);
    g.fillStyle = 'rgba(234,246,255,0.72)';
    g.font = `400 30px ${JP_FONT}`;
    g.fillText('曲はすべてコードがその場で作曲・演奏しています', 126, 942);
    g.restore();
  }

  function drawEnd(a) {
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 24;
    g.fillStyle = 'rgba(244,250,255,0.97)';
    g.font = `700 72px ${JP_FONT}`;
    g.fillText('おつかれさまでした', W / 2, H / 2 - 20);
    g.font = `500 32px ${JP_FONT}`; g.fillStyle = 'rgba(234,246,255,0.8)';
    g.fillText(`集中 ${focus.done} 回 · ${Math.round(focus.focusedMs / 60000)} 分`, W / 2, H / 2 + 56);
    g.restore();
  }

  const fadeA = (o, t) => {
    if (!o) return 0;
    const e = t - o.at;
    if (e < 0) return 0;
    return Math.min(1, e / 1.4) * (1 - Math.min(1, Math.max(0, e - o.hold) / 1.6));
  };

  function redraw(t) {
    g.clearRect(0, 0, W, H);
    const ta = fadeA(state.title, t);
    if (state.title && t - state.title.at > state.title.hold + 1.6) state.title = null;
    if (!state.title || t - state.title.at > 3) drawTimer();
    if (ta > 0) drawTitle(ta);
    const ca = fadeA(state.caption, t);
    if (state.caption && t - state.caption.at > state.caption.hold + 1.6) state.caption = null;
    if (ca > 0 && state.caption) drawCaption(state.caption, ca);
    if (state.ending) drawEnd(Math.min(1, (t - state.ending.at) / 1.5));
    tex.needsUpdate = true;
    state.drawnAt = t;
  }

  // 曲が変わったら曲名を出し、記録する
  music.on((type) => {
    if ((type !== 'track' && type !== 'audible') || !state.started || state.ending) return;
    const s = music.audible()?.song || music.song;
    if (!s || state.log.some((x) => x.kind === 'song' && x.song === s)) return;
    const at = +now().toFixed(2);
    state.log.push({ kind: 'song', song: s, no: s.no, isBreak: !!s.isBreak, title: s.title, titleJa: s.titleJa, style: s.styleLabel, bpm: s.bpm, key: s.keyName, at });
    state.caption = { song: s, at: Math.max(at, state.title ? TITLE_HOLD + 1.5 : 0), hold: 8 };
  });
  // 集中と休憩の切り替わりを記録する（チャプター用）
  const origPhase = focus.onPhase;
  focus.onPhase = (phase, prev) => {
    origPhase?.(phase, prev);
    if (state.started && !state.ending && phase !== 'off') state.log.push({ kind: 'phase', phase, round: focus.round, at: +now().toFixed(2) });
  };

  return {
    state,
    /** 録画を始める（name は shots/ の下のファイル名） */
    record(name = 'video/flowdesk.mp4', { vbr = 12e6 } = {}) {
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
      if (from === 0) state.title = { at: 0, hold: TITLE_HOLD };
      music.trackIndex = track;
      music.mode = 'work';
      focus.reset();
      focus.start();
      if (from > 0) { focus.offset += from * 1000; focus.update(); anim.snap(anim.resting ? 'window' : 'type'); }
      await music.play();
    },
    status() {
      const s = music.audible()?.song;
      const v = focus.view();
      return { t: +now().toFixed(1), total, frames: state.frames, phase: SCHEDULE[state.phase]?.[1], focus: `${v.phase} ${v.clock}`, track: s ? `${s.isBreak ? '☕' : s.no} ${s.title}` : null, ending: !!state.ending, done: state.done, songs: state.log.filter((x) => x.kind === 'song').length };
    },
    update() {
      state.frames++;
      if (!state.started) { post.film.uniforms.uFade.value = 1; return; }
      const t = now();
      // 時間帯
      const k = Math.min(0.999, t / total);
      let ph = 0;
      for (let i = 0; i < SCHEDULE.length; i++) if (k >= SCHEDULE[i][0]) ph = i;
      if (ph !== state.phase) { state.phase = ph; setEnv(SCHEDULE[ph][1], false, 45 * Math.max(0.2, scale)); }
      // 終わり：10 秒前にタイマーを止め、ねぎらって、音と画面を消していく
      if (!state.ending && t >= total - 10) {
        state.ending = { at: t };
        director.fixed = 'drone'; // 最後は窓の外から、外を眺める Clawd を映して終える
        director.cut('drone', 2);
        focus.pause();
        music.chime('done');
        anim.cheer();
        state.caption = null;
        setTimeout(() => music.fadeOut(7), 2500);
      }
      // 文字の重ね：変化があるときは 15fps、ないときは 4fps で描き直す
      const c = state.caption;
      const ce = c ? t - c.at : -1;
      const fading = (state.title && t - state.title.at < state.title.hold + 1.7) || (c && ce > -0.1 && (ce < 1.5 || ce > c.hold - 0.1)) || state.ending;
      if (t - state.drawnAt > (fading ? 1 / 15 : 0.25)) redraw(t);
      post.film.uniforms.uOverlay.value = 1;
      // 頭は黒から明ける。終わりは画面を消す
      let fade = Math.max(0, 1 - t / 2.5);
      if (state.ending) {
        const e = t - state.ending.at;
        fade = Math.min(1, Math.max(0, e - 6.5) / 3.5);
        if (e > 10.5) state.done = true;
      }
      post.film.uniforms.uFade.value = fade;
    },
  };
}

function fmtMin(m) { return m >= 1 ? `${Math.round(m)} 分` : `${Math.round(m * 60)} 秒`; }
