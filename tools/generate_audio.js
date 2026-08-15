/* 生成真实 WAV 音频文件（古筝物理建模 + 混响），构建时执行，无需网络 */
const fs = require('fs');
const path = require('path');

const SR = 22050;
const OUT_DIR = path.join(__dirname, '..', 'public', 'audio');

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  console.log('[audio]', path.relative(process.cwd(), file), (buf.length / 1024).toFixed(1) + ' KB');
}

/* Karplus-Strong 拨弦：比普通振荡器更接近真实琴弦 */
function pluck(freq, dur, vol, brightness) {
  const period = Math.max(2, Math.round(SR / freq));
  const n = Math.max(1, Math.round(SR * dur));
  const delay = new Float32Array(period);
  for (let i = 0; i < period; i++) delay[i] = Math.random() * 2 - 1;
  const out = new Float32Array(n);
  let idx = 0;
  const damp = brightness == null ? 0.9965 : brightness;
  for (let i = 0; i < n; i++) {
    out[i] = delay[idx];
    delay[idx] = 0.5 * (delay[idx] + delay[(idx + 1) % period]) * damp;
    idx = (idx + 1) % period;
  }
  // 音头与自然衰减
  const attack = Math.min(80, n >> 3);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attack) env = i / attack;
    env *= Math.exp(-2.2 * (i / n));
    out[i] *= env * vol;
  }
  return out;
}

function mixAt(dest, src, atSec, vol) {
  const pos = Math.floor(atSec * SR);
  const end = Math.min(dest.length, pos + src.length);
  for (let i = pos; i < end; i++) dest[i] += src[i - pos] * vol;
}

function addEcho(dest, delaySec, feedback, times) {
  const d = Math.floor(delaySec * SR);
  for (let t = 0; t < times; t++) {
    const start = d * (t + 1);
    for (let i = start; i < dest.length; i++) dest[i] += dest[i - start] * Math.pow(feedback, t + 1);
  }
}

function normalize(dest, peak) {
  let max = 0;
  for (let i = 0; i < dest.length; i++) max = Math.max(max, Math.abs(dest[i]));
  const gain = max > 0 ? (peak || 0.82) / max : 1;
  for (let i = 0; i < dest.length; i++) dest[i] *= gain;
  return dest;
}

function generateSFX(name, notes, totalDur) {
  const buf = new Float32Array(Math.ceil(SR * totalDur));
  notes.forEach((n) => {
    const s = pluck(n.f, n.d || 0.9, 0.5, 0.9955);
    mixAt(buf, s, n.t || 0, n.v == null ? 1 : n.v);
  });
  addEcho(buf, 0.09, 0.25, 3);
  writeWav(path.join(OUT_DIR, name + '.wav'), normalize(buf, 0.75));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 柔和古风五声音阶 BGM（约 24 秒循环）
  const melody = [392, 440, 523.25, 587.33, 659.25, 587.33, 523.25, 440, 329.63, 392, 440, 523.25, 440, 392, 329.63, 293.66];
  const rhythm = [0.62, 0.40, 0.48, 0.62, 0.40, 0.48, 0.56, 0.68, 0.56, 0.40, 0.48, 0.56, 0.40, 0.48, 0.56, 0.68];
  const bgmDur = 24.5;
  const bgm = new Float32Array(Math.ceil(SR * bgmDur));
  let t = 0.12;
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < melody.length; i++) {
      if (t > bgmDur - 1.5) break;
      const f = melody[i];
      const p = pluck(f, 1.7, 0.34, 0.9962);
      mixAt(bgm, p, t, 1);
      if (i % 4 === 0) {
        const low = pluck(f / 2, 2.6, 0.22, 0.997);
        mixAt(bgm, low, t, 0.6);
      }
      t += rhythm[i];
    }
  }
  addEcho(bgm, 0.22, 0.30, 4);
  addEcho(bgm, 0.44, 0.18, 2);
  writeWav(path.join(OUT_DIR, 'bgm.wav'), normalize(bgm, 0.72));

  generateSFX('move', [
    { f: 659.25, t: 0, d: 0.30, v: 1.0 },
    { f: 523.25, t: 0.03, d: 0.24, v: 0.45 },
  ], 0.6);
  generateSFX('select', [{ f: 880, t: 0, d: 0.18, v: 0.9 }], 0.4);
  generateSFX('notify', [
    { f: 587.33, t: 0, d: 0.45, v: 1 },
    { f: 783.99, t: 0.10, d: 0.55, v: 0.9 },
  ], 1.0);
  generateSFX('match', [
    { f: 392, t: 0, d: 0.30, v: 0.9 },
    { f: 523.25, t: 0.10, d: 0.30, v: 0.9 },
    { f: 659.25, t: 0.20, d: 0.60, v: 1 },
  ], 1.1);
  generateSFX('win', [
    { f: 523.25, t: 0, d: 0.55, v: 1 },
    { f: 659.25, t: 0.12, d: 0.55, v: 1 },
    { f: 783.99, t: 0.24, d: 0.60, v: 1 },
    { f: 1046.50, t: 0.38, d: 1.0, v: 1 },
  ], 1.8);
  generateSFX('lose', [
    { f: 392, t: 0, d: 0.55, v: 1 },
    { f: 329.63, t: 0.13, d: 0.55, v: 1 },
    { f: 261.63, t: 0.27, d: 0.85, v: 1 },
  ], 1.4);
}

main();
