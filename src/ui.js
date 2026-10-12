// ui.js — 画面の UI（再生カード、集中タイマー、時間帯、カメラ、曲リスト、スタート画面）
import { trackAt } from './audio/engine.js';
import { PRESETS } from './scene/env.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ARTIST = 'Pincer Protocol';
const ENV_KEYS = ['morning', 'day', 'sunset', 'night', 'rain'];

export function createUI({ music, env, director, focus, onEnv, onStart, store }) {
  const playBtn = $('btnPlay');
  let toastT = 0;
  const toast = (msg) => {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 2000);
  };

  const setEnvButtons = () => document.querySelectorAll('[data-env]').forEach((b) => b.classList.toggle('on', b.dataset.env === env.key));
  const setCamButtons = () => document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === director.mode));
  setEnvButtons();
  setCamButtons();

  const pickEnv = (key) => { onEnv(key); setEnvButtons(); toast(PRESETS[key].label); };
  const pickCam = (mode) => { director.setMode(mode); setCamButtons(); store.set('cam', mode); toast(mode === 'auto' ? 'カメラ：オート' : 'カメラ：自由（ドラッグで見回す）'); };
  document.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => pickEnv(b.dataset.env)));
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => pickCam(b.dataset.cam)));

  const hideStart = () => { $('start').classList.add('hide'); document.body.classList.remove('intro'); };
  const start = async (withFocus = false) => {
    hideStart();
    await onStart();
    if (withFocus && !focus.active) { focus.start(); focusChanged(); }
  };
  $('btnStart').addEventListener('click', () => start(false));
  $('btnStartFocus').addEventListener('click', () => start(true));
  playBtn.addEventListener('click', () => (music.state === 'idle' ? start() : music.toggle()));
  $('btnNext').addEventListener('click', () => { hideStart(); music.next(); });
  $('btnPrev').addEventListener('click', () => { hideStart(); music.prev(); });
  const vol = $('vol');
  vol.value = store.get('vol', 0.75);
  music.setVolume(+vol.value);
  vol.addEventListener('input', () => { music.setVolume(+vol.value); store.set('vol', +vol.value); });
  const typing = $('typing');
  typing.checked = store.get('typing', false);
  music.setTyping(typing.checked);
  typing.addEventListener('change', () => { music.setTyping(typing.checked); store.set('typing', typing.checked); });

  const hide = () => { document.body.classList.toggle('ui-hidden'); };
  $('btnHide').addEventListener('click', hide);
  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  // UI を隠しているときは、画面をタップすると戻す
  document.addEventListener('pointerup', (e) => {
    if (document.body.classList.contains('ui-hidden') && e.target.tagName === 'CANVAS' && director.mode !== 'free') document.body.classList.remove('ui-hidden');
  });

  // ---------------------------------------------------------------- 集中タイマー
  const card = $('focusCard');
  const setPresetButtons = () => document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === focus.presetKey));
  setPresetButtons();
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    if (focus.active) { toast('タイマーを止めてから切り替えられます'); return; }
    focus.setPreset(b.dataset.preset); store.set('focusPreset', focus.presetKey); setPresetButtons(); focusChanged();
  }));
  const toggleFocus = async () => {
    if (!focus.active && music.state === 'idle') { await start(true); return; }
    focus.toggle();
    focusChanged();
    toast(focus.running ? '集中タイマー：再開' : '集中タイマー：一時停止');
  };
  $('fcStart').addEventListener('click', toggleFocus);
  $('fcSkip').addEventListener('click', () => { if (!focus.active) return; focus.skip(); focusChanged(); });
  $('fcReset').addEventListener('click', () => { focus.reset(); focusChanged(); });
  function focusChanged() {
    const v = focus.view();
    $('fcStart').textContent = !v.active ? 'はじめる' : v.running ? '一時停止' : '再開';
    card.classList.toggle('rest', v.active && v.phase === 'rest');
    renderFocus(v);
  }
  function renderFocus(v) {
    const len = focus.cfg.focus;
    $('fcTime').textContent = v.active ? v.clock : `${String(len).padStart(2, '0')}:00`;
    $('fcPhase').textContent = !v.active ? '止まっています' : v.phase === 'rest' ? (v.long ? '長めの休憩' : '休憩') + (v.running ? '' : '（一時停止）') : `集中 ${v.round} 回目` + (v.running ? '' : '（一時停止）');
    $('fcStats').textContent = `今日：集中 ${v.done} 回 · ${Math.round(v.focusedSec / 60)} 分`;
    $('fcRing').style.strokeDashoffset = String(276.46 * (v.active ? v.progress : 1));
  }

  // ---------------------------------------------------------------- 曲リスト（作業用の 8 曲）
  const list = $('trackList');
  for (let i = 0; i < 8; i++) {
    const s = music.songFor(i);
    const li = document.createElement('li');
    li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><span>${s.title}</span><span class="ja">${s.titleJa}</span>`;
    li.addEventListener('click', () => { hideStart(); music.load(i, 0, { mode: 'work' }); if (music.state !== 'playing') music.play(); });
    list.appendChild(li);
  }
  $('btnList').addEventListener('click', () => {
    list.hidden = !list.hidden;
    $('btnList').setAttribute('aria-expanded', String(!list.hidden));
    $('btnList').textContent = list.hidden ? '曲リスト ▾' : '曲リスト ▴';
  });

  // キー操作（ボタンにフォーカスがあるときの Space は、ボタンを押したことにしない）
  addEventListener('keyup', (e) => { if (e.code === 'Space' && e.target.tagName === 'BUTTON') e.preventDefault(); });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const d = /^Digit([1-5])$/.exec(e.code);
    if (d) { pickEnv(ENV_KEYS[+d[1] - 1]); return; }
    switch (e.code) {
      case 'Space': e.preventDefault(); music.state === 'idle' ? start() : music.toggle(); break;
      case 'ArrowRight': music.next(); hideStart(); break;
      case 'ArrowLeft': music.prev(); hideStart(); break;
      case 'KeyT': toggleFocus(); break;
      case 'KeyC': pickCam(director.mode === 'auto' ? 'free' : 'auto'); break;
      case 'KeyH': hide(); break;
      case 'KeyM': vol.value = +vol.value > 0 ? 0 : store.get('vol', 0.75) || 0.75; music.setVolume(+vol.value); break;
    }
  });

  const showTrack = (s) => {
    if (!s) return;
    $('npTitle').textContent = s.isBreak ? `☕ ${s.title}` : `${String(s.no).padStart(2, '0')}. ${s.title}`;
    $('npSub').textContent = `${s.titleJa} — ${ARTIST}`;
    $('npMeta').textContent = `${s.styleLabel} · ${s.bpm} BPM · ${s.keyName}`;
    [...list.children].forEach((li, i) => li.classList.toggle('on', !s.isBreak && i === s.index));
  };
  showTrack(music.songFor(music.trackIndex));

  music.on((type) => {
    if (type === 'track' || type === 'audible') {
      const s = music.song && type === 'track' ? music.song : music.audible()?.song || music.song;
      showTrack(s);
      if (music.state === 'playing' && s) toast(`♪ ${s.title}`);
    }
    if (type === 'state' || type === 'track') {
      const playing = music.state === 'playing';
      $('icoPlay').toggleAttribute('hidden', playing); // SVG 要素には .hidden プロパティがないので属性で切り替える
      $('icoPause').toggleAttribute('hidden', !playing);
      playBtn.setAttribute('aria-label', playing ? '一時停止' : '再生');
    }
  });

  let last = 0;
  return {
    toast,
    focusChanged,
    update(info, now, fv) {
      if (now - last < 0.2) return;
      last = now;
      const d = new Date();
      $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      renderFocus(fv);
      if (!info.song) return;
      $('npSection').textContent = info.section ? info.section.label : '—';
      $('npChord').textContent = info.playing ? info.chord : '—';
      const dur = info.duration || 1;
      $('npFill').style.width = `${Math.min(100, (info.time / dur) * 100)}%`;
      $('npTime').textContent = `${fmt(info.time)} / ${fmt(dur)}`;
    },
  };
}

export { trackAt };
