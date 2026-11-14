// Original procedural music bed + UI sound cues for the Captab motion demo.
// 120 BPM, A minor (Am - F - C - G), stereo 48 kHz. No samples or third-party audio.
import { writeFileSync } from "node:fs";

const SR = 48000;
const BEAT = 0.5, BAR = 2;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // Am F C G (voiced)
const ROOTS = [45, 41, 48, 43];
const TAU = Math.PI * 2;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

export function synthesize({ duration, scenes, cues, music = null }) {
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const fxL = new Float32Array(n), fxR = new Float32Array(n); // send to delay
  const add = (buf, i, v) => { if (i >= 0 && i < n) buf[i] += v; };
  const grid = (x, step = BEAT) => Math.ceil(x / step - 1e-9) * step; // keep every entry on the beat grid
  // Arrangement: from the page's MUSIC block, or derived from scene starts (the 30 s cut).
  const M = music ?? { drop: scenes[1], hats: scenes[2], claps: scenes[3], lift: scenes[4], drumsEnd: scenes[scenes.length - 1] };
  const dropStart = grid(M.drop), drumsEnd = M.drumsEnd, lift = M.lift;
  const inBreak = (t) => M.breakStart !== undefined && t >= M.breakStart && t < M.breakEnd;

  // kick timeline for sidechain ducking
  const kicks = [];
  for (let t = dropStart; t < drumsEnd - 0.01; t += BEAT) if (!inBreak(t)) kicks.push(t);
  const duck = new Float32Array(n).fill(1);
  for (const kt of kicks) {
    const i0 = Math.round(kt * SR);
    for (let j = 0; j < SR * 0.4 && i0 + j < n; j++) duck[i0 + j] = Math.min(duck[i0 + j], 1 - 0.55 * Math.exp(-j / SR * 9));
  }

  // pad: additive saw-like voices, detuned per channel, slow attack, per-bar chords
  for (let bar = 0; bar * BAR < duration; bar++) {
    const chord = CHORDS[bar % 4], t0 = bar * BAR, t1 = Math.min(duration, t0 + BAR + 0.6);
    const lastBar = t0 + BAR >= duration - 0.01;
    for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR) && i < n; i++) {
      const t = i / SR, lt = t - t0;
      let env = Math.min(1, lt / 0.35) * (lt > BAR ? Math.max(0, 1 - (lt - BAR) / 0.6) : 1);
      if (lastBar) env = Math.min(1, lt / 0.35);
      const bright = t < dropStart ? 3 : t < lift ? 5 : 6;
      let l = 0, r = 0;
      for (const m of chord) {
        const f = hz(m);
        for (let h = 1; h <= bright; h++) {
          const a = 1 / (h * h * 0.6 + 0.4);
          l += a * Math.sin(TAU * f * h * 0.9985 * t);
          r += a * Math.sin(TAU * f * h * 1.0015 * t + 0.7);
        }
      }
      const g = 0.035 * env * duck[i];
      L[i] += l * g; R[i] += r * g;
    }
  }

  // bass: eighth-note pulse on chord root from the drop
  for (let t = dropStart; t < drumsEnd; t += BEAT / 2) {
    if (inBreak(t)) continue;
    const root = ROOTS[Math.floor(t / BAR) % 4], f = hz(root);
    const i0 = Math.round(t * SR), len = Math.round(0.24 * SR);
    for (let j = 0; j < len && i0 + j < n; j++) {
      const lt = j / SR, env = Math.min(1, lt / 0.005) * Math.exp(-lt * 7);
      const v = (Math.sin(TAU * f * lt) + 0.35 * Math.sin(TAU * f * 2 * lt) + 0.12 * Math.sin(TAU * f * 3 * lt)) * env * 0.16 * duck[i0 + j];
      add(L, i0 + j, v); add(R, i0 + j, v);
    }
  }

  // arpeggio pluck: 16ths through chord tones, ping-pong, louder after the lift
  const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
  for (let s = 0, t = 0.5; t < duration - 1.2; s++, t = 0.5 + s * BEAT / 2) {
    if (t > drumsEnd && t < drumsEnd + 0.01) continue;
    const chord = CHORDS[Math.floor(t / BAR) % 4], m = chord[pattern[s % 8]] + 12 + (s % 16 >= 12 ? 12 : 0);
    const f = hz(m), i0 = Math.round(t * SR), len = Math.round(0.3 * SR);
    const level = t < dropStart ? 0.05 : t < lift ? 0.06 : 0.075;
    const pan = s % 2 ? 0.7 : 1.0;
    for (let j = 0; j < len && i0 + j < n; j++) {
      const lt = j / SR, env = Math.min(1, lt / 0.003) * Math.exp(-lt * 16);
      const v = (Math.sin(TAU * f * lt) + 0.3 * Math.sin(TAU * f * 2 * lt)) * env * level;
      add(L, i0 + j, v * pan); add(R, i0 + j, v * (1.7 - pan));
      add(fxL, i0 + j, v * 0.5); add(fxR, i0 + j, v * 0.5);
    }
  }

  // drums
  const noise = rng(7);
  for (const kt of kicks) {
    const i0 = Math.round(kt * SR);
    let ph = 0;
    for (let j = 0; j < 0.35 * SR && i0 + j < n; j++) {
      const lt = j / SR, f = 48 + 90 * Math.exp(-lt * 32);
      ph += TAU * f / SR;
      const v = Math.sin(ph) * Math.exp(-lt * 8) * 0.42;
      add(L, i0 + j, v); add(R, i0 + j, v);
    }
  }
  for (let t = grid(M.hats) + BEAT / 2; t < drumsEnd; t += BEAT) { // off-beat hats
    if (inBreak(t)) continue;
    const i0 = Math.round(t * SR); let prev = 0;
    for (let j = 0; j < 0.06 * SR && i0 + j < n; j++) {
      const x = noise(), hp = x - prev; prev = x;
      const v = hp * Math.exp(-j / SR * 70) * 0.05;
      add(L, i0 + j, v * 0.8); add(R, i0 + j, v * 1.1);
    }
  }
  for (let t = grid(M.claps, BAR) + BEAT; t < drumsEnd; t += BEAT * 2) { // soft clap on 2 and 4
    if (inBreak(t)) continue;
    const i0 = Math.round(t * SR); let lp = 0;
    for (let j = 0; j < 0.18 * SR && i0 + j < n; j++) {
      const x = noise(); lp += 0.35 * (x - lp);
      const lt = j / SR, env = Math.exp(-lt * 22) + 0.4 * Math.exp(-Math.max(0, lt - 0.012) * 40) * (lt > 0.012 ? 1 : 0);
      const v = (x - lp) * env * 0.09;
      add(L, i0 + j, v); add(R, i0 + j, v);
      add(fxL, i0 + j, v * 0.4); add(fxR, i0 + j, v * 0.4);
    }
  }

  // riser across the break: swelling filtered noise plus a rising tone, landing on the next downbeat
  if (M.breakStart !== undefined) {
    const i0 = Math.round(M.breakStart * SR), len = Math.round((M.breakEnd - M.breakStart) * SR); let lp = 0, ph = 0;
    for (let j = 0; j < len && i0 + j < n; j++) {
      const p = j / len, x = noise();
      lp += (0.01 + 0.3 * p * p) * (x - lp);
      ph += TAU * (220 * Math.pow(4, p)) / SR;
      const v = (lp * 0.5 + Math.sin(ph) * 0.06) * p * p * 0.5;
      add(L, i0 + j, v); add(R, i0 + j, v);
    }
  }

  // UI cues
  const tone = (t0, f, dur, decay, gain, opts = {}) => {
    const i0 = Math.round(t0 * SR);
    for (let j = 0; j < dur * SR && i0 + j < n; j++) {
      const lt = j / SR, ff = opts.glide ? f * (1 + opts.glide * Math.min(1, lt / 0.08)) : f;
      const env = Math.min(1, lt / 0.004) * Math.exp(-lt * decay);
      const v = (opts.partials ?? [[1, 1]]).reduce((s, [h, a]) => s + a * Math.sin(TAU * ff * h * lt), 0) * env * gain;
      add(L, i0 + j, v * (opts.pan ?? 1)); add(R, i0 + j, v * (2 - (opts.pan ?? 1)));
      add(fxL, i0 + j, v * 0.6); add(fxR, i0 + j, v * 0.6);
    }
  };
  const bell = [[1, 1], [2.76, 0.35], [5.4, 0.12]];
  for (const [kind, t] of cues) {
    if (kind === "vote") tone(t, 880, 0.25, 18, 0.12, { glide: 0.5 });
    if (kind === "ok") { tone(t, 1318.5, 0.7, 6, 0.08, { partials: bell }); tone(t + 0.07, 1975.5, 0.7, 6, 0.06, { partials: bell }); }
    if (kind === "paid") { tone(t, 1046.5, 0.5, 9, 0.08, { partials: bell, pan: 0.8 }); tone(t + 0.06, 1568, 0.5, 9, 0.06, { partials: bell, pan: 1.2 }); }
    if (kind === "cliff") tone(t, 1760, 1.4, 3.5, 0.09, { partials: bell });
    if (kind === "node") { const step = [0, 2, 4, 7, 9, 12, 14, 16][cues.filter(([k, x]) => k === "node" && x < t).length % 8]; tone(t, 784 * Math.pow(2, step / 12), 0.4, 10, 0.07, { partials: bell }); }
    if (kind === "tick") tone(t, 1567.98, 0.12, 30, 0.07);
    if (kind === "coin") { tone(t, 2637, 0.35, 12, 0.05, { partials: bell }); tone(t + 0.07, 3520, 0.45, 10, 0.05, { partials: bell }); }
    if (kind === "bounce") {
      const i0 = Math.round(t * SR); let ph = 0;
      for (let j = 0; j < 0.35 * SR && i0 + j < n; j++) {
        const lt = j / SR; ph += TAU * (520 * Math.exp(-lt * 6) + 140) / SR;
        const v = Math.sin(ph) * Math.min(1, lt / 0.004) * Math.exp(-lt * 9) * 0.11;
        add(L, i0 + j, v); add(R, i0 + j, v); add(fxL, i0 + j, v * 0.4);
      }
    }
    if (kind === "click" || kind === "key") {
      const i0 = Math.round(t * SR), g = kind === "click" ? 0.16 : 0.05 + 0.03 * Math.abs(noise()); let prev = 0;
      for (let j = 0; j < 0.02 * SR && i0 + j < n; j++) {
        const x = noise(), hp = x - prev; prev = x;
        const v = hp * Math.exp(-j / SR * 260) * g;
        add(L, i0 + j, v); add(R, i0 + j, v);
      }
      if (kind === "click") tone(t, 2400, 0.05, 80, 0.04);
    }
    if (kind === "fail") {
      const i0 = Math.round(t * SR);
      for (let j = 0; j < 0.3 * SR && i0 + j < n; j++) {
        const lt = j / SR, env = Math.min(1, lt / 0.005) * Math.exp(-lt * 9);
        const sq = Math.sign(Math.sin(TAU * 110 * lt)) * 0.5 + Math.sign(Math.sin(TAU * 116.5 * lt)) * 0.5;
        const v = (0.6 * Math.sin(TAU * 110 * lt) + 0.25 * sq) * env * 0.12;
        add(L, i0 + j, v); add(R, i0 + j, v);
      }
    }
    if (kind === "sparkle") [2093, 2637, 3136, 4186, 5274].forEach((f, i) => tone(t + i * 0.045, f, 0.5, 9, 0.035, { pan: i % 2 ? 0.6 : 1.4 }));
    if (kind === "whoosh") {
      const pre = 0.55, post = 0.25, i0 = Math.round((t - pre) * SR); let lp = 0;
      for (let j = 0; j < (pre + post) * SR; j++) {
        const lt = j / SR, x = noise();
        const cutoff = lt < pre ? 0.02 + 0.25 * (lt / pre) ** 2 : 0.27 * Math.exp(-(lt - pre) * 12);
        lp += cutoff * (x - lp);
        const env = lt < pre ? (lt / pre) ** 2 : Math.exp(-(lt - pre) * 14);
        const v = lp * env * 0.28;
        add(L, i0 + j, v * (0.6 + 0.8 * lt / (pre + post))); add(R, i0 + j, v * (1.4 - 0.8 * lt / (pre + post)));
      }
    }
  }

  // stereo ping-pong delay (dotted eighth) on the send bus
  const d = Math.round(0.375 * SR), fb = 0.32;
  const dl = new Float32Array(n), dr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dl[i] = fxL[i] + (i >= d ? dr[i - d] * fb : 0);
    dr[i] = (i >= d ? dl[i - d] : 0);
    L[i] += (i >= d ? dl[i - d] : 0) * 0.35;
    R[i] += (i >= d ? dr[i - d] : 0) * 0.35;
  }

  // master: fades, soft clip, normalize
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 0.25) * (t > duration - 1.6 ? Math.max(0, (duration - t) / 1.6) : 1);
    L[i] = Math.tanh(L[i] * g * 1.2); R[i] = Math.tanh(R[i] * g * 1.2);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = 0.89 / (peak || 1);
  for (let i = 0; i < n; i++) { L[i] *= norm; R[i] *= norm; }
  return { L, R, sampleRate: SR };
}

export function writeWav(path, { L, R, sampleRate }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}
