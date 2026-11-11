// Synthesises Roy Flow's own UI sounds (original, generated here) into resources/sounds/*.wav (16-bit mono 44.1 kHz).
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 44100;
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** soft bell partial stack with a quick attack and exponential decay */
function tone(out, start, freq, dur, gain) {
  const s0 = Math.round(start * RATE);
  const n = Math.round(dur * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 7 / dur);
    const v = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 3.01 * t);
    out[s0 + i] = (out[s0 + i] || 0) + v * env * gain;
  }
}
function render(notes, length) {
  const out = new Array(Math.round(length * RATE)).fill(0);
  for (const [start, freq, dur, gain] of notes) tone(out, start, freq, dur, gain);
  return out;
}
mkdirSync('resources/sounds', { recursive: true });
const sounds = {
  start: render([[0, 587.33, 0.22, 0.28], [0.07, 880, 0.3, 0.26]], 0.42), // D5 -> A5, rising
  stop: render([[0, 880, 0.2, 0.24], [0.07, 659.25, 0.32, 0.26]], 0.44), // A5 -> E5, settling
  cancel: render([[0, 392, 0.18, 0.22], [0.06, 329.63, 0.24, 0.2]], 0.34), // low, short
  notify: render([[0, 783.99, 0.25, 0.22], [0.09, 1046.5, 0.25, 0.2], [0.18, 1318.5, 0.4, 0.18]], 0.62),
};
for (const [name, s] of Object.entries(sounds)) writeFileSync(`resources/sounds/${name}.wav`, wav(s));
// more sound styles (Settings › Sound), like Wispr's choice of sound sets: each in resources/sounds/<style>/
const styles = {
  soft: {
    start: render([[0, 440, 0.3, 0.16], [0.09, 554.37, 0.4, 0.14]], 0.55),
    stop: render([[0, 554.37, 0.3, 0.14], [0.09, 440, 0.42, 0.15]], 0.58),
    cancel: render([[0, 329.63, 0.3, 0.13]], 0.36),
    notify: render([[0, 523.25, 0.35, 0.14], [0.12, 659.25, 0.45, 0.12]], 0.65),
  },
  click: {
    start: render([[0, 1760, 0.035, 0.3]], 0.06),
    stop: render([[0, 1318.5, 0.035, 0.3]], 0.06),
    cancel: render([[0, 880, 0.04, 0.26], [0.05, 880, 0.04, 0.2]], 0.12),
    notify: render([[0, 1567.98, 0.05, 0.26], [0.07, 2093, 0.06, 0.22]], 0.16),
  },
  chime: {
    start: render([[0, 1046.5, 0.5, 0.18], [0.05, 1567.98, 0.6, 0.12]], 0.75),
    stop: render([[0, 1567.98, 0.5, 0.14], [0.05, 1046.5, 0.6, 0.16]], 0.75),
    cancel: render([[0, 698.46, 0.4, 0.15]], 0.5),
    notify: render([[0, 1318.5, 0.5, 0.15], [0.1, 1760, 0.6, 0.13], [0.2, 2093, 0.7, 0.1]], 0.95),
  },
};
for (const [style, set] of Object.entries(styles)) {
  mkdirSync(`resources/sounds/${style}`, { recursive: true });
  for (const [name, s] of Object.entries(set)) writeFileSync(`resources/sounds/${style}/${name}.wav`, wav(s));
}
console.log('wrote resources/sounds/{start,stop,cancel,notify}.wav and the soft, click and chime styles');
