/* Roy Flow: Electron main process.
   Windows follow analysis/wispr-flow/REPORT.md Appendix A §1: a hub window (1350x850, min 1140x750,
   hidden title bar with native traffic lights at 16,15) and a transparent, frameless, always-on-top,
   click-through "status" panel that hosts the Flow Bar; plus a Scratchpad window.
   Dictation, global hotkeys (CGEventTap), paste/copy, mute, sounds and calendar run in the native helper. */
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, session as electronSession, shell, Tray, type Rectangle, type WebContents } from 'electron';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Helper, type HelperMessage } from './helper';
import { buildAppMenu, buildTrayMenu, type MenuContext, type MenuSnapshot } from './menus';
import * as ai from './ai';
import { audioDir, audioPath, getData, hasData, loadData, patchData, pruneAudio, saveNow, wipeAll } from './data';
import { rmSync } from 'node:fs';
import { addToClaude, mcpInfo, startMcpServer, stopMcpServer } from './mcpServer';
import { applyDictionary, applySnippets, changedWords, cleanUp, styleText, wordCount } from '../src/shared/textPipeline';
import { allActions, bindingsOf, chordLabel, defaultHotkeyMap, helperBindings, toAccelerator, type HotkeyMap } from '../src/shared/hotkeys';
import { categoryFor, styleKeyFor, type HistoryItem, type Meeting, type State, type Transform, type TranscriptSegment } from '../src/shared/types';
import { applyMutation, emptyState, retainHistory } from '../src/shared/state';
import {
  DEFAULT_MIC,
  LANGUAGE_LOCALES,
  type AccessStatus,
  type CalendarState,
  type DictationPhase,
  type DictationStatus,
  type DockEdge,
  type EventChannels,
  type FlowBarConfig,
  type MeetingStatus,
  type NavRequest,
  type StoreMutation,
  type TransformChange,
} from '../src/shared/ipc';

const DEV_URL = process.env.ROYFLOW_DEV_URL; // set by `npm run app:dev`
const isDev = !!DEV_URL;
const APP_ROOT = path.join(__dirname, '..');
const DIST = path.join(APP_ROOT, 'dist');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const RES = app.isPackaged ? process.resourcesPath : APP_ROOT;
const HELPER_BIN = app.isPackaged ? path.join(process.resourcesPath, 'RoyFlowHelper') : path.join(APP_ROOT, 'native/build/RoyFlowHelper');
const TRAY_ICON = app.isPackaged ? path.join(RES, 'tray/trayTemplate.png') : path.join(APP_ROOT, 'resources/trayTemplate.png');
const SOUNDS = app.isPackaged ? path.join(RES, 'sounds') : path.join(APP_ROOT, 'resources/sounds');

const HUB = { width: 1350, height: 850, minWidth: 1140, minHeight: 750 };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'";

app.setName('Roy Flow');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* ------------------------------------------------------------------ log file (~/Library/Logs/Roy Flow/main.log) */
function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
  try {
    const dir = app.getPath('logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'main.log'), line + '\n');
  } catch {
    /* logging must never throw */
  }
}

/* ------------------------------------------------------------------ window state (not user data) */
const userFile = (name: string) => path.join(app.getPath('userData'), name);
function readJson<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(userFile(name), 'utf8')) };
  } catch {
    return fallback;
  }
}
function writeJson(name: string, value: unknown) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(userFile(name), JSON.stringify(value));
  } catch (e) {
    console.warn('could not save', name, e);
  }
}

/* ------------------------------------------------------------------ data accessors */
const D = () => getData();
function setting(k: string, d: string): string;
function setting(k: string, d: boolean): boolean;
function setting(k: string, d: string | boolean): string | boolean {
  return (D().settings ?? {})[k] ?? d;
}
const transforms = (): Transform[] => D().transforms ?? [];
const hotkeyMap = (): HotkeyMap => D().hotkeys ?? defaultHotkeyMap(transforms());
const actions = () => allActions(transforms());
const okHistory = () => (D().history ?? []).filter((h) => h.status === 'ok');
const lastTranscript = () => [...okHistory()].sort((a, b) => b.ts - a.ts)[0]?.text ?? '';
const meetingsList = (): Meeting[] => D().meetings ?? [];
const label = (action: string) => chordLabel(bindingsOf(hotkeyMap(), action)[0]);
const acc = (action: string) => toAccelerator(bindingsOf(hotkeyMap(), action)[0]) ?? undefined;
const uid = () => Math.random().toString(36).slice(2, 10);

let devices: string[] = [];
let hub: BrowserWindow | null = null;
let bar: BrowserWindow | null = null;
let scratch: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const helper = new Helper(HELPER_BIN);

/* ------------------------------------------------------------------ renderer plumbing */
function sendTo<K extends keyof EventChannels>(win: BrowserWindow | null, ch: K, payload?: EventChannels[K]) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}
const windows = () => [hub, bar, scratch].filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
const broadcast = <K extends keyof EventChannels>(ch: K, payload?: EventChannels[K]) => windows().forEach((w) => sendTo(w, ch, payload));
/** a notice on the Flow Bar (and a toast in the hub when it is focused) */
function notice(text: string, tone?: 'error', action?: { id: string; label: string }) {
  sendTo(bar, 'flowbar:note', { text, tone, action });
  if (hub?.isFocused()) sendTo(hub, 'toast', { text, tone: tone === 'error' ? 'error' : 'success' });
}

function loadPage(win: BrowserWindow, page: 'index.html' | 'flowbar.html', query = '') {
  if (DEV_URL) win.loadURL(`${DEV_URL}/${page}${query}`);
  else win.loadURL(`app://roy-flow/${page}${query}`);
}

function serveDist() {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep) || !existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith('.html')) return res;
    const headers = new Headers(res.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

const webPreferences = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true };

/* ------------------------------------------------------------------ hub window */
interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function visibleOnSomeDisplay(b: Bounds) {
  if (b.x === undefined || b.y === undefined) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! < a.x + a.width - 100 && b.x! + b.width > a.x + 100 && b.y! >= a.y - 20 && b.y! < a.y + a.height - 100;
  });
}

function createHub(show: boolean) {
  const saved = readJson<Bounds>('window-state.json', { width: HUB.width, height: HUB.height });
  const pos = visibleOnSomeDisplay(saved) ? { x: saved.x, y: saved.y } : {};
  hub = new BrowserWindow({
    title: 'Roy Flow',
    width: Math.max(saved.width, HUB.minWidth),
    height: Math.max(saved.height, HUB.minHeight),
    ...pos,
    minWidth: HUB.minWidth,
    minHeight: HUB.minHeight,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: D().theme === 'dark' ? '#1f1f1e' : '#f5f4f0',
    show: false,
    webPreferences,
  });
  if (saved.maximized) hub.maximize();
  loadPage(hub, 'index.html');
  hub.once('ready-to-show', () => {
    if (show) showHub();
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!hub || hub.isDestroyed()) return;
      const b = hub.getNormalBounds();
      writeJson('window-state.json', { ...b, maximized: hub.isMaximized() });
    }, 400);
  };
  hub.on('resize', saveBounds);
  hub.on('move', saveBounds);
  // closing the hub destroys it (its renderer is ~50 MB); everything it shows lives in main and the data file,
  // and showHub() recreates it on demand. The app keeps running in the menu bar.
  hub.on('show', () => {
    applyDockPolicy();
    scheduleAccessPoll();
  });
  hub.on('hide', applyDockPolicy);
  hub.on('focus', () => void checkAccess(false));
  hub.webContents.on('render-process-gone', () => setRecordMode(false));
  hub.webContents.on('did-start-loading', () => setRecordMode(false));
  hub.on('closed', () => {
    setRecordMode(false);
    hub = null;
    applyDockPolicy();
    scheduleAccessPoll();
  });
  hub.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showHub(nav?: NavRequest) {
  if (!hub || hub.isDestroyed()) createHub(true);
  if (!hub) return;
  if (app.dock) app.dock.show().catch(() => {});
  if (hub.isMinimized()) hub.restore();
  if (hub.webContents.isLoading()) hub.once('ready-to-show', () => hub?.show());
  else hub.show();
  hub.focus();
  app.focus({ steal: true });
  if (nav) {
    if (hub.webContents.isLoading()) hub.webContents.once('did-finish-load', () => sendTo(hub, 'nav', nav));
    else sendTo(hub, 'nav', nav);
  }
}

