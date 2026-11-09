/* WAV reading and resampling for the Whisper engine (pure, no Electron imports: covered by vitest).
   The helper records the dictation at the device rate (often 48 kHz, 1-2 channels, Int16); whisper-server only
   accepts 16 kHz mono 16-bit PCM WAV, so main converts it here before posting it. */

export interface PcmAudio {
  sampleRate: number;
  /** mono samples in [-1, 1] */
  samples: Float32Array;
}

/** parse a RIFF/WAVE file (PCM Int16/Int24/Int32, Float32, WAVE_FORMAT_EXTENSIBLE) and mix it down to mono */
export function parseWav(buf: Uint8Array): PcmAudio {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const rate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the sub-format GUID
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels, rate, bits };
    } else if (id === 'data') {
      dataOff = body;
      // a WAV still being written (or truncated) may claim more than is there
      dataLen = Math.min(size, buf.length - body);
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV has no fmt chunk');
  if (dataOff < 0) throw new Error('WAV has no data chunk');
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  if (channels < 1 || !rate) throw new Error('Bad WAV header');
  const frames = Math.floor(dataLen / (bytes * channels));
  const read: (off: number) => number =
    format === 3 && bits === 32
      ? (off) => dv.getFloat32(off, true)
      : format === 3 && bits === 64
        ? (off) => dv.getFloat64(off, true)
        : format === 1 && bits === 16
          ? (off) => dv.getInt16(off, true) / 32768
          : format === 1 && bits === 24
            ? (off) => (((buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)) << 8) >> 8) / 8388608
            : format === 1 && bits === 32
              ? (off) => dv.getInt32(off, true) / 2147483648
              : format === 1 && bits === 8
                ? (off) => (buf[off] - 128) / 128
                : () => {
                    throw new Error(`Unsupported WAV format ${format}/${bits}-bit`);
                  };
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = dataOff + i * bytes * channels;
    for (let c = 0; c < channels; c++) sum += read(base + c * bytes);
    samples[i] = sum / channels;
  }
  return { sampleRate: rate, samples };
}

/** resample mono audio. Downsampling averages each output sample's input window (a box low-pass, enough to keep
    speech free of aliasing), upsampling interpolates linearly. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = i * ratio;
      const b = Math.min(samples.length, a + ratio);
      let sum = 0;
      let w = 0;
      for (let j = Math.floor(a); j < b; j++) {
        // partial weight for the window's edge samples
        const wt = Math.min(j + 1, b) - Math.max(j, a);
        if (wt <= 0) continue;
        sum += samples[j] * wt;
        w += wt;
      }
      out[i] = w ? sum / w : 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const f = x - j;
      const s0 = samples[j] ?? 0;
      const s1 = samples[j + 1] ?? s0;
      out[i] = s0 + (s1 - s0) * f;
    }
  }
  return out;
}

export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // same scale as parseWav (÷32768), so Int16 audio round-trips exactly
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768)));
  }
  return out;
}

/** mono Int16 PCM -> WAV bytes */
export function encodeWav(pcm: Int16Array, rate = 16000): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.byteLength, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

/** any WAV the helper wrote -> the 16 kHz mono Int16 WAV whisper-server wants, plus its duration */
export function toWhisperWav(buf: Uint8Array): { wav: Uint8Array; seconds: number } {
  const a = parseWav(buf);
  const mono16k = resample(a.samples, a.sampleRate, 16000);
  return { wav: encodeWav(toInt16(mono16k), 16000), seconds: mono16k.length / 16000 };
}
