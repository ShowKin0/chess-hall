/* ============ 古风音乐 / 音效（真实 WAV 音频） ============ */
/* 音频文件由 tools/generate_audio.js 构建时生成；也可替换 public/audio 下同名文件 */
window.GameAudio = (function () {
  const BASE = '/audio/';
  const FILES = {
    bgm: 'bgm.wav',
    move: 'move.wav',
    select: 'select.wav',
    notify: 'notify.wav',
    match: 'match.wav',
    win: 'win.wav',
    lose: 'lose.wav',
  };

  let enabled = true;
  let bgm = null;
  let unlockBound = false;

  function ensureBGM() {
    if (bgm) return bgm;
    bgm = new Audio(BASE + FILES.bgm);
    bgm.loop = true;
    bgm.volume = 0.55;
    bgm.preload = 'auto';
    bgm.addEventListener('error', () => { bgm = null; }, { once: true });
    return bgm;
  }

  function startBGM() {
    if (!enabled) return;
    const a = ensureBGM();
    if (a) {
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  function stopBGM() {
    if (bgm) {
      bgm.pause();
      bgm.currentTime = 0;
    }
  }

  function playOnce(name, vol) {
    if (!enabled || !FILES[name]) return;
    const a = new Audio(BASE + FILES[name]);
    a.volume = vol == null ? 0.9 : vol;
    a.preload = 'auto';
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  function toggle() {
    enabled = !enabled;
    if (enabled) startBGM();
    else stopBGM();
    const btn = document.getElementById('btn-sound');
    if (btn) btn.classList.toggle('muted', !enabled);
    return enabled;
  }

  function sfx(name) {
    if (!enabled) return;
    switch (name) {
      case 'move': playOnce('move', 0.85); break;
      case 'select': playOnce('select', 0.8); break;
      case 'menu': playOnce('select', 0.75); break;
      case 'notify': playOnce('notify', 0.9); break;
      case 'accept': playOnce('match', 0.9); break;
      case 'reject': playOnce('lose', 0.7); break;
      case 'match': playOnce('match', 0.95); break;
      case 'win': playOnce('win', 0.95); break;
      case 'lose': playOnce('lose', 0.95); break;
      default: break;
    }
  }

  function unlock() {
    startBGM();
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