/** "Show app in dock": on = always in the dock; off = accessory (LSUIElement-style) while no window is visible */
function applyDockPolicy() {
  if (!app.dock || quitting) return;
  const visible = [hub, scratch].some((w) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed() && (w.isVisible() || w.isMinimized()));
  if (setting('showInDock', false) || visible) app.dock.show().catch(() => {});
  else app.dock.hide();
}

/* ------------------------------------------------------------------ Scratchpad window */
function openScratchpad() {
  if (scratch && !scratch.isDestroyed()) {
    scratch.show();
    scratch.focus();
    app.focus({ steal: true });
    return;
  }
  const saved = readJson<Bounds>('scratchpad-window.json', { width: 560, height: 640 });
  const pos = visibleOnSomeDisplay(saved) ? { x: saved.x, y: saved.y } : {};
  scratch = new BrowserWindow({
    title: 'Scratchpad',
    width: saved.width,
    height: saved.height,
    ...pos,
    minWidth: 380,
    minHeight: 320,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: D().theme === 'dark' ? '#1f1f1e' : '#ffffff',
    show: false,
    webPreferences,
  });
  scratch.setAlwaysOnTop(true, 'floating');
  loadPage(scratch, 'index.html', '?window=scratchpad');
  scratch.once('ready-to-show', () => {
    scratch?.show();
    scratch?.focus();
    app.focus({ steal: true });
  });
  const save = () => scratch && !scratch.isDestroyed() && writeJson('scratchpad-window.json', scratch.getNormalBounds());
  scratch.on('moved', save);
  scratch.on('resized', save);
  scratch.on('show', applyDockPolicy);
  scratch.on('closed', () => {
    scratch = null;
    applyDockPolicy();
  });
}

/* ------------------------------------------------------------------ Flow Bar panel window */
const BAR_SIZE: Record<DockEdge, { width: number; height: number }> = {
  bottom: { width: 620, height: 380 },
  left: { width: 460, height: 460 },
  right: { width: 460, height: 460 },
};

function flowBarConfig(): FlowBarConfig {
  const dock = String(setting('flowBarDock', 'Bottom')).toLowerCase() as DockEdge;
  return {
    show: setting('showFlowBar', true),
    dock: dock === 'left' || dock === 'right' ? dock : 'bottom',
    scratchpadInBar: setting('scratchpadInBar', true),
    transformsOptIn: setting('transformsOptIn', true),
    labels: {
      ptt: label('ptt'),
      handsfree: label('handsfree'),
      cancel: label('cancel'),
      notetaker: label('notetaker'),
      scratchpad: label('scratchpad'),
      viewChanges: label('viewChanges'),
    },
    meeting: !!meeting,
    creatorMode: setting('creatorMode', false),
  };
}
const pushBarConfig = () => sendTo(bar, 'flowbar:config', flowBarConfig());

/** while only the pill is showing the panel shrinks to this, so it covers (and composites) as little screen as possible */
const BAR_SMALL: Record<DockEdge, { width: number; height: number }> = {
  bottom: { width: 300, height: 110 },
  left: { width: 120, height: 320 },
  right: { width: 120, height: 320 },
};
let barExpanded = false;
let barDisplay: Electron.Display | null = null;

function barBounds(dock: DockEdge, area: Rectangle): Rectangle {
  const { width, height } = (barExpanded ? BAR_SIZE : BAR_SMALL)[dock];
  const y = Math.round(area.y + (area.height - height) / 2);
  if (dock === 'left') return { x: area.x, y, width, height };
  if (dock === 'right') return { x: area.x + area.width - width, y, width, height };
  return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height, width, height };
}

function positionBar(onCursorDisplay = false) {
  if (!bar || bar.isDestroyed()) return;
  const display = onCursorDisplay ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : barDisplay && screen.getAllDisplays().some((d) => d.id === barDisplay!.id) ? barDisplay : screen.getPrimaryDisplay();
  barDisplay = display;
  bar.setBounds(barBounds(flowBarConfig().dock, display.workArea));
}

