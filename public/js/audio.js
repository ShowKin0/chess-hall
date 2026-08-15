/* ============ 古风水墨音效 / 程序化 BGM ============ */
/* 使用 Web Audio API 生成柔和五声音阶，无需任何外部音频文件，零网络延迟 */
window.GameAudio = (function () {
  let ctx = null;
  let master = null;
  let bgmBus = null;
  let sfxBus = null;
  let enabled = true;
  let bgmOn = false;
  let schedulerId = null;
  let nextTime = 0;
  let step = 0;
  let unlockBound = false;

  // 宫商角徵羽（五声音阶），古琴质感
  const SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  const MELODY = [
    392.00, 440.00, 523.25, 587.33, 659.25, 587.33, 523.25, 440.00,
    329.63, 392.00, 440.00, 523.25, 440.00, 392.00, 329.63, 293.66,
    392.00, 440.00, 523.25, 659.25, 587.33, 523.25, 440.00, 392.00,
    329.63, 293.66, 261.63, 329.63, 392.00, 440.00, 392.00, 329.63,
  ];
  const RHYTHM = [
    0.62, 0.40, 0.48, 0.62, 0.40, 0.48, 0.56, 0.68,
    0.56, 0.40, 0.48, 0.56, 0.40, 0.48, 0.56, 0.68,
    0.62, 0.40, 0.48, 0.62, 0.40, 0.48, 0.56, 0.68,
    0.56, 0.40, 0.48, 0.56, 0.40, 0.48, 0.56, 0.68,
  ];

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      bgmBus = ctx.createGain();
      bgmBus.gain.value = 0.6;
      bgmBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* 单音拨弦：三角波 + 低通滤波 + 快速起音/缓慢衰减，近似古琴/古筝 */
  function pluck(freq, time, vol, dur, type, filterFreq, bus) {
    if (!ctx || !enabled) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 2100;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    const t0 = time || ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 1.2));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus || bgmBus);
    osc.start(t0);
    osc.stop(t0 + (dur || 1.2) + 0.05);
  }

  function scheduleBGM() {
    const c = ensureCtx();
    if (!c || !bgmOn) return;
    if (nextTime < c.currentTime + 0.05) nextTime = c.currentTime + 0.1;

    while (nextTime < c.currentTime + 1.1) {
      const idx = step % MELODY.length;
      const freq = MELODY[idx];
      pluck(freq, nextTime, 0.085, 1.45, 'triangle', 1900, bgmBus);
      // 低音铺底，像远处钟磬余韵
      if (idx % 8 === 0) pluck(freq / 2, nextTime, 0.035, 2.4, 'sine', 600, bgmBus);
      nextTime += RHYTHM[idx];
      step++;
    }
  }

  function startBGM() {
    const c = ensureCtx();
    if (!c) return;
    bgmOn = true;
    if (!schedulerId) {
      scheduleBGM();
      schedulerId = setInterval(scheduleBGM, 260);
    }
  }

  function stopBGM() {
    bgmOn = false;
    if (schedulerId) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  function toggle() {
    ensureCtx();
    enabled = !enabled;
    if (enabled) {
      startBGM();
    } else {
      stopBGM();
    }
    const btn = document.getElementById('btn-sound');
    if (btn) btn.classList.toggle('muted', !enabled);
    return enabled;
  }

  function sfx(name) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime;
    const note = (f, dt, v, d, type) => pluck(f, t + (dt || 0), v, d, type || 'triangle', 2400, sfxBus);
    switch (name) {
      case 'move': note(SCALE[Math.floor(Math.random() * 5) + 2], 0, 0.10, 0.22); break;
      case 'select': note(659.25, 0, 0.09, 0.12); break;
      case 'menu': note(523.25, 0, 0.08, 0.14); note(659.25, 0.06, 0.08, 0.14); break;
      case 'notify': note(587.33, 0, 0.10, 0.30); note(783.99, 0.09, 0.10, 0.36); break;
      case 'accept': note(523.25, 0, 0.10, 0.28); note(659.25, 0.09, 0.10, 0.28); note(783.99, 0.18, 0.11, 0.40); break;
      case 'reject': note(392.00, 0, 0.10, 0.28); note(329.63, 0.10, 0.10, 0.34); break;
      case 'match': note(392.00, 0, 0.09, 0.24); note(523.25, 0.10, 0.09, 0.24); note(659.25, 0.20, 0.11, 0.42); break;
      case 'win': note(523.25, 0, 0.12, 0.5); note(659.25, 0.12, 0.12, 0.5); note(783.99, 0.24, 0.12, 0.6); note(1046.5, 0.36, 0.13, 0.9); break;
      case 'lose': note(392.00, 0, 0.12, 0.5); note(329.63, 0.12, 0.12, 0.5); note(261.63, 0.24, 0.12, 0.7); break;
      default: break;
    }
  }

  function unlock() {
    const c = ensureCtx();
    if (c && enabled) startBGM();
  }

  function bindUnlock() {
    if (unlockBound) return;
    unlockBound = true;
    const fire = () => unlock();
    window.addEventListener('pointerdown', fire, { once: true });
    window.addEventListener('keydown', fire, { once: true });
  }

  bindUnlock();

  return {
    toggle,
    sfx,
    unlock,
    startBGM,
    stopBGM,
    get enabled() { return enabled; },
  };
})();
