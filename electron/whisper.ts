/* Local speech-to-text through whisper.cpp's HTTP server (ported from RoyFlow's speech/whisper.js).
   whisper-server is kept running with the model loaded so each dictation only pays inference time; the memory saver
   in main stops it after some idle minutes and a dictation key-down starts it again (≈1.6 s once compiled).
   No Electron imports here, so the client is testable with a mock server. */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { WhisperStatus } from '../src/shared/ipc';

export const DEFAULT_MODEL = 'ggml-large-v3-turbo-q5_0.bin';
export const MODEL_URL = (name: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
/** ggml-large-v3-turbo-q5_0.bin -> ggml-large-v3-turbo-encoder.mlmodelc */
export const COREML_NAME = (model: string) => model.replace(/\.bin$/, '').replace(/-q\d_\d$/, '') + '-encoder.mlmodelc';

/** things Whisper emits for silence/noise that must never be pasted */
export const NOISE = /^\s*(\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]|\((music|silence|inaudible)[^)]*\)|thank you\.?|thanks for watching!?|you)\s*$/i;

/** the first launch after a model download compiles the Core ML encoder for the Neural Engine: minutes */
const FIRST_START_MS = 15 * 60_000;

export function cleanTranscript(text: string): string {
  const clean = String(text ?? '')
    .replace(/\[BLANK_AUDIO\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NOISE.test(clean) ? '' : clean;
}

/** POST a 16 kHz mono WAV to a running whisper-server and return the cleaned transcript */
export async function postInference(baseUrl: string, wav: Uint8Array, opts: { language?: string; prompt?: string; timeoutMs?: number } = {}): Promise<string> {
  return (await postInferenceDetailed(baseUrl, wav, opts, false)).text;
}

/** like postInference, but also returns the language Whisper detected ("french", "english"…) when asked to */
export async function postInferenceDetailed(
  baseUrl: string,
  wav: Uint8Array,
  opts: { language?: string; prompt?: string; timeoutMs?: number } = {},
  verbose = true,
): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  form.append('file', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  form.append('language', opts.language || 'auto');
  form.append('temperature', '0');
  if (opts.prompt) form.append('prompt', opts.prompt);
  const r = await fetch(`${baseUrl}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(Math.max(1000, Math.round(opts.timeoutMs ?? 180_000))) });
  if (!r.ok) throw new Error(`whisper-server HTTP ${r.status}`);
  const j = (await r.json()) as { text?: string; error?: string; language?: string };
  if (j.error) throw new Error(`whisper-server: ${j.error}`);
  return { text: cleanTranscript(j.text ?? ''), language: typeof j.language === 'string' ? j.language : undefined };
}

/** move the models RoyFlow downloaded (same volume: a rename, no copy) when this app has none yet.
    Returns the names moved; never throws. */
export function migrateModels(fromDir: string, toDir: string, model = DEFAULT_MODEL, log: (...a: unknown[]) => void = () => {}): string[] {
  try {
    if (existsSync(path.join(toDir, model)) || !existsSync(path.join(fromDir, model))) return [];
    mkdirSync(toDir, { recursive: true });
    const moved: string[] = [];
    for (const name of readdirSync(fromDir)) {
      if (!name.startsWith('ggml-') || name.endsWith('.part') || existsSync(path.join(toDir, name))) continue;
      renameSync(path.join(fromDir, name), path.join(toDir, name));
      moved.push(name);
    }
    log('[whisper] moved models', { from: fromDir, to: toDir, moved });
    return moved;
  } catch (e) {
    log('[whisper] could not move models', String(e));
    return [];
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

/** stream a URL to disk with progress; atomic rename at the end */
async function download(url: string, dest: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  let done = 0;
  let last = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      done += chunk.length;
      if (Date.now() - last > 250) {
        last = Date.now();
        onProgress(done, total);
      }
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    rmSync(part, { force: true });
    throw e;
  }
  renameSync(part, dest);
  onProgress(total || done, total || done);
}

export interface WhisperOptions {
  bin: string;
  modelsDir: string;
  /** remembers which server binary + model already finished its one-time Core ML compile */
  stateFile: string;
  log?: (...parts: unknown[]) => void;
  model?: string;
}

/** Owns the whisper-server child process. Emits 'status' (WhisperStatus) whenever something changes. */
export class WhisperServer extends EventEmitter {
  readonly bin: string;
  readonly modelsDir: string;
  readonly model: string;
  private readonly stateFile: string;
  private readonly log: (...parts: unknown[]) => void;
  private proc: ChildProcess | null = null;
  private port = 0;
  private ready: Promise<void> | null = null;
  private downloading: Promise<void> | null = null;
  private dl: WhisperStatus['download'];
  private server: WhisperStatus['server'] = 'stopped';
  private error: string | undefined;
  private stderrTail = '';

  constructor(o: WhisperOptions) {
    super();
    this.bin = o.bin;
    this.modelsDir = o.modelsDir;
    this.stateFile = o.stateFile;
    this.model = o.model ?? DEFAULT_MODEL;
    this.log = o.log ?? (() => {});
  }

  get modelPath() {
    return path.join(this.modelsDir, this.model);
  }
  hasModel() {
    return existsSync(this.modelPath);
  }
  hasCoreML() {
    return existsSync(path.join(this.modelsDir, COREML_NAME(this.model)));
  }
  hasBinary() {
    return existsSync(this.bin);
  }
  /** can dictations use Whisper right now (or after a quick reload)? */
  get usable() {
    return this.hasBinary() && this.hasModel() && !this.downloading;
  }
  get running() {
    return this.server === 'running';
  }
  get loaded() {
    return !!this.proc;
  }
  /** true while the server is doing its first (slow) Core ML compile for this binary + model */
  get preparing() {
    return this.server === 'preparing';
  }

  status(): WhisperStatus {
    return {
      model: this.downloading ? 'downloading' : this.hasModel() ? 'ready' : 'missing',
      coreml: this.hasCoreML(),
      binary: this.hasBinary(),
      server: this.server,
      download: this.downloading ? this.dl : undefined,
      error: this.error,
      modelsDir: this.modelsDir,
    };
  }
  private push(p: Partial<{ server: WhisperStatus['server']; error: string | undefined }> = {}) {
    if (p.server) this.server = p.server;
    if ('error' in p) this.error = p.error;
    this.emit('status', this.status());
  }

  /** identity of "this binary with this model": the Core ML compile cache is tied to it */
  private warmKey() {
    try {
      const b = statSync(this.bin);
      return `${this.bin}|${b.size}|${Math.round(b.mtimeMs)}|${this.model}`;
    } catch {
      return '';
    }
  }
  /** has this binary + model started before (so a start takes seconds, not minutes)? */
  compiledBefore(): boolean {
    try {
      return (JSON.parse(readFileSync(this.stateFile, 'utf8')) as { warm?: string[] }).warm?.includes(this.warmKey()) ?? false;
    } catch {
      return false;
    }
  }
  private markCompiled() {
    try {
      let warm: string[] = [];
      try {
        warm = (JSON.parse(readFileSync(this.stateFile, 'utf8')) as { warm?: string[] }).warm ?? [];
      } catch {
        /* first time */
      }
      const k = this.warmKey();
      if (!warm.includes(k)) writeFileSync(this.stateFile, JSON.stringify({ warm: [...warm.slice(-4), k] }));
    } catch (e) {
      this.log('[whisper] could not save warm state', String(e));
    }
  }

  /** start (or reuse) the server; resolves once it answers HTTP */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    const first = !this.compiledBefore();
    const p = (async () => {
      if (!this.hasBinary()) throw new Error(`whisper-server missing at ${this.bin}`);
      if (!this.hasModel()) throw new Error('The Whisper speech model is not downloaded');
      this.push({ server: first ? 'preparing' : 'starting', error: undefined });
      this.port = await freePort();
      const threads = Math.max(2, Math.min(8, os.cpus().length - 2));
      const t0 = Date.now();
      const proc = spawn(this.bin, ['-m', this.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-t', String(threads), '--no-timestamps'], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc = proc;
      this.stderrTail = '';
      const keep = (d: Buffer) => {
        this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
      };
      proc.stderr?.on('data', keep);
      proc.stdout?.on('data', keep);
      proc.once('exit', (code, sig) => {
        if (this.proc !== proc) return;
        this.log('[whisper] server exited', { code, sig });
        this.proc = null;
        this.ready = null;
        this.push({ server: 'stopped' });
      });
      this.log('[whisper] starting', { port: this.port, threads, firstCompile: first, coreml: this.hasCoreML() });
      await this.waitUntilUp(proc, first ? FIRST_START_MS : 3 * 60_000);
      this.markCompiled();
      this.log('[whisper] ready', { port: this.port, ms: Date.now() - t0 });
      this.push({ server: 'running' });
    })();
    this.ready = p;
    p.catch((e: Error) => {
      if (this.ready !== p) return;
      this.log('[whisper] start failed', e.message, this.stderrTail.split('\n').slice(-4).join(' | '));
      this.ready = null;
      this.killProc();
      this.push({ server: 'error', error: e.message });
    });
    return p;
  }

  private async waitUntilUp(proc: ChildProcess, ms: number) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.proc !== proc || proc.exitCode !== null) throw new Error('whisper-server exited during startup');
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) return;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('whisper-server did not start in time');
  }

  /** transcribe a 16 kHz mono WAV (see wav.ts toWhisperWav) */
  async transcribe(wav: Uint8Array, opts: { language?: string; prompt?: string; timeoutMs?: number } = {}): Promise<string> {
    await this.start();
    return postInference(`http://127.0.0.1:${this.port}`, wav, opts);
  }

  /** transcribe and report the detected language (meetings, language "auto") */
  async transcribeDetailed(wav: Uint8Array, opts: { language?: string; prompt?: string; timeoutMs?: number } = {}): Promise<{ text: string; language?: string }> {
    await this.start();
    return postInferenceDetailed(`http://127.0.0.1:${this.port}`, wav, opts);
  }

  private killProc() {
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode === null) p.kill('SIGTERM');
  }

  /** unload the model (memory saver, quit) */
  stop() {
    const had = !!this.proc;
    this.ready = null;
    this.killProc();
    if (had || this.server !== 'stopped') this.push({ server: 'stopped', error: undefined });
  }

  /** download the ggml model and (Apple silicon) its Core ML encoder; restarts the server afterwards */
  downloadModel(): Promise<void> {
    if (this.downloading) return this.downloading;
    const d = (async () => {
      mkdirSync(this.modelsDir, { recursive: true });
      const report = (phase: 'model' | 'coreml') => (done: number, total: number) => {
        this.dl = { phase, done, total };
        this.push();
      };
      if (!this.hasModel()) await download(MODEL_URL(this.model), this.modelPath, report('model'));
      if (process.arch === 'arm64' && !this.hasCoreML()) {
        const zipName = `${COREML_NAME(this.model)}.zip`;
        const zip = path.join(this.modelsDir, zipName);
        try {
          await download(MODEL_URL(zipName), zip, report('coreml'));
          await new Promise<void>((r, j) => execFile('/usr/bin/ditto', ['-x', '-k', zip, this.modelsDir], (e) => (e ? j(e) : r())));
        } catch (e) {
          this.log('[whisper] Core ML encoder unavailable, using Metal:', String(e));
        } finally {
          rmSync(zip, { force: true });
        }
      }
    })();
    this.downloading = d;
    this.dl = { phase: 'model', done: 0, total: 0 };
    this.push();
    return d
      .then(
        () => {
          this.downloading = null;
          this.dl = undefined;
          this.push({ error: undefined });
          this.stop();
          void this.start().catch(() => {});
        },
        (e: Error) => {
          this.downloading = null;
          this.dl = undefined;
          this.push({ error: `Download failed: ${e.message}` });
          throw e;
        },
      );
  }
}