function createBar() {
  bar = new BrowserWindow({
    type: 'panel', // NSPanel: never activates the app, so paste targets stay frontmost
    width: BAR_SMALL.bottom.width,
    height: BAR_SMALL.bottom.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    title: 'Flow Bar',
    webPreferences: { ...webPreferences, spellcheck: false, backgroundThrottling: false },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  bar.setIgnoreMouseEvents(true, { forward: true });
  if (setting('hideInCapture', false)) bar.setContentProtection(true);
  positionBar();
  loadPage(bar, 'flowbar.html');
  bar.webContents.once('did-finish-load', updateBarVisibility);
  bar.on('closed', () => (bar = null));
}

let barInteractive = false;
function setBarInteractive(on: boolean) {
  if (!bar || bar.isDestroyed() || on === barInteractive) return;
  barInteractive = on;
  bar.setIgnoreMouseEvents(!on, { forward: true });
}

let barPinnedUntil = 0; // keep the bar up briefly for notices/diffs even when "show at all times" is off
function updateBarVisibility() {
  if (!bar || bar.isDestroyed()) return;
  const want = flowBarConfig().show || phase !== 'idle' || !!meeting || Date.now() < barPinnedUntil;
  if (want && !bar.isVisible()) bar.showInactive();
  if (!want && bar.isVisible()) bar.hide();
}
function pinBar(ms: number) {
  barPinnedUntil = Date.now() + ms;
  updateBarVisibility();
  setTimeout(updateBarVisibility, ms + 50);
}

/* ------------------------------------------------------------------ sounds + mute */
function sound(name: 'start' | 'stop' | 'cancel' | 'notify') {
  if (!setting('sounds', true)) return;
  helper.send({ cmd: 'sound', path: path.join(SOUNDS, `${name}.wav`), volume: 0.45 });
}
let muted = false;
function mute(on: boolean) {
  if (on === muted) return;
  if (on && !setting('muteWhileDictating', false)) return;
  muted = on;
  helper.send({ cmd: 'mute', on });
}

/* ------------------------------------------------------------------ dictation */
let phase: DictationPhase = 'idle';
let phaseKind: DictationStatus['kind'] = 'dictation';
let startedAt = 0;
let interim = '';
let pendingId = '';
let mode: 'toggle' | 'ptt' = 'toggle';
let frontApp: { bundleId: string; name: string } = { bundleId: '', name: '' };
interface Final {
  text: string;
  audio: string | null;
  seconds: number;
}
let finalWaiter: ((f: Final) => void) | null = null;
let session: 'dictation' | 'meeting' | null = null;

function setPhase(p: DictationPhase, extra: Partial<DictationStatus> = {}) {
  if (p !== phase) log('[dictation]', phase, '->', p, extra.error ?? '');
  phase = p;
  if (extra.kind) phaseKind = extra.kind;
  if (p === 'idle') phaseKind = 'dictation';
  broadcast('dictation:status', { phase: p, interim, kind: phaseKind, ...extra });
  updateBarVisibility();
  syncContext();
}

function failDictation(message: string) {
  setPhase('error', { error: message });
  setTimeout(() => phase === 'error' && setPhase('idle'), 3200);
}

async function startDictation(how: 'toggle' | 'ptt') {
  if (phase === 'recording' || phase === 'processing') return;
  dropCancelled();
  if (meeting) return failDictation('Notetaker is recording. Stop it before dictating.');
  if (!helper.available) return failDictation('Native helper missing. Run npm run native.');
  interim = '';
  permissionHint = false;
  mode = how;
  startedAt = Date.now();
  pendingId = uid();
  positionBar(true);
  frontApp = { bundleId: '', name: '' };
  if (setting('contextAwareness', true))
    helper.request<{ type: 'frontmost'; bundleId: string; name: string }>({ cmd: 'frontmost' }, 'frontmost', 600).then((f) => {
      if (f) frontApp = { bundleId: f.bundleId, name: f.name };
    });
  const mic = setting('microphone', DEFAULT_MIC);
  const keepAudio = setting('localStorage', 'Store normally') !== 'Never store';
  if (keepAudio) mkdirSync(audioDir(), { recursive: true });
  session = 'dictation';
  const ok = helper.send({
    cmd: 'start',
    mode: 'dictation',
    locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US',
    device: mic === DEFAULT_MIC ? '' : mic,
    record: keepAudio ? path.join(audioDir(), `${pendingId}.wav`) : '',
  });
  if (!ok) return failDictation('Could not start the native helper');
  sound('start');
  setTimeout(() => phase === 'recording' && mute(true), 280);
  setPhase('recording', { kind: 'dictation' });
}

let permissionHint = false; // interim currently holds a permission hint, not speech
const heard = () => (permissionHint ? '' : interim);

/** recordings shorter than this, or with no words, are dropped without a message */
const MIN_RECORDING_MS = 400;

/** stop the helper and wait for its final transcript (falls back to the last partial after 5 s) */
function finishRecording(): Promise<Final> {
  return new Promise<Final>((resolve) => {
    const t = setTimeout(() => {
      finalWaiter = null;
      resolve({ text: heard(), audio: null, seconds: (Date.now() - startedAt) / 1000 });
    }, 5000);
    finalWaiter = (f) => {
      clearTimeout(t);
      finalWaiter = null;
      resolve({ ...f, text: f.text || heard() });
    };
    helper.send({ cmd: 'stop' });
  });
}

async function stopDictation() {
  if (phase !== 'recording') return;
  const heldMs = Date.now() - startedAt;
  setPhase('processing', { kind: 'dictation' });
  mute(false);
  const fin = await finishRecording();
  session = null;
  const raw = fin.text.trim();
  if (!raw || heldMs < MIN_RECORDING_MS) {
    // nothing said (or an accidental tap): drop it quietly, like Wispr does
    log('[dictation] dropped', { heldMs, chars: raw.length });
    discardAudio(fin.audio);
    interim = '';
    return setPhase('idle');
  }
  sound('stop');
  await deliver(raw, fin, pendingId, startedAt, frontApp);
  interim = '';
  setPhase('idle');
}

function discardAudio(file: string | null) {
  if (file) rmSync(file, { force: true });
}

/** clean up, paste and record one dictation */
async function deliver(raw: string, fin: Final, id: string, ts: number, app: { bundleId: string; name: string }) {
  const out = await processDictation(raw, app);
  const res = await pasteText(out.text);
  const item: HistoryItem = {
    id,
    ts,
    text: out.text,
    original: raw,
    status: 'ok',
    app: app.name || undefined,
    bundleId: app.bundleId || undefined,
    category: categoryFor(app.bundleId),
    words: wordCount(out.text),
    durationMs: Math.round((fin.seconds || (Date.now() - ts) / 1000) * 1000),
    fixes: out.fixes,
    dictFixes: out.dictFixes,
    audio: fin.audio ? path.basename(fin.audio) : undefined,
    engine: out.engine,
  };
  mutate({ collection: 'history', op: 'add', item });
  broadcast('dictation:result', { item, ...res, note: out.note });
}

/** a cancelled dictation, kept for a few seconds so "Undo" on the Flow Bar can still paste it */
let cancelled: { raw: Promise<Final>; id: string; ts: number; app: { bundleId: string; name: string }; timer: NodeJS.Timeout } | null = null;
const UNDO_MS = 6000;

function cancelDictation(silent = false) {
  if (phase !== 'recording') return;
  mute(false);
  interim = '';
  const heldMs = Date.now() - startedAt;
  if (silent || heldMs < 1000) {
    helper.send({ cmd: 'cancel' });
    session = null;
    if (!silent) sound('cancel');
    return setPhase('idle');
  }
  // Esc after real speech: finish recognition in the background and offer Undo
  sound('cancel');
  dropCancelled();
  const id = pendingId;
  const raw = finishRecording().then((f) => {
    session = null;
    return f;
  });
  cancelled = { raw, id, ts: startedAt, app: frontApp, timer: setTimeout(dropCancelled, UNDO_MS) };
  setPhase('idle');
  pinBar(UNDO_MS);
  notice('Dictation cancelled', undefined, { id: 'undo-cancel', label: 'Undo' });
}

function dropCancelled() {
  const c = cancelled;
  if (!c) return;
  cancelled = null;
  clearTimeout(c.timer);
  void c.raw.then((f) => discardAudio(f.audio));
}

async function undoCancel() {
  const c = cancelled;
  if (!c) return;
  cancelled = null;
  clearTimeout(c.timer);
  setPhase('processing', { kind: 'dictation' });
  const fin = await c.raw;
  const raw = fin.text.trim();
  if (!raw) {
    discardAudio(fin.audio);
    setPhase('idle');
    return notice('Nothing was heard in that dictation.');
  }
  await deliver(raw, fin, c.id, c.ts, c.app);
  setPhase('idle');
}

function toggleDictation() {
  if (phase === 'recording') stopDictation();
  else if (phase === 'idle' || phase === 'error') startDictation('toggle');
}

/** clean-up (Claude Haiku or rules), style per app category, dictionary, snippets, optional auto-applied Transform */
async function processDictation(raw: string, target: { bundleId: string; name: string }): Promise<{ text: string; fixes: number; dictFixes: number; engine: 'claude' | 'rules'; note?: string }> {
  const dict = (D().dictionary ?? []).map((w) => ({ word: w.word, misspelling: w.misspelling }));
  const snippets = (D().snippets ?? []).map((s) => ({ trigger: s.trigger, expansion: s.expansion }));
  const category = categoryFor(target.bundleId);
  const style = (D().styles ?? {})[styleKeyFor(category)] ?? 'formal';
  // in code editors and terminals keep text literal: no forced capitals or full stops ("Code-aware dictation")
  const codeAware = category === 'code' && setting('codeAware', true);
  const level = codeAware ? 'Light' : setting('autoCleanup', 'Medium');
  const d1 = applyDictionary(raw, dict);
  let text = '';
  let engine: 'claude' | 'rules' = 'rules';
  let note: string | undefined;
  if (ai.hasKey() && setting('aiCleanup', true)) {
    try {
      text = await ai.cleanupDictation(d1.text, { level, style: codeAware ? 'code' : style, app: target.name, category });
      engine = 'claude';
    } catch (e) {
      note = `${ai.errorText(e)} Used basic clean-up instead.`;
      log('[ai] cleanup failed', note);
    }
  }
  if (!text) text = codeAware ? cleanUp(d1.text, 'Light') : styleText(cleanUp(d1.text, level), style);
  const d2 = applyDictionary(text, dict);
  const u = D().user;
  const sn = applySnippets(d2.text, snippets, { first: u?.firstName, last: u?.lastName, email: u?.email });
  text = sn.text;
  if (setting('autoApply', false) && setting('transformsOptIn', true)) {
    const t = transforms().find((x) => x.name === setting('autoApplyTransform', 'Polish'));
    if (t && ai.hasKey()) {
      try {
        const after = await ai.runTransform(text, t.prompt, t.name);
        rememberChange({ name: t.name, before: text, after });
        text = after;
      } catch (e) {
        note = `${t.name} was not applied: ${ai.errorText(e)}`;
      }
    } else if (t) note = `Auto Apply (${t.name}) needs a Claude API key in Settings › Account.`;
  }
  return { text, fixes: changedWords(raw, text), dictFixes: d1.count + d2.count + sn.count, engine, note };
}

/* ------------------------------------------------------------------ Transforms on selected text */
let lastChange: TransformChange | null = null;
let changesUntil = 0;
function rememberChange(c: TransformChange) {
  lastChange = c;
  changesUntil = Date.now() + 120_000;
  syncContext();
  setTimeout(syncContext, 120_500);
}

async function transformHotkey(id: string) {
  const t = transforms().find((x) => x.id === id);
  if (!t) return;
  if (!setting('transformsOptIn', true)) return notice('Transforms are off. Turn on “Opt in” on the Transforms page.', 'error');
  if (phase === 'recording' || phase === 'processing') return;
  if (!ai.hasKey()) return notice('Add your Anthropic API key in Settings › Account to use Transforms.', 'error');
  setPhase('processing', { kind: 'transform', label: t.name });
  const saved = await saveClipboard();
  let selection = '';
  if (await accessibilityTrusted()) {
    const sentinel = `⁣royflow-${Date.now()}`;
    await clipboard.writeText(sentinel);
    await helper.request({ cmd: 'copy' }, 'copied', 1000);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const cur = await clipboard.readText();
      if (cur !== sentinel) {
        selection = cur;
        break;
      }
    }
  }
  const before = selection.trim() ? selection : lastTranscript();
  if (!before.trim()) {
    await restoreClipboard(saved);
    setPhase('idle');
    return notice('Select some text first, then press the shortcut again.', 'error');
  }
  let after = '';
  try {
    after = await ai.runTransform(before, t.prompt, t.name);
  } catch (e) {
    await restoreClipboard(saved);
    return failDictation(ai.errorText(e));
  }
  rememberChange({ name: t.name, before, after });
  const hint = label('viewChanges') ? ` · ${label('viewChanges')} to view changes` : '';
  if (selection.trim()) {
    const r = await pasteText(after, saved);
    notice(r.pasted ? `${t.name} applied${hint}` : (r.reason ?? 'Copied to the clipboard'), r.pasted ? undefined : 'error');
  } else {
    await clipboard.writeText(after);
    const last = [...okHistory()].sort((a, b) => b.ts - a.ts)[0];
    if (last) mutate({ collection: 'history', op: 'patch', id: last.id, patch: { text: after } });
    notice(`No text was selected, so ${t.name} ran on your last dictation and copied it${hint}`);
  }
  setPhase('idle');
}

function showChanges() {
  if (!lastChange) return notice('Run a Transform first, then view its changes.');
  pinBar(30_000);
  sendTo(bar, 'flowbar:changes', lastChange);
}

/* ------------------------------------------------------------------ Notetaker (meeting recording) */
interface MeetingRun {
  id: string;
  startedAt: number;
  title: string;
  segments: TranscriptSegment[];
  partial: string;
  lastVoice: number;
  timers: NodeJS.Timeout[];
  warned: boolean;
  error?: string;
}
let meeting: MeetingRun | null = null;
let meetingFinal: ((ok: boolean) => void) | null = null;

const MAX_LEN: Record<string, number> = { '30 min': 30, '1 hour': 60, '2 hours': 120, '4 hours': 240 };
function meetingStatus(): MeetingStatus {
  return meeting
    ? { recording: true, startedAt: meeting.startedAt, title: meeting.title, partial: meeting.partial, segments: meeting.segments, error: meeting.error }
    : { recording: false, startedAt: 0, title: '', partial: '', segments: [] };
}
let statusTimer: NodeJS.Timeout | undefined;
function pushMeetingStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => broadcast('meeting:status', meetingStatus()), 120);
}

