import { describe, expect, it } from 'vitest';
import { encodeWav, parseWav, resample, toInt16, toWhisperWav } from '../electron/wav';

/** a WAV like AVAudioFile writes: optional extra chunk before data, n channels, Int16 or Float32 */
function makeWav(samples: number[][], rate: number, opts: { float?: boolean; extensible?: boolean; junk?: boolean } = {}) {
  const ch = samples.length;
  const frames = samples[0].length;
  const bytes = opts.float ? 4 : 2;
  const fmtSize = opts.extensible ? 40 : 16;
  const junk = opts.junk ? 12 : 0;
  const dataLen = frames * ch * bytes;
  const buf = new Uint8Array(12 + 8 + fmtSize + (junk ? 8 + junk : 0) + 8 + dataLen);
  const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, buf.length - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, fmtSize, true);
  dv.setUint16(20, opts.extensible ? 0xfffe : opts.float ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * ch * bytes, true);
  dv.setUint16(32, ch * bytes, true);
  dv.setUint16(34, bytes * 8, true);
  if (opts.extensible) {
    dv.setUint16(36, 22, true);
    dv.setUint16(44, opts.float ? 3 : 1, true); // sub-format GUID starts with the format tag
  }
  let o = 20 + fmtSize;
  if (junk) {
    w(o, 'FLLR');
    dv.setUint32(o + 4, junk, true);
    o += 8 + junk;
  }
  w(o, 'data');
  dv.setUint32(o + 4, dataLen, true);
  o += 8;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      if (opts.float) dv.setFloat32(o, samples[c][i], true);
      else dv.setInt16(o, Math.round(samples[c][i] * 32767), true);
      o += bytes;
    }
  return buf;
}

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) => Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe('WAV parsing', () => {
  it('reads Int16 mono', () => {
    const a = parseWav(makeWav([[0, 0.5, -0.5, 1]], 16000));
    expect(a.sampleRate).toBe(16000);
    expect([...a.samples].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 1]);
  });
  it('mixes stereo down to mono and skips extra chunks', () => {
    const a = parseWav(makeWav([[0.5, 0.5], [-0.5, 0.1]], 48000, { junk: true }));
    expect(a.samples.length).toBe(2);
    expect(a.samples[0]).toBeCloseTo(0, 3);
    expect(a.samples[1]).toBeCloseTo(0.3, 3);
  });
  it('reads Float32 and WAVE_FORMAT_EXTENSIBLE', () => {
    expect(parseWav(makeWav([[0.25, -0.75]], 44100, { float: true })).samples[1]).toBeCloseTo(-0.75, 5);
    expect(parseWav(makeWav([[0.25, -0.75]], 48000, { extensible: true })).samples[0]).toBeCloseTo(0.25, 3);
  });
  it('tolerates a data size larger than the file (recording still open)', () => {
    const b = makeWav([[0.1, 0.2, 0.3]], 16000);
    const dv = new DataView(b.buffer);
    dv.setUint32(40, 1_000_000, true);
    expect(parseWav(b).samples.length).toBe(3);
  });
  it('rejects non-WAV data', () => {
    expect(() => parseWav(new TextEncoder().encode('not a wav file at all'))).toThrow(/WAV/);
  });
});

describe('resampling to 16 kHz', () => {
  it('keeps the duration', () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resample(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    expect(resample(new Float32Array(8000), 8000, 16000).length).toBe(16000);
  });
  it('keeps a speech-band tone and its level', () => {
    const out = resample(Float32Array.from(sine(440, 48000, 0.5)), 48000, 16000);
    const rms = Math.sqrt(out.reduce((n, x) => n + x * x, 0) / out.length);
    expect(rms).toBeGreaterThan(0.33);
    expect(rms).toBeLessThan(0.37); // 0.5 / √2
    // zero crossings ≈ 2 × 440 Hz × 0.5 s
    let z = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 !== out[i] < 0) z++;
    expect(Math.abs(z - 440)).toBeLessThan(6);
  });
  it('damps content above the new Nyquist (anti-aliasing)', () => {
    const out = resample(Float32Array.from(sine(15000, 48000, 0.2)), 48000, 16000);
    const rms = Math.sqrt(out.reduce((n, x) => n + x * x, 0) / out.length);
    expect(rms).toBeLessThan(0.1);
  });
  it('is the identity at the same rate', () => {
    const x = Float32Array.from([0.1, 0.2]);
    expect(resample(x, 16000, 16000)).toBe(x);
  });
});

describe('whisper WAV', () => {
  it('clips to Int16', () => {
    expect([...toInt16(Float32Array.from([2, -2, 0]))]).toEqual([32767, -32768, 0]);
  });
  it('turns a 48 kHz stereo recording into 16 kHz mono Int16 PCM', () => {
    const src = makeWav([sine(300, 48000, 1), sine(300, 48000, 1)], 48000);
    const { wav, seconds } = toWhisperWav(src);
    expect(seconds).toBeCloseTo(1, 2);
    const dv = new DataView(wav.buffer, wav.byteOffset);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(16000);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(16000 * 2);
    const back = parseWav(wav);
    expect(back.sampleRate).toBe(16000);
    expect(back.samples.length).toBe(16000);
  });
  it('round-trips encodeWav / parseWav', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32767]);
    expect([...toInt16(parseWav(encodeWav(pcm)).samples)]).toEqual([0, 1000, -1000, 32767]);
  });
});
