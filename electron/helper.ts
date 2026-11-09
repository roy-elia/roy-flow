import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';

export interface HelperMessage {
  type: string;
  [k: string]: unknown;
}

/** Owns the RoyFlowHelper child process and its line-delimited JSON protocol. */
export class Helper extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  constructor(readonly bin: string) {
    super();
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get available() {
    return existsSync(this.bin);
  }

  private ensure(): ChildProcessWithoutNullStreams | null {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    if (!this.available) return null;
    const p = spawn(this.bin, [], { stdio: 'pipe' });
    this.proc = p;
    this.buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        try {
          this.emit('message', JSON.parse(line) as HelperMessage);
        } catch {
          console.warn('[helper] bad line', line.slice(0, 120));
        }
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => console.warn('[helper]', d.trim()));
    p.on('exit', (code, sig) => {
      if (this.proc === p) this.proc = null;
      this.emit('exit', code, sig);
    });
    p.on('error', (e) => this.emit('message', { type: 'error', code: 'spawn', message: String(e) }));
    return p;
  }

  send(obj: Record<string, unknown>): boolean {
    const p = this.ensure();
    if (!p) return false;
    p.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  /** send a command and resolve with the first reply of the given type */
  request<T extends HelperMessage>(obj: Record<string, unknown>, type: string, timeoutMs = 2000): Promise<T | null> {
    return new Promise((resolve) => {
      const onMsg = (m: HelperMessage) => {
        if (m.type !== type) return;
        cleanup();
        resolve(m as T);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.off('message', onMsg);
      };
      this.on('message', onMsg);
      if (!this.send(obj)) {
        cleanup();
        resolve(null);
      }
    });
  }

  kill() {
    if (!this.proc) return;
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      /* already gone */
    }
    this.proc = null;
  }
}