async function startMeeting(title?: string): Promise<{ ok: boolean; error?: string }> {
  if (meeting) return { ok: true };
  if (phase === 'recording' || phase === 'processing') return { ok: false, error: 'Finish your dictation first.' };
  if (!helper.available) return { ok: false, error: 'Native helper missing.' };
  const now = Date.now();
  const ev = calendar.events.find((e) => !e.allDay && e.start - 5 * 60_000 <= now && e.end >= now);
  meeting = { id: uid(), startedAt: now, title: title || ev?.title || `Meeting ${new Date(now).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, segments: [], partial: '', lastVoice: now, timers: [], warned: false };
  session = 'meeting';
  const mic = setting('microphone', DEFAULT_MIC);
  helper.send({ cmd: 'start', mode: 'meeting', locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US', device: mic === DEFAULT_MIC ? '' : mic });
  const maxMin = MAX_LEN[setting('maxRecording', '2 hours')] ?? 120;
  meeting.timers.push(
    setInterval(() => {
      if (!meeting) return;
      const el = (Date.now() - meeting.startedAt) / 60_000;
      if (!meeting.warned && el >= maxMin - 1) {
        meeting.warned = true;
        notify('Notetaker stops in 1 minute', `It has reached your ${setting('maxRecording', '2 hours')} limit.`, 'notetaker');
      }
      if (el >= maxMin) void stopMeeting('Reached the maximum recording length');
      // "Stop when call ends": no voice for 3 minutes
      if (setting('stopWhenCallEnds', true) && Date.now() - meeting.lastVoice > 3 * 60_000) void stopMeeting('Stopped after 3 minutes of silence');
    }, 5000),
  );
  sound('start');
  log('[meeting] started');
  pushMeetingStatus();
  pushBarConfig();
  updateBarVisibility();
  updateTrayTitle();
  rebuildMenus();
  return { ok: true };
}

async function stopMeeting(reason?: string) {
  const m = meeting;
  if (!m) return;
  m.timers.forEach((t) => clearInterval(t));
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 9000);
    meetingFinal = (v) => {
      clearTimeout(t);
      resolve(v);
    };
    helper.send({ cmd: 'stop' });
  });
  meetingFinal = null;
  meeting = null;
  session = null;
  if (!ok) log('[meeting] stop timed out');
  if (m.partial.trim() && !m.segments.some((s) => s.text === m.partial.trim())) m.segments.push({ t: (Date.now() - m.startedAt) / 1000, text: m.partial.trim() });
  sound('stop');
  const durationSec = Math.round((Date.now() - m.startedAt) / 1000);
  const rec: Meeting = {
    id: m.id,
    title: m.title,
    ts: m.startedAt,
    minutes: Math.max(1, Math.round(durationSec / 60)),
    durationSec,
    people: 1,
    overview: '',
    transcript: m.segments,
    actionItems: [],
    summaryStatus: m.segments.length ? (ai.hasKey() ? 'pending' : 'nokey') : 'done',
  };
  mutate({ collection: 'meetings', op: 'add', item: rec });
  log('[meeting] saved', { segments: m.segments.length, durationSec });
  if (reason) notify('Notetaker stopped', `${reason}. Your note “${m.title}” was saved.`, 'notetaker');
  pushMeetingStatus();
  pushBarConfig();
  updateBarVisibility();
  updateTrayTitle();
  rebuildMenus();
  if (rec.summaryStatus === 'pending') void summarize(rec);
}

async function summarize(m: Meeting): Promise<{ ok: boolean; error?: string }> {
  if (!m.transcript?.length) return { ok: false, error: 'This note has no transcript to summarise.' };
  if (!ai.hasKey()) {
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'nokey' } });
    return { ok: false, error: new ai.NoKeyError().message };
  }
  mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'pending' } });
  try {
    const s = await ai.summarizeMeeting(m);
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { title: s.title, overview: s.overview, actionItems: s.actionItems, summaryStatus: 'done', summaryError: undefined } });
    return { ok: true };
  } catch (e) {
    const error = ai.errorText(e);
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'error', summaryError: error } });
    return { ok: false, error };
  }
}

const toggleMeeting = () => (meeting ? void stopMeeting() : void startMeeting().then((r) => !r.ok && notice(r.error ?? 'Could not start Notetaker', 'error')));

/* ------------------------------------------------------------------ helper messages */
helper.on('message', (m: HelperMessage) => {
  if (!['level', 'partial', 'keys', 'segment', 'access'].includes(m.type)) log('[helper]', m.type === 'final' ? { type: 'final', chars: String(m.text ?? '').length } : m);
  switch (m.type) {
    case 'partial':
      if (session === 'meeting' && meeting) {
        meeting.partial = String(m.text ?? '');
        pushMeetingStatus();
        break;
      }
      permissionHint = false;
      interim = String(m.text ?? '');
      if (phase === 'recording') broadcast('dictation:status', { phase, interim, kind: 'dictation' });
      break;
    case 'segment':
      if (meeting) {
        meeting.segments.push({ t: Number(m.start) || 0, text: String(m.text ?? '') });
        meeting.partial = '';
        pushMeetingStatus();
      }
      break;
    case 'authorizing':
      if (phase === 'recording') {
        permissionHint = true;
        interim = m.service === 'speech' ? 'Allow Speech Recognition for Roy Flow in the system prompt, then dictate again.' : 'Allow microphone access for Roy Flow in the system prompt, then dictate again.';
        broadcast('dictation:status', { phase, interim });
      }
      break;
    case 'started':
      if (typeof m.ms === 'number') log('[dictation] mic started', { ms: m.ms, device: m.device });
      if (phase === 'recording' && permissionHint) {
        permissionHint = false;
        interim = '';
        broadcast('dictation:status', { phase, interim });
      }
      break;
    case 'level': {
      const v = Number(m.value) || 0;
      sendTo(bar, 'dictation:level', v);
      if (meeting && v > 0.2) meeting.lastVoice = Date.now();
      break;
    }
    case 'final':
      if (m.mode === 'meeting') meetingFinal?.(true);
      else finalWaiter?.({ text: String(m.text ?? ''), audio: typeof m.audio === 'string' ? m.audio : null, seconds: Number(m.seconds) || 0 });
      break;
    case 'hotkey':
      onHotkey(String(m.action), String(m.phase));
      break;
    case 'keys':
      sendTo(hub, 'hotkeys:keys', (m.down as string[]) ?? []);
      break;
    case 'tap':
      if (m.state !== tapState) {
        tapState = m.state as AccessStatus['tap'];
        applyFallbackShortcuts();
        void checkAccess(false);
      }
      break;
    case 'error':
      if (session === 'meeting' && meeting) {
        if (['mic-denied', 'speech-denied', 'unavailable', 'no-input', 'audio', 'busy'].includes(String(m.code))) {
          const err = String(m.message ?? 'Notetaker could not record');
          meeting.timers.forEach((t) => clearInterval(t));
          meeting = null;
          session = null;
          notice(err, 'error');
          broadcast('meeting:status', { ...meetingStatus(), error: err });
          pushBarConfig();
          updateBarVisibility();
          updateTrayTitle();
          rebuildMenus();
        }
        break;
      }
      if (phase === 'recording' || phase === 'processing') {
        if (finalWaiter) finalWaiter({ text: '', audio: null, seconds: 0 });
        else {
          helper.send({ cmd: 'cancel' });
          mute(false);
          session = null;
          failDictation(String(m.message ?? 'Dictation failed'));
        }
      }
      break;
  }
});
helper.on('exit', (code: number | null, sig: string | null) => {
  log('[helper] exited', { code, sig });
  muted = false;
  tapState = 'off';
  if (phase === 'recording') failDictation('The dictation helper stopped unexpectedly');
  if (finalWaiter) finalWaiter({ text: '', audio: null, seconds: 0 });
  if (meetingFinal) meetingFinal(false);
  // respawn so global shortcuts keep working
  if (!quitting)
    setTimeout(() => {
      sendHotkeys();
      warmMic();
    }, 1000);
});

/* ------------------------------------------------------------------ global shortcuts */
let tapState: AccessStatus['tap'] = 'off';
let pttDownAt = 0;
let lastPttTap = 0;

function onHotkey(action: string, ph: string) {
  log('[hotkey]', action, ph);
  if (action === 'ptt') {
    if (ph === 'down') {
      if (phase === 'recording' && mode === 'toggle') return void stopDictation(); // tap PTT to finish hands-free
      if (phase !== 'idle' && phase !== 'error') return;
      pttDownAt = Date.now();
      void startDictation('ptt');
    } else if (ph === 'up') {
      if (phase !== 'recording' || mode !== 'ptt') return;
      const held = Date.now() - pttDownAt;
      if (held < 350) {
        // a tap, not a hold: double-tap starts hands-free
        cancelDictation(true);
        const now = Date.now();
        if (now - lastPttTap < 500) {
          lastPttTap = 0;
          void startDictation('toggle');
        } else lastPttTap = now;
      } else void stopDictation();
    } else if (ph === 'abort') {
      if (phase === 'recording' && mode === 'ptt' && Date.now() - pttDownAt < 1500) cancelDictation(true);
    }
    return;
  }
  if (ph !== 'press' && ph !== 'down') return;
  if (action === 'handsfree') toggleDictation();
  else if (action === 'cancel') cancelDictation();
  else if (action === 'pasteLast') pasteLast();
  else if (action === 'copyLast') copyLast();
  else if (action === 'scratchpad') openScratchpad();
  else if (action === 'notetaker') toggleMeeting();
  else if (action === 'viewChanges') showChanges();
  else if (action === 'openApp') showHub();
  else if (action.startsWith('transform:')) void transformHotkey(action.slice(10));
}

function syncContext() {
  const flags: string[] = [];
  if (phase === 'recording') flags.push('recording');
  if (lastChange && Date.now() < changesUntil) flags.push('changes');
  helper.send({ cmd: 'context', flags });
  // fallback Esc when the event tap is unavailable
  if (tapState === 'off') {
    const a = acc('cancel');
    if (a) {
      if (phase === 'recording' && !globalShortcut.isRegistered(a)) globalShortcut.register(a, () => cancelDictation());
      else if (phase !== 'recording' && globalShortcut.isRegistered(a) && !fallbackRegistered.includes(a)) globalShortcut.unregister(a);
    }
  }
}

function sendHotkeys() {
  helper.send({ cmd: 'hotkeys', bindings: helperBindings(hotkeyMap(), actions()) });
  syncContext();
}

/** Electron globalShortcut for ordinary combos, only while the event tap is not running */
let fallbackRegistered: string[] = [];
let fallbackFailed: string[] = [];
function applyFallbackShortcuts() {
  for (const a of fallbackRegistered) if (globalShortcut.isRegistered(a)) globalShortcut.unregister(a);
  fallbackRegistered = [];
  fallbackFailed = [];
  if (tapState !== 'off') return;
  for (const a of actions()) {
    if (a.when) continue; // contextual (Esc while recording, ⌥O after a Transform) handled in syncContext / not available
    for (const c of bindingsOf(hotkeyMap(), a.id)) {
      const accel = toAccelerator(c);
      if (!accel) {
        if (c.length) fallbackFailed.push(`${a.label} (${chordLabel(c)})`);
        continue;
      }
      let ok = false;
      try {
        // push-to-talk becomes a toggle without the tap (no key-up events)
        ok = globalShortcut.register(accel, () => onHotkey(a.id === 'ptt' ? 'handsfree' : a.id, 'press'));
      } catch {
        ok = false;
      }
      if (ok) fallbackRegistered.push(accel);
      else fallbackFailed.push(`${a.label} (${chordLabel(c)})`);
    }
  }
  log('[shortcuts] fallback', { registered: fallbackRegistered, failed: fallbackFailed });
}

/** shortcut capture in the helper (global matching paused). Never left on: 20 s cap, and off when the hub goes away. */
let recordTimer: NodeJS.Timeout | undefined;
function setRecordMode(on: boolean) {
  clearTimeout(recordTimer);
  helper.send({ cmd: 'record', on });
  if (on) recordTimer = setTimeout(() => helper.send({ cmd: 'record', on: false }), 20_000);
}

/* ------------------------------------------------------------------ clipboard + paste */
/** snapshot every MIME type on the pasteboard so it can be put back after the paste */
async function saveClipboard(): Promise<ClipboardItem[]> {
  try {
    const items = await clipboard.read();
    const out: ClipboardItem[] = [];
    for (const item of items) {
      const data: Record<string, Blob | string> = {};
      for (const type of item.types) {
        try {
          const v = await item.getType(type);
          if (v instanceof Blob) data[type] = v;
        } catch {
          /* type vanished */
        }
      }
      if (Object.keys(data).length) out.push(new ClipboardItem(data));
    }
    return out;
  } catch {
    return [];
  }
}
async function restoreClipboard(items: ClipboardItem[]) {
  try {
    if (items.length) await clipboard.write(items);
    else clipboard.clear();
  } catch (e) {
    console.warn('could not restore clipboard', e);
  }
}

async function accessibilityTrusted(prompt = false): Promise<boolean> {
  const r = await helper.request<{ type: 'access'; trusted: boolean }>({ cmd: 'access', prompt }, 'access');
  return !!r?.trusted;
}

async function pasteText(text: string, restore?: ClipboardItem[]): Promise<{ pasted: boolean; reason?: string }> {
  const saved = restore ?? (await saveClipboard());
  await clipboard.writeText(text);
  if (!(await accessibilityTrusted())) {
    void checkAccess(false);
    return { pasted: false, reason: 'Copied to the clipboard. Allow Accessibility access so Roy Flow can paste for you.' };
  }
  await new Promise((r) => setTimeout(r, 30));
  const r = await helper.request<{ type: 'pasted'; ok: boolean }>({ cmd: 'paste' }, 'pasted');
  if (!r?.ok) return { pasted: false, reason: 'Copied to the clipboard (paste failed).' };
  // give the target app time to read the pasteboard, then put back what was there
  setTimeout(async () => {
    if ((await clipboard.readText()) === text) restoreClipboard(saved);
  }, 700);
  return { pasted: true };
}

function pasteLast() {
  const t = lastTranscript().trim();
  if (t) void pasteText(t);
  else notice('Nothing dictated yet.');
}
function copyLast() {
  const t = lastTranscript();
  if (!t) return notice('Nothing dictated yet.');
  void clipboard.writeText(t);
  notice('Last transcript copied');
}

/* ------------------------------------------------------------------ permissions */
let access: AccessStatus = { accessibility: false, inputMonitoring: false, tap: 'off', helper: helper.available };
async function checkAccess(prompt: boolean, listen = false): Promise<AccessStatus> {
  const r = await helper.request<{ type: 'access'; trusted: boolean; listen: boolean; tap: AccessStatus['tap'] }>({ cmd: 'access', prompt, listen }, 'access');
  const next: AccessStatus = { accessibility: !!r?.trusted, inputMonitoring: !!r?.listen, tap: r?.tap ?? 'off', helper: helper.available };
  if (r && next.tap !== tapState) {
    tapState = next.tap;
    applyFallbackShortcuts();
  }
  if (JSON.stringify(next) !== JSON.stringify(access)) {
    access = next;
    log("[access] changed", access);
    broadcast('access:changed', access);
  }
  return access;
}
let accessTimer: NodeJS.Timeout | undefined;
/** permission polling: every 5 s while the hub is open or the event tap is not fully active, else every 60 s */
function scheduleAccessPoll() {
  clearTimeout(accessTimer);
  const hubVisible = !!hub && !hub.isDestroyed() && hub.isVisible();
  const ms = hubVisible || tapState !== 'active' ? 5000 : 60_000;
  accessTimer = setTimeout(async () => {
    await checkAccess(false);
    scheduleAccessPoll();
  }, ms);
}
const PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  calendar: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  keyboard: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension',
};

/* ------------------------------------------------------------------ calendar, menu-bar countdown, reminders */
let calendar: CalendarState = { status: 'unavailable', events: [] };
async function refreshCalendar(request = false): Promise<CalendarState> {
  const r = await helper.request<{ type: 'calendar'; status: CalendarState['status']; events: CalendarState['events'] }>({ cmd: 'calendar', request, days: 7 }, 'calendar', request ? 120_000 : 5000);
  if (r) calendar = { status: r.status, events: r.events ?? [] };
  broadcast('calendar:changed', calendar);
  updateTrayTitle();
  rebuildMenus();
  return calendar;
}
const calendarConnected = () => calendar.status === 'authorized' && (setting('connected_gcal', false) || setting('connected_outlook', false));

function updateTrayTitle() {
  if (!tray) return;
  if (meeting) {
    const s = Math.floor((Date.now() - meeting.startedAt) / 1000);
    tray.setTitle(` ● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, { fontType: 'monospacedDigit' });
    return;
  }
  if (!setting('showNextMeeting', true) || !calendarConnected()) return tray.setTitle('');
  const now = Date.now();
  const next = calendar.events.find((e) => !e.allDay && e.end > now && e.start - now < 12 * 3600_000);
  if (!next) return tray.setTitle('');
  const name = next.title.length > 18 ? next.title.slice(0, 17) + '…' : next.title;
  const mins = Math.round((next.start - now) / 60_000);
  const when = mins <= 0 ? 'now' : mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  tray.setTitle(` ${name} · ${when}`, { fontType: 'monospacedDigit' });
}

