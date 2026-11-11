/* Local speech-to-text with NVIDIA Parakeet (Ultra, 25 European languages) on the Neural Engine.
   Talks to native/parakeet (RoyFlowParakeet) over line-delimited JSON. No Electron imports, so it is testable. */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { cleanTranscript } from './whisper';

export const PARAKEET_DIR = 'parakeet-ultra';
/** Parakeet v3/Ultra languages (ISO 639-1); anything else goes to Whisper */
export const PARAKEET_LANGS = new Set('bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk'.split(' '));

export type ParakeetState = 'missing' | 'stopped' | 'loading' | 'downloading' | 'ready' | 'error';
export interface ParakeetStatus {
  state: ParakeetState;
  /** 0..1 while downloading */
  progress?: number;
  error?: string;
}
export interface SttResult {
  text: string;
  language?: string;
}

export class Parakeet extends EventEmitter {
  private proc: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private waiters = new Map<number, { resolve: (r: SttResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private st: ParakeetStatus;

  constructor(
    readonly bin: string,
    readonly modelsDir: string,
    private readonly log: (...a: unknown[]) => void = () => {},
  ) {
    super();
    this.st = { state: this.hasModel() ? 'stopped' : 'missing' };
  }

  hasBinary() {
    return existsSync(this.bin);
  }
  /** the downloaded bundle is complete (FluidAudio writes *.partial files until it is) */
  hasModel() {
    try {
      const dir = path.join(this.modelsDir, PARAKEET_DIR);
      const names = readdirSync(dir);
      return names.includes('Encoder.mlmodelc') && names.includes('Decoder.mlmodelc') && names.some((n) => n.startsWith('JointDecision')) && !names.some((n) => n.endsWith('.partial'));
    } catch {
      return false;
    }
  }
  get usable() {
    return this.hasBinary() && this.hasModel();
  }
  get running() {
    return this.st.state === 'ready';
  }
  get loaded() {
    return !!this.proc;
  }
  status(): ParakeetStatus {
    return { ...this.st };
  }
  private set(s: ParakeetStatus) {
    this.st = s;
    this.emit('status', this.status());
  }

  private spawnProc(): ChildProcess {
    if (this.proc) return this.proc;
    const proc = spawn(this.bin, ['--models', this.modelsDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stderr?.on('data', () => {}); // FluidAudio logs here; drain it
    createInterface({ input: proc.stdout! }).on('line', (line) => this.onLine(line));
    proc.once('exit', (code, sig) => {
      if (this.proc !== proc) return;
      this.log('[parakeet] exited', { code, sig });
      this.proc = null;
      this.ready = null;
      for (const w of this.waiters.values()) {
        clearTimeout(w.timer);
        w.reject(new Error('Parakeet stopped'));
      }
      this.waiters.clear();
      if (this.st.state !== 'error') this.set({ state: this.hasModel() ? 'stopped' : 'missing' });
    });
    return proc;
  }

  private onLine(line: string) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    switch (m.type) {
      case 'progress':
        this.set({ state: 'downloading', progress: Number(m.done) || 0 });
        break;
      case 'ready':
        this.log('[parakeet] ready', { ms: m.ms });
        this.set({ state: 'ready' });
        this.emit('ready');
        break;
      case 'missing':
        this.set({ state: 'missing' });
        break;
      case 'loadError':
        this.log('[parakeet] load failed', m.message);
        this.set({ state: 'error', error: String(m.message) });
        this.emit('loadError', new Error(String(m.message)));
        break;
      case 'result':
      case 'error': {
        const w = this.waiters.get(Number(m.id));
        if (!w) return;
        this.waiters.delete(Number(m.id));
        clearTimeout(w.timer);
        if (m.type === 'error') w.reject(new Error(String(m.message)));
        else w.resolve({ text: cleanTranscript(String(m.text ?? '')), language: m.language ? String(m.language) : undefined });
      }
    }
  }

  /** load the model (or download it first with download=true); resolves when it can transcribe */
  start(download = false): Promise<void> {
    if (this.ready) return this.ready;
    if (!this.hasBinary()) return Promise.reject(new Error(`Parakeet engine missing at ${this.bin}`));
    if (!download && !this.hasModel()) return Promise.reject(new Error('The Parakeet model is not downloaded'));
    const p = new Promise<void>((resolve, reject) => {
      const proc = this.spawnProc();
      const done = () => {
        this.off('loadError', fail);
        resolve();
      };
      const fail = (e: Error) => {
        this.off('ready', done);
        reject(e);
      };
      this.once('ready', done);
      this.once('loadError', fail);
      proc.once('exit', () => fail(new Error('Parakeet exited while loading')));
      this.set({ state: download && !this.hasModel() ? 'downloading' : 'loading', progress: 0 });
      proc.stdin?.write(JSON.stringify({ cmd: download ? 'download' : 'load' }) + '\n');
    });
    this.ready = p;
    p.catch(() => {
      if (this.ready === p) this.ready = null;
    });
    return p;
  }

  /** transcribe an audio file (any WAV the helper writes); urgent requests (final text) go before live words */
  async transcribeFile(file: string, opts: { urgent?: boolean; timeoutMs?: number } = {}): Promise<SttResult> {
    await this.start();
    const id = this.nextId++;
    return new Promise<SttResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error('Parakeet timed out'));
      }, opts.timeoutMs ?? 60_000);
      this.waiters.set(id, { resolve, reject, timer });
      this.proc?.stdin?.write(JSON.stringify({ cmd: 'transcribe', id, path: file, urgent: !!opts.urgent }) + '\n');
    });
  }

  /** unload (memory saver, quit) */
  stop() {
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    if (p && p.exitCode === null) p.kill('SIGTERM');
    this.set({ state: this.hasModel() ? 'stopped' : 'missing' });
  }
}
