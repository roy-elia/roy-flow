import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Parakeet, PARAKEET_DIR, PARAKEET_LANGS } from '../electron/parakeet';

// a stand-in for RoyFlowParakeet that speaks the same line protocol
const FAKE = `#!/usr/bin/env node
const rl = require('readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.cmd === 'load' || m.cmd === 'download') { out({ type: 'progress', done: 0.5 }); out({ type: 'ready', ms: 5 }); }
  if (m.cmd === 'transcribe') {
    if (m.path.endsWith('bad.wav')) out({ type: 'error', id: m.id, message: 'cannot read' });
    else out({ type: 'result', id: m.id, text: ' Bonjour tout le monde. ', language: 'french', ms: 3 });
  }
});
`;

function setup(withModel: boolean) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-'));
  const bin = path.join(dir, 'fake');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  const models = path.join(dir, 'models');
  if (withModel) for (const n of ['Encoder.mlmodelc', 'Decoder.mlmodelc', 'JointDecisionv3.mlmodelc']) mkdirSync(path.join(models, PARAKEET_DIR, n), { recursive: true });
  return new Parakeet(bin, models);
}

let p: Parakeet | null = null;
afterEach(() => p?.stop());

describe('Parakeet engine client', () => {
  it('needs the model before it can start', async () => {
    p = setup(false);
    expect(p.status().state).toBe('missing');
    await expect(p.start()).rejects.toThrow(/not downloaded/);
  });

  it('loads, transcribes and reports the language', async () => {
    p = setup(true);
    expect(p.usable).toBe(true);
    const r = await p.transcribeFile('/tmp/x.wav', { urgent: true });
    expect(r).toEqual({ text: 'Bonjour tout le monde.', language: 'french' });
    expect(p.running).toBe(true);
  });

  it('rejects a failed request and keeps working', async () => {
    p = setup(true);
    await expect(p.transcribeFile('/tmp/bad.wav')).rejects.toThrow('cannot read');
    expect((await p.transcribeFile('/tmp/ok.wav')).text).toBe('Bonjour tout le monde.');
  });

  it('covers English and French but not Japanese', () => {
    expect(PARAKEET_LANGS.has('en') && PARAKEET_LANGS.has('fr')).toBe(true);
    expect(PARAKEET_LANGS.has('ja')).toBe(false);
  });
});

describe('Parakeet load watchdog', () => {
  it('restarts an engine that never answers', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pk-'));
    // first run hangs (never says ready); the second run answers
    const flag = path.join(dir, 'flag');
    const bin = path.join(dir, 'fake');
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const hang = !fs.existsSync(${JSON.stringify(flag)});
fs.writeFileSync(${JSON.stringify(flag)}, '1');
require('readline').createInterface({ input: process.stdin }).on('line', () => { if (!hang) process.stdout.write(JSON.stringify({ type: 'ready', ms: 1 }) + '\\n'); });
`);
    chmodSync(bin, 0o755);
    for (const n of ['Encoder.mlmodelc', 'Decoder.mlmodelc', 'JointDecisionv3.mlmodelc']) mkdirSync(path.join(dir, 'm', PARAKEET_DIR, n), { recursive: true });
    p = new Parakeet(bin, path.join(dir, 'm'), () => {}, 1500);
    await p.start();
    expect(p.running).toBe(true);
  });
});