const reminded = new Set<string>();
const autoStarted = new Set<string>();
const LEAD: Record<string, number> = { '15 sec': 15_000, '1 min': 60_000, '5 min': 300_000 };
function meetingReminders() {
  if (!calendarConnected()) return;
  const now = Date.now();
  const lead = LEAD[setting('notifyBefore', '1 min')];
  for (const e of calendar.events) {
    if (e.allDay) continue;
    if (lead && e.start > now && e.start - now <= lead && !reminded.has(e.id)) {
      reminded.add(e.id);
      notify(e.title, `Starts ${Math.round((e.start - now) / 60_000) || 'in less than a'} min. Click to take notes.`, 'notetaker', () => void startMeeting(e.title));
    }
    if (setting('autoStartNotetaker', false) && now >= e.start && now - e.start < 90_000 && !autoStarted.has(e.id) && !meeting) {
      autoStarted.add(e.id);
      void startMeeting(e.title);
    }
  }
}

/* ------------------------------------------------------------------ notifications */
function notify(title: string, body: string, kind: 'milestone' | 'announcement' | 'suggestion' | 'notetaker', onClick?: () => void) {
  const allowed = kind === 'milestone' ? setting('milestones', true) : kind === 'announcement' ? setting('announcements', true) : kind === 'suggestion' ? setting('suggestions', true) : true;
  if (!allowed || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => (onClick ? onClick() : showHub()));
  n.show();
  sound('notify');
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function streakDays(history: HistoryItem[]) {
  const days = new Set(history.map((h) => dayKey(h.ts)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
const WORD_MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const STREAK_MILESTONES = [3, 7, 14, 30, 100];
function checkMilestones() {
  const h = okHistory();
  const words = h.reduce((n, x) => n + (x.words ?? wordCount(x.text)), 0);
  const streak = streakDays(h);
  const announced = { ...(D().announced ?? {}) };
  let changed = false;
  for (const w of WORD_MILESTONES) {
    const k = `words-${w}`;
    if (words >= w && !announced[k]) {
      announced[k] = true;
      changed = true;
      if (words < w * 1.5) notify(`${w.toLocaleString('en-US')} words dictated`, 'That is a lot of typing you did not have to do.', 'milestone', () => showHub({ page: 'insights' }));
    }
  }
  for (const s of STREAK_MILESTONES) {
    const k = `streak-${s}-${dayKey(Date.now())}`;
    if (streak === s && !announced[k]) {
      announced[k] = true;
      changed = true;
      notify(`${s} day streak`, `You have dictated ${s} days in a row. Keep it going!`, 'milestone', () => showHub({ page: 'insights' }));
    }
  }
  if (changed) mainPatch({ announced });
}

function startupAnnouncements() {
  const announced = { ...(D().announced ?? {}) };
  const v = `version-${app.getVersion()}`;
  let changed = false;
  if (!announced[v]) {
    announced[v] = true;
    changed = true;
    if (Object.keys(announced).some((k) => k.startsWith('version-') && k !== v)) notify(`Roy Flow ${app.getVersion()}`, 'Shortcuts, Claude-powered Transforms and Notetaker summaries are here.', 'announcement');
  }
  if (!ai.hasKey() && !announced['tip-ai-key']) {
    announced['tip-ai-key'] = true;
    changed = true;
    setTimeout(() => notify('Make dictation smarter', 'Add an Anthropic API key in Settings › Account for Claude clean-up, Transforms and meeting summaries.', 'suggestion', () => showHub({ settings: 'account' })), 8000);
  }
  if (changed) mainPatch({ announced });
}

/* ------------------------------------------------------------------ menus + tray */
function menuSnapshot(): MenuSnapshot {
  const h = okHistory();
  return {
    settings: D().settings ?? {},
    lastTranscript: lastTranscript(),
    totalWords: h.reduce((n, x) => n + (x.words ?? wordCount(x.text)), 0),
    dictionaryCount: (D().dictionary ?? []).length,
    snippetCount: (D().snippets ?? []).length,
    pastNotes: [...meetingsList()].filter((m) => !m.demo).sort((a, b) => b.ts - a.ts).slice(0, 5).map((m) => ({ id: m.id, title: m.title, ts: m.ts })),
  };
}
const menuContext = (): MenuContext => ({
  snap: menuSnapshot(),
  devices,
  dev: isDev,
  acc: { handsfree: acc('handsfree'), pasteLast: acc('pasteLast'), copyLast: acc('copyLast'), notetaker: acc('notetaker'), scratchpad: acc('scratchpad'), openApp: acc('openApp') },
  upcoming: calendarConnected() ? calendar.events : null,
  meetingActive: !!meeting,
  openHub: showHub,
  toggleDictation,
  toggleMeeting,
  startMeeting: (title: string) => void startMeeting(title).then((r) => !r.ok && notice(r.error ?? 'Could not start Notetaker', 'error')),
  openScratchpad,
  pasteLast,
  copyLast,
  version: app.getVersion(),
  logMetrics: () => void logMetrics(true),
  setSetting: (key, value) => mainPatch({ settings: { ...(D().settings ?? {}), [key]: value } }),
  quit: () => {
    quitting = true;
    app.quit();
  },
});

let menuTimer: NodeJS.Timeout | undefined;
function rebuildMenus() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    const c = menuContext();
    tray?.setContextMenu(buildTrayMenu(c));
    Menu.setApplicationMenu(buildAppMenu(c));
  }, 80);
}

async function refreshDevices() {
  devices = (await helper.request<{ type: 'devices'; devices: string[] }>({ cmd: 'devices' }, 'devices'))?.devices ?? devices;
  rebuildMenus();
  return devices;
}

function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON);
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Roy Flow');
  tray.on('mouse-down', () => void refreshDevices());
  rebuildMenus();
}

