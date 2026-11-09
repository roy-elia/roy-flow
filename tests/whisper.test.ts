import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTranscript, COREML_NAME, migrateModels, postInference, WhisperServer } from '../electron/whisper';
import { encodeWav } from '../electron/wav';

/** a mock whisper-server: records each /inference multipart request and answers with a canned transcript */
let server: http.Server;
let base = '';
let reply: { status: number; body: unknown } = { status: 200, body: { text: ' Hello from Whisper. ' } };
const seen: { contentType: string; body: string }[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/inference' && req.method === 'POST') seen.push({ contentType: String(req.headers['content-type']), body: Buffer.concat(chunks).toString('latin1') });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const wav = encodeWav(Int16Array.from({ length: 1600 }, (_, i) => Math.round(8000 * Math.sin(i / 5))));

describe('whisper transcribe client', () => {
  it('posts a multipart WAV with language and the glossary prompt', async () => {
    seen.length = 0;
    reply = { status: 200, body: { text: ' Hello from   Whisper. ' } };
    const text = await postInference(base, wav, { language: 'en', prompt: 'Glossary: RoyFlow.' });
    expect(text).toBe('Hello from Whisper.');
    expect(seen).toHaveLength(1);
    const { contentType, body } = seen[0];
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(body).toContain('name="file"; filename="audio.wav"');
    expect(body).toContain('Content-Type: audio/wav');
    expect(body).toContain('RIFF');
    expect(body).toMatch(/name="language"\r\n\r\nen\r\n/);
    expect(body).toMatch(/name="prompt"\r\n\r\nGlossary: RoyFlow\.\r\n/);
    expect(body).toMatch(/name="response_format"\r\n\r\njson\r\n/);
    expect(body).toMatch(/name="temperature"\r\n\r\n0\r\n/);
  });
  it('omits an empty prompt and defaults to auto language', async () => {
    seen.length = 0;
    await postInference(base, wav);
    expect(seen[0].body).not.toContain('name="prompt"');
    expect(seen[0].body).toMatch(/name="language"\r\n\r\nauto\r\n/);
  });
  it('drops what Whisper says for silence', async () => {
    for (const t of ['[BLANK_AUDIO]', ' (music) ', 'Thank you.', 'you', 'Thanks for watching!']) {
      reply = { status: 200, body: { text: t } };
      expect(await postInference(base, wav)).toBe('');
    }
    expect(cleanTranscript('[BLANK_AUDIO] Hello')).toBe('Hello');
    expect(cleanTranscript('Thank you for the notes.')).toBe('Thank you for the notes.');
  });
  it('reports HTTP and server errors', async () => {
    reply = { status: 500, body: {} };
    await expect(postInference(base, wav)).rejects.toThrow(/HTTP 500/);
    reply = { status: 200, body: { error: 'failed to read audio' } };
    await expect(postInference(base, wav)).rejects.toThrow(/failed to read audio/);
  });
});

describe('WhisperServer', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'royflow-whisper-'));
  it('reports a missing model and binary', () => {
    const w = new WhisperServer({ bin: path.join(tmp, 'nope'), modelsDir: path.join(tmp, 'models'), stateFile: path.join(tmp, 's.json') });
    const st = w.status();
    expect(st).toMatchObject({ model: 'missing', binary: false, coreml: false, server: 'stopped' });
    expect(w.usable).toBe(false);
  });
  it('fails to start without a binary instead of hanging', async () => {
    const w = new WhisperServer({ bin: path.join(tmp, 'nope'), modelsDir: tmp, stateFile: path.join(tmp, 's.json') });
    await expect(w.start()).rejects.toThrow(/missing/);
    expect(w.status().server).toBe('error');
  });
  it('names the Core ML encoder like whisper.cpp', () => {
    expect(COREML_NAME('ggml-large-v3-turbo-q5_0.bin')).toBe('ggml-large-v3-turbo-encoder.mlmodelc');
  });
});

describe('model migration from RoyFlow', () => {
  it('moves the model and Core ML encoder when this app has none', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'royflow-models-'));
    const from = path.join(root, 'RoyFlow/models');
    const to = path.join(root, 'Roy Flow/models');
    mkdirSync(path.join(from, 'ggml-large-v3-turbo-encoder.mlmodelc'), { recursive: true });
    writeFileSync(path.join(from, 'ggml-large-v3-turbo-encoder.mlmodelc', 'model.mil'), 'x');
    writeFileSync(path.join(from, 'ggml-large-v3-turbo-q5_0.bin'), 'model');
    writeFileSync(path.join(from, 'ggml-large-v3-turbo-q5_0.bin.part'), 'partial');
    expect(migrateModels(from, to).sort()).toEqual(['ggml-large-v3-turbo-encoder.mlmodelc', 'ggml-large-v3-turbo-q5_0.bin']);
    expect(existsSync(path.join(to, 'ggml-large-v3-turbo-encoder.mlmodelc', 'model.mil'))).toBe(true);
    expect(readdirSync(from)).toEqual(['ggml-large-v3-turbo-q5_0.bin.part']);
    // already there: nothing to do
    expect(migrateModels(from, to)).toEqual([]);
  });
  it('does nothing when RoyFlow has no models', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'royflow-models-'));
    expect(migrateModels(path.join(root, 'a'), path.join(root, 'b'))).toEqual([]);
    expect(existsSync(path.join(root, 'b'))).toBe(false);
  });
});
