// focus.js — 集中タイマー（ポモドーロ）：集中 25 分 → 休憩 5 分 をくり返し、4 回ごとに長い休憩 15 分
//
// 時計は Date.now() で数えるので、タブが裏にあっても進む（裏では 1 秒ごとに確かめる）。
// 確認用に、時計を進める offset（ミリ秒）を足せる（__dev.focus.skipAhead）。

export const PRESETS = {
  '25/5': { focus: 25, rest: 5, long: 15, every: 4 },
  '50/10': { focus: 50, rest: 10, long: 20, every: 3 },
};

export class FocusTimer {
  constructor({ preset = '25/5', onPhase = null } = {}) {
    this.setPreset(preset);
    this.phase = 'off'; // off | focus | rest | long
    this.running = false;
    this.endAt = 0;
    this.left = 0;      // 一時停止中の残り（ミリ秒）
    this.round = 1;     // 何回目の集中か
    this.done = 0;      // 終えた集中の回数
    this.focusedMs = 0; // 集中した時間の合計
    this.offset = 0;
    this.onPhase = onPhase; // (phase, prev) 切り替わったとき
    this.lastNow = this.now();
    this.iv = setInterval(() => this.update(), 1000);
  }

  now() { return Date.now() + this.offset; }

  setPreset(key) {
    this.presetKey = PRESETS[key] ? key : '25/5';
    this.cfg = PRESETS[this.presetKey];
  }

  lengthOf(phase) { return (phase === 'focus' ? this.cfg.focus : phase === 'long' ? this.cfg.long : this.cfg.rest) * 60000; }

  get active() { return this.phase !== 'off'; }

  /** 始める（止まっていれば集中から。一時停止中なら続きから） */
  start() {
    const now = this.now();
    if (this.phase === 'off') { this.phase = 'focus'; this.left = this.lengthOf('focus'); this.onPhase?.('focus', 'off'); }
    if (!this.running) { this.endAt = now + this.left; this.running = true; this.lastNow = now; }
  }

  pause() {
    if (!this.running) return;
    this.update();
    this.left = Math.max(0, this.endAt - this.now());
    this.running = false;
  }

  toggle() { this.running ? this.pause() : this.start(); }

  /** やめる（集中の記録は残す） */
  reset() {
    const prev = this.phase;
    this.phase = 'off'; this.running = false; this.round = 1;
    if (prev !== 'off') this.onPhase?.('off', prev);
  }

  /** 今の区切りを飛ばして次へ */
  skip() {
    if (this.phase === 'off') return;
    this.next(this.now());
  }

  next(now) {
    const prev = this.phase;
    if (prev === 'focus') {
      this.done++;
      this.phase = this.done % this.cfg.every === 0 ? 'long' : 'rest';
    } else {
      this.phase = 'focus';
      this.round++;
    }
    this.left = this.lengthOf(this.phase);
    this.endAt = now + this.left;
    this.onPhase?.(this.phase, prev);
  }

  update() {
    const now = this.now();
    if (this.running && this.phase === 'focus') this.focusedMs += Math.max(0, Math.min(now, this.endAt) - this.lastNow);
    this.lastNow = now;
    if (!this.running || this.phase === 'off') return;
    let guard = 0;
    while (now >= this.endAt && guard++ < 8) this.next(this.endAt);
  }

  /** 画面に出す値 */
  view() {
    const leftMs = this.phase === 'off' ? 0 : this.running ? Math.max(0, this.endAt - this.now()) : this.left;
    const total = this.phase === 'off' ? 1 : this.lengthOf(this.phase);
    const s = Math.ceil(leftMs / 1000);
    return {
      active: this.phase !== 'off', running: this.running, phase: this.phase === 'long' ? 'rest' : this.phase, long: this.phase === 'long',
      leftMs, progress: 1 - leftMs / total, clock: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
      mm: Math.floor(s / 60), ss: s % 60, round: this.round, done: this.done, focusedSec: this.focusedMs / 1000, preset: this.presetKey,
    };
  }
}