/* ------------------------------------------------------------------ data changes */
/** add/patch a history item or meeting: main owns the data, so this works with the hub window closed */
function mutate(m: StoreMutation) {
  mainPatch(applyMutation(D(), m));
}

/** a patch made by main itself: apply and fan out to every window */
function mainPatch(p: Partial<State>) {
  const prev = patchData(p);
  broadcast('store:changed', p as Record<string, unknown>);
  onDataChanged(prev, Object.keys(p));
}

function onDataChanged(prev: Partial<State>, keys: string[]) {
  const n = D();
  if (keys.includes('settings')) {
    const p = prev.settings ?? {};
    const s = n.settings ?? {};
    if (s.showInDock !== p.showInDock) applyDockPolicy();
    if (s.launchAtLogin !== p.launchAtLogin) applyLoginItem();
    if (s.flowBarDock !== p.flowBarDock) positionBar();
    if (s.hideInCapture !== p.hideInCapture) bar?.setContentProtection(!!s.hideInCapture);
    if (s.showNextMeeting !== p.showNextMeeting || s.connected_gcal !== p.connected_gcal || s.connected_outlook !== p.connected_outlook) updateTrayTitle();
    if (s.muteWhileDictating === false && muted) mute(false);
    if (s.microphone !== p.microphone || s.language !== p.language) warmMic();
    if (s.localStorage !== p.localStorage) applyRetention();
  }
  if (keys.includes('hotkeys') || keys.includes('transforms')) {
    sendHotkeys();
    applyFallbackShortcuts();
  }
  if (keys.includes('theme') && n.theme !== prev.theme) hub?.setBackgroundColor(n.theme === 'dark' ? '#1f1f1e' : '#f5f4f0');
  if (keys.includes('history')) {
    const ref = new Set((n.history ?? []).map((h) => h.audio).filter((a): a is string => !!a));
    const dropped = pruneAudio(ref);
    if (dropped.length) for (const h of n.history ?? []) if (h.audio && dropped.includes(h.audio)) mutate({ collection: 'history', op: 'patch', id: h.id, patch: { audio: undefined } });
    checkMilestones();
  }
  pushBarConfig();
  updateBarVisibility();
  rebuildMenus();
}

