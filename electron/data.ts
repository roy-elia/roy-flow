/* The app's data store: one JSON file in the app data folder (~/Library/Application Support/Roy Flow/data.json).
   Renderers hold a copy and send top-level key patches; main merges, persists, and fans changes out to the
   other windows. Meetings are mirrored to meetings-mcp.json, which is all the MCP server can read. */
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { State } from '../src/shared/types';

export const dataDir = () => app.getPath('userData');
export const dataFile = () => path.join(dataDir(), 'data.json');
export const meetingsFile = () => path.join(dataDir(), 'meetings-mcp.json');
export const audioDir = () => path.join(dataDir(), 'audio');

let data: Partial<State> | null = null;
let saveTimer: NodeJS.Timeout | undefined;

export function loadData(): Partial<State> | null {
  if (data) return data;
  try {
    data = JSON.parse(readFileSync(dataFile(), 'utf8')) as Partial<State>;
  } catch {
    data = null;
  }
  return data;
}
export const getData = (): Partial<State> => data ?? {};
export const hasData = () => !!data;

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

export function saveNow() {
  clearTimeout(saveTimer);
  if (!data) return;
  try {
    writeAtomic(dataFile(), JSON.stringify(data));
  } catch (e) {
    console.warn('could not save data', e);
  }
}

/** merge top-level keys; returns the previous state */
export function patchData(p: Partial<State>): Partial<State> {
  const prev = getData();
  data = { ...prev, ...p };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
  if ('meetings' in p) writeMeetingsExport();
  return prev;
}

export function writeMeetingsExport() {
  try {
    const meetings = (getData().meetings ?? []).filter((m) => !m.demo);
    writeAtomic(meetingsFile(), JSON.stringify({ updated: Date.now(), meetings }));
  } catch (e) {
    console.warn('could not write meetings export', e);
  }
}

/** remove everything this app stored on disk (not the window frame or the API key) */
export function wipeAll() {
  clearTimeout(saveTimer);
  data = null;
  for (const f of [dataFile(), meetingsFile(), path.join(dataDir(), 'snapshot.json')]) rmSync(f, { force: true });
  rmSync(audioDir(), { recursive: true, force: true });
}

/* ------------------------------------------------------------------ dictation audio */
export const AUDIO_CAP_BYTES = 300 * 1024 * 1024;
export const AUDIO_MAX_FILES = 400;

export function audioPath(file: string): string | null {
  if (!/^[\w-]+\.wav$/.test(file)) return null;
  return path.join(audioDir(), file);
}

/** delete WAVs no history item points at (older than a minute), then enforce the size/count cap. Returns files dropped by the cap. */
export function pruneAudio(referenced: Set<string>): string[] {
  const dir = audioDir();
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => {
      const st = statSync(path.join(dir, f));
      return { f, size: st.size, mtime: st.mtimeMs };
    });
  const keep = [];
  for (const x of files) {
    if (!referenced.has(x.f) && now - x.mtime > 60_000) rmSync(path.join(dir, x.f), { force: true });
    else keep.push(x);
  }
  keep.sort((a, b) => a.mtime - b.mtime);
  let total = keep.reduce((n, x) => n + x.size, 0);
  const dropped: string[] = [];
  while (keep.length && (total > AUDIO_CAP_BYTES || keep.length > AUDIO_MAX_FILES)) {
    const x = keep.shift()!;
    rmSync(path.join(dir, x.f), { force: true });
    total -= x.size;
    dropped.push(x.f);
  }
  return dropped;
}