/** have the helper build the audio engine and recognizer now, so the first key-down starts recording fast */
function warmMic() {
  const mic = setting('microphone', DEFAULT_MIC);
  helper.send({ cmd: 'warm', locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US', device: mic === DEFAULT_MIC ? '' : mic });
}

/** "Auto-delete after 30 days" */
function applyRetention() {
  const kept = retainHistory(D().history ?? [], setting('localStorage', 'Store normally'));
  if (kept) mainPatch({ history: kept });
}

function applyLoginItem() {
  const want = setting('launchAtLogin', false);
  try {
    if (app.getLoginItemSettings().openAtLogin !== want) app.setLoginItemSettings({ openAtLogin: want });
  } catch (e) {
    log('[login item] failed', String(e));
  }
}

/* ------------------------------------------------------------------ IPC */
const askControllers = new Map<string, AbortController>();
function wireIpc() {
  ipcMain.handle('store:load', () => ({ data: hasData() ? (getData() as Record<string, unknown>) : null }));
  ipcMain.on('store:patch', (e, p: Record<string, unknown>) => {
    const prev = patchData(p as Partial<State>);
    for (const w of windows()) if (w.webContents.id !== e.sender.id) sendTo(w, 'store:changed', p);
    onDataChanged(prev, Object.keys(p));
  });
  ipcMain.handle('store:export', async () => {
    const def = path.join(app.getPath('downloads'), `roy-flow-data-${new Date().toISOString().slice(0, 10)}.json`);
    const r = hub ? await dialog.showSaveDialog(hub, { defaultPath: def, filters: [{ name: 'JSON', extensions: ['json'] }] }) : await dialog.showSaveDialog({ defaultPath: def });
    if (r.canceled || !r.filePath) return { ok: false };
    writeFileSync(r.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Roy Flow', version: app.getVersion(), data: getData() }, null, 2));
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('store:reset', async () => {
    if (meeting) await stopMeeting();
    wipeAll();
    ai.clearKey();
    await electronSession.defaultSession.clearStorageData({ storages: ['localstorage', 'indexdb'] });
    log('[app] reset and relaunch');
    quitting = true;
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on('dictation:toggle', toggleDictation);
  ipcMain.on('dictation:cancel', () => cancelDictation());
  ipcMain.on('flowbar:interactive', (_e, on: boolean) => setBarInteractive(!!on));
  ipcMain.on('flowbar:expand', (_e, on: boolean) => {
    if (barExpanded === !!on) return;
    barExpanded = !!on;
    positionBar();
  });
  ipcMain.on('flowbar:action', (_e, id: string) => {
    if (id === 'undo-cancel') void undoCancel();
  });
  ipcMain.on('flowbar:ready', () => {
    pushBarConfig();
    sendTo(bar, 'dictation:status', { phase, interim, kind: phaseKind });
  });
  ipcMain.on('hub:open', (_e, nav: NavRequest) => showHub(nav));
  ipcMain.on('hotkeys:record', (_e, on: boolean) => setRecordMode(!!on));
  ipcMain.on('scratchpad:open', openScratchpad);
  ipcMain.on('scratchpad:close', () => scratch?.close());
  ipcMain.on('meeting:toggle', toggleMeeting);
  ipcMain.handle('access:check', async (_e, { prompt, listen }: { prompt: boolean; listen?: boolean }) => {
    const a = await checkAccess(prompt, listen);
    if (prompt && !a.accessibility) shell.openExternal(PANES.accessibility);
    else if (listen && !a.inputMonitoring && !a.accessibility) shell.openExternal(PANES.input);
    return a;
  });
  ipcMain.handle('access:open', (_e, { pane }: { pane: keyof typeof PANES }) => void shell.openExternal(PANES[pane]));
  ipcMain.handle('hotkeys:apply', () => {
    sendHotkeys();
    applyFallbackShortcuts();
    return { tap: tapState, failed: fallbackFailed };
  });
  ipcMain.handle('devices:get', () => refreshDevices());
  ipcMain.handle('app:info', () => {
    let fullName = '';
    try {
      fullName = execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8' }).trim();
    } catch {
      fullName = os.userInfo().username;
    }
    return { version: app.getVersion(), packaged: app.isPackaged, fullName, dataDir: app.getPath('userData') };
  });
  ipcMain.handle('ai:status', () => ({ hasKey: ai.hasKey(), encryption: ai.encryptionAvailable(), hint: ai.keyHint() }));
  ipcMain.handle('ai:setKey', (_e, { key }: { key: string }) => ai.setKey(String(key ?? '')));
  ipcMain.handle('ai:clearKey', () => ai.clearKey());
  ipcMain.handle('ai:test', () => ai.testKey());
  ipcMain.handle('ai:cleanup', async (_e, { id }: { id: string }) => {
    const h = (D().history ?? []).find((x) => x.id === id);
    if (!h) return { ok: false, error: 'Transcript not found' };
    const raw = h.original ?? h.text;
    const out = await processDictation(raw, { bundleId: h.bundleId ?? '', name: h.app ?? '' }).catch(() => null);
    if (!out) return { ok: false, error: 'Retry failed' };
    mutate({ collection: 'history', op: 'patch', id, patch: { text: out.text, cleaned: undefined, original: raw, fixes: out.fixes, dictFixes: out.dictFixes, engine: out.engine, words: wordCount(out.text) } });
    return { ok: true, error: out.note };
  });
  ipcMain.handle('ai:transform', async (_e, { text, prompt, name }: { text: string; prompt: string; name: string }) => {
    try {
      return { ok: true, text: await ai.runTransform(text, prompt, name) };
    } catch (e) {
      return { ok: false, error: ai.errorText(e) };
    }
  });
  ipcMain.handle('ai:ask', async (e, { id, messages }: { id: string; messages: { role: 'user' | 'assistant'; content: string }[] }) => {
    const ctl = new AbortController();
    askControllers.set(id, ctl);
    const wc: WebContents = e.sender;
    try {
      await ai.askMeetings(messages, meetingsList().filter((m) => !m.demo || setting('demoInAsk', true)), (delta) => !wc.isDestroyed() && wc.send('ai:chunk', { id, delta }), ctl.signal);
      if (!wc.isDestroyed()) wc.send('ai:done', { id });
      return { ok: true };
    } catch (err) {
      const error = ai.errorText(err);
      if (!wc.isDestroyed()) wc.send('ai:done', { id, error });
      return { ok: false, error };
    } finally {
      askControllers.delete(id);
    }
  });
  ipcMain.handle('ai:voice', async () => {
    const h = okHistory();
    const words = h.reduce((n, x) => n + (x.words ?? wordCount(x.text)), 0);
    const samples = [...h].sort((a, b) => b.ts - a.ts).slice(0, 80).map((x) => x.text.slice(0, 400));
    const byHour = new Map<string, number>();
    for (const x of h) {
      const d = new Date(x.ts);
      const k = `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getHours()}:00`;
      byHour.set(k, (byHour.get(k) ?? 0) + (x.words ?? 0));
    }
    const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const apps = new Map<string, number>();
    for (const x of h) if (x.app) apps.set(x.app, (apps.get(x.app) ?? 0) + 1);
    const topApps = [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a).join(', ');
    try {
      const p = await ai.voiceProfile(samples, `Total words: ${words}. Peak time: ${peak}. Top apps: ${topApps || 'unknown'}.`);
      return { ok: true, profile: { ...p, createdAt: Date.now(), wordsAt: words } };
    } catch (err) {
      return { ok: false, error: ai.errorText(err) };
    }
  });
  ipcMain.handle('meeting:summarize', (_e, { id }: { id: string }) => {
    const m = meetingsList().find((x) => x.id === id);
    return m ? summarize(m) : { ok: false, error: 'Meeting not found' };
  });
  ipcMain.handle('meeting:start', (_e, { title }: { title?: string }) => startMeeting(title));
  ipcMain.handle('meeting:stop', () => stopMeeting());
  ipcMain.handle('audio:get', (_e, { file }: { file: string }) => {
    const p = audioPath(String(file));
    if (!p || !existsSync(p)) return null;
    return new Uint8Array(readFileSync(p));
  });
  ipcMain.handle('audio:extract', async (_e, { file, name }: { file: string; name: string }) => {
    const p = audioPath(String(file));
    if (!p || !existsSync(p)) return { ok: false };
    const def = path.join(app.getPath('downloads'), `${String(name).replace(/[^\w -]/g, '').slice(0, 40) || 'dictation'}.wav`);
    const r = hub ? await dialog.showSaveDialog(hub, { defaultPath: def, filters: [{ name: 'WAV audio', extensions: ['wav'] }] }) : await dialog.showSaveDialog({ defaultPath: def });
    if (r.canceled || !r.filePath) return { ok: false };
    copyFileSync(p, r.filePath);
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('calendar:get', (_e, { request }: { request: boolean }) => refreshCalendar(request));
  ipcMain.handle('mcp:info', () => mcpInfo());
  ipcMain.handle('mcp:addClaude', () => addToClaude(hub));
  ipcMain.handle('notify:test', () => notify('Notifications are on', 'Roy Flow will let you know about milestones and meetings.', 'milestone'));
}

/* ------------------------------------------------------------------ lifecycle */
app.on('second-instance', () => showHub());
app.on('activate', () => showHub());
app.on('before-quit', () => {
  quitting = true;
});
/* ------------------------------------------------------------------ resource metrics (Help › Log Resource Usage, or `kill -USR2 <pid>`) */
async function logMetrics(show = false) {
  const procs = app.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? '', pid: m.pid, cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, rssMB: Math.round((m.memory.workingSetSize / 1024) * 10) / 10 }));
  const helperPid = helper.pid;
  const total = procs.reduce((n, p) => n + p.rssMB, 0);
  const snapshot = { at: new Date().toISOString(), hub: !!hub && !hub.isDestroyed() ? (hub.isVisible() ? 'visible' : 'hidden') : 'closed', phase, electronRssMB: Math.round(total), helperPid, procs };
  log('[metrics]', snapshot);
  writeJson('metrics.json', snapshot);
  if (show) dialog.showMessageBox({ type: 'info', message: `Roy Flow uses ${Math.round(total)} MB (Electron processes)`, detail: procs.map((p) => `${p.type}${p.name ? ` (${p.name})` : ''}: ${p.rssMB} MB, ${p.cpu}% CPU`).join('\n') + '\n\nThe native helper is not included. Details were written to main.log.', buttons: ['OK'] });
}
process.on('SIGUSR2', () => void logMetrics());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (muted) helper.send({ cmd: 'mute', on: false });
  saveNow();
  stopMcpServer();
  helper.kill();
});
app.on('window-all-closed', () => {
  /* stay alive in the menu bar */
});

app.whenReady().then(async () => {
  loadData();
  if (!hasData()) {
    // first run: main creates the data file, so it never depends on a hub window being open
    const s = emptyState();
    try {
      const [first = '', ...rest] = execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8' }).trim().split(' ');
      s.user = { ...s.user, firstName: first, lastName: rest.join(' ') };
    } catch {
      /* no full name */
    }
    patchData(s);
  }
  log('[app] ready', { version: app.getVersion(), packaged: app.isPackaged, helper: helper.available, data: hasData() });
  if (!isDev) serveDist();
  wireIpc();
  createTray();
  createBar();
  const atLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  // the hub window is only created when it is shown (it is destroyed again when closed)
  if (!process.argv.includes('--hidden') && !atLogin) createHub(true);
  applyDockPolicy();
  if (hasData()) applyLoginItem();
  sendHotkeys();
  await checkAccess(false);
  applyFallbackShortcuts();
  void refreshDevices();
  await refreshCalendar(false);
  startMcpServer(meetingsList, log);
  startupAnnouncements();
  scheduleAccessPoll();
  warmMic();
  applyRetention();
  setInterval(applyRetention, 6 * 3600_000);
  setInterval(() => {
    updateTrayTitle();
    meetingReminders();
  }, 1000 * 15);
  setInterval(() => {
    if (meeting) updateTrayTitle();
  }, 1000);
  setInterval(() => calendar.status === 'authorized' && void refreshCalendar(false), 5 * 60_000);
  screen.on('display-metrics-changed', () => positionBar());
  screen.on('display-removed', () => {
    barDisplay = null;
    positionBar();
  });
});
