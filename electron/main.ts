/* Roy Flow: Electron main process.
   Windows follow analysis/wispr-flow/REPORT.md Appendix A §1: a hub window (1350x850, min 1140x750,
   hidden title bar with native traffic lights at 16,15) and a transparent, frameless, always-on-top,
   click-through "status" panel that hosts the Flow Bar; plus a Scratchpad window.
   Dictation, global hotkeys (CGEventTap), paste/copy, mute, sounds and calendar run in the native helper. */
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, session as electronSession, shell, Tray, type Rectangle, type WebContents } from 'electron';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Helper, type HelperMessage } from './helper';
import { buildAppMenu, buildTrayMenu, type MenuContext, type MenuSnapshot } from './menus';
import * as ai from './ai';
import { audioDir, audioPath, getData, hasData, loadData, patchData, pruneAudio, saveNow, wipeAll } from './data';
import { rmSync } from 'node:fs';
import { LIVE_MODEL, migrateModels, WhisperServer } from './whisper';
import { addUsage, budgetState, budgetUsd, currentMonth, featureOn, FEATURE_LABEL, modelFor, usd, type AiFeature, type UsageMonth } from '../src/shared/aiUsage';
import { toWhisperWav } from './wav';
import { addSegment } from '../src/shared/echo';
import { correctionPairs, glossaryPrompt, LEARN_CHECK_AFTER_MS } from '../src/shared/learn';
import { addToClaude, mcpInfo, startMcpServer, stopMcpServer } from './mcpServer';
import { applyDictionary, applySnippets, changedWords, cleanUp, styleText, wordCount } from '../src/shared/textPipeline';
import { allActions, bindingsOf, chordLabel, defaultHotkeyMap, helperBindings, toAccelerator, type HotkeyMap } from '../src/shared/hotkeys';
import { categoryFor, styleKeyFor, type HistoryItem, type Meeting, type State, type Transform, type TranscriptSegment } from '../src/shared/types';
import { applyMutation, emptyState, migrateSettings, retainHistory } from '../src/shared/state';
import { micLabelToShow, pickFinalText, summarizeTimings, withTimeout, type DictationTiming } from '../src/shared/latency';
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
  type AiUsageStatus,
  type NavRequest,
  type StoreMutation,
  type TransformChange,
  UNLOAD_OPTIONS,
  type WhisperStatus,
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
const WHISPER_BIN = app.isPackaged ? path.join(RES, 'whisper/whisper-server') : path.join(APP_ROOT, 'vendor/whisper/whisper-server');
/** test-only: `ROYFLOW_SELFTEST_WAV=x.wav "Roy Flow.app/Contents/MacOS/Roy Flow"` runs the WAV through the Whisper
    engine path, logs the transcript and quits (does not touch the running app or its data) */
const SELFTEST_WAV = process.env.ROYFLOW_SELFTEST_WAV;

const HUB = { width: 1350, height: 850, minWidth: 1140, minHeight: 750 };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'";

app.setName('Roy Flow');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!SELFTEST_WAV && !app.requestSingleInstanceLock()) {
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
/** the live note panel while Notetaker records */
let live: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const helper = new Helper(HELPER_BIN);

/* ------------------------------------------------------------------ renderer plumbing */
function sendTo<K extends keyof EventChannels>(win: BrowserWindow | null, ch: K, payload?: EventChannels[K]) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}
const windows = () => [hub, bar, scratch, live].filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
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
  via?: string;
  /** whisper: the helper only recorded; `text` is empty until speechToText() ran */
  engine?: 'whisper' | 'apple';
  /** the WAV is a temporary file (history audio is off): delete it once transcribed */
  temp?: boolean;
}

/* ---- latency instrumentation: per-dictation timings (never text) to main.log + Help › Show Dictation Timing */
const timings: DictationTiming[] = [];
let timing: DictationTiming & { keyDownAt: number; keyUpAt?: number; finalAt?: number } = { at: '', keyDownAt: 0 };
function recordTiming(t: DictationTiming) {
  timings.push(t);
  if (timings.length > 50) timings.shift();
  log('[timing]', t);
}
function showTimings() {
  void dialog.showMessageBox({ type: 'info', message: 'Dictation timing', detail: summarizeTimings(timings) + '\n\nEach dictation is also logged to main.log as [timing].', buttons: ['OK'] });
}
/** Flow Bar mic label: shown briefly on the first dictation of a session and when the input device changes */
let lastMicLabel: string | null = null;
let finalWaiter: ((f: Final) => void) | null = null;
let session: 'dictation' | 'meeting' | null = null;

function setPhase(p: DictationPhase, extra: Partial<DictationStatus> = {}) {
  if (p !== phase) log('[dictation]', phase, '->', p, extra.error ?? '');
  if (p !== 'recording') clearCap();
  if (p === 'idle' && phase !== 'idle') armUnload();
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
  learnBeforeDictation();
  if (meeting) return failDictation('Notetaker is recording. Stop it before dictating.');
  if (!helper.available) return failDictation('Native helper missing. Run npm run native.');
  interim = '';
  permissionHint = false;
  mode = how;
  startedAt = Date.now();
  timing = { at: new Date().toISOString(), keyDownAt: how === 'ptt' && pttDownAt ? pttDownAt : startedAt };
  pendingId = uid();
  if (claudeCleanupOn() || autoApplyOn()) ai.warmConnection();
  positionBar(true);
  frontApp = { bundleId: '', name: '' };
  if (setting('contextAwareness', true))
    helper.request<{ type: 'frontmost'; bundleId: string; name: string }>({ cmd: 'frontmost' }, 'frontmost', 600).then((f) => {
      if (f) frontApp = { bundleId: f.bundleId, name: f.name };
    });
  const mic = setting('microphone', DEFAULT_MIC);
  const keepAudio = setting('localStorage', 'Store normally') !== 'Never store';
  const eng = pickEngine();
  dictEngine = eng.engine;
  engineNote = eng.note;
  // prewarm: (re)load the model while the user speaks (memory saver may have unloaded it)
  if (dictEngine === 'whisper') {
    clearTimeout(unloadTimer);
    void whisper.start().catch(() => {});
  }
  // Whisper needs the audio even when history audio is off: a temporary file, deleted once transcribed
  let record = '';
  if (keepAudio) {
    mkdirSync(audioDir(), { recursive: true });
    record = path.join(audioDir(), `${pendingId}.wav`);
  } else if (dictEngine === 'whisper') record = path.join(app.getPath('temp'), `royflow-${pendingId}.wav`);
  session = 'dictation';
  const ok = helper.send({
    cmd: 'start',
    mode: 'dictation',
    locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US',
    device: mic === DEFAULT_MIC ? '' : mic,
    record,
    engine: dictEngine,
  });
  if (!ok) return failDictation('Could not start the native helper');
  sound('start');
  setTimeout(() => phase === 'recording' && mute(true), 280);
  setPhase('recording', { kind: 'dictation' });
  armCap();
}

/* ---- 20-minute cap on one dictation, with a warning a minute before (RoyFlow) */
const MAX_DICTATION_MS = 20 * 60_000;
const CAP_WARN_MS = 60_000;
let capTimers: NodeJS.Timeout[] = [];
function clearCap() {
  capTimers.forEach(clearTimeout);
  capTimers = [];
}
function armCap() {
  clearCap();
  capTimers = [
    setTimeout(() => phase === 'recording' && notice('1 minute left in this dictation'), MAX_DICTATION_MS - CAP_WARN_MS),
    setTimeout(() => {
      if (phase !== 'recording') return;
      log('[dictation] 20-minute limit reached');
      void stopDictation().then(() => notice('Dictation stopped at the 20-minute limit'));
    }, MAX_DICTATION_MS),
  ];
}

/* ------------------------------------------------------------------ speech engine (Whisper default, Apple Speech) */
let whisper!: WhisperServer;
/** second, small Whisper for Notetaker's live words, so previews never wait behind final chunks */
let liveWhisper: WhisperServer | null = null;
let dictEngine: 'whisper' | 'apple' = 'apple';
/** why this dictation fell back to Apple Speech (shown after it is pasted) */
let engineNote: string | undefined;
const lastEngineNote = new Map<string, number>();
const MODELS_DIR = () => path.join(app.getPath('userData'), 'models');
/** where RoyFlow (the retired app) kept its models */
const OLD_MODELS_DIR = () => path.join(app.getPath('appData'), 'RoyFlow', 'models');

function initWhisper() {
  if (whisper) return;
  // first run: take over the models RoyFlow already downloaded (a rename on the same volume, no copy)
  migrateModels(OLD_MODELS_DIR(), MODELS_DIR(), undefined, log);
  let dir = MODELS_DIR();
  // the move failed (other volume?): use them where they are rather than downloading 1.7 GB again
  if (!readdirSafe(dir).some((n) => n.endsWith('.bin')) && readdirSafe(OLD_MODELS_DIR()).some((n) => n.endsWith('.bin'))) dir = OLD_MODELS_DIR();
  whisper = new WhisperServer({ bin: WHISPER_BIN, modelsDir: dir, stateFile: userFile('whisper-state.json'), log });
  liveWhisper = new WhisperServer({ bin: WHISPER_BIN, modelsDir: dir, stateFile: userFile('whisper-live-state.json'), model: LIVE_MODEL, log: (...a: unknown[]) => log('[live]', ...a) });
  let prev: WhisperStatus['server'] = 'stopped';
  whisper.on('status', (st: WhisperStatus) => {
    broadcast('whisper:status', st);
    if (st.server === prev) return;
    if (st.server === 'preparing' || (prev === 'preparing' && st.server !== 'stopped')) pinBar(6000);
    if (st.server === 'preparing') notice('Preparing speech model… This one-time step takes a few minutes; Apple Speech is used until then.');
    if (prev === 'preparing' && st.server === 'running') notice('Speech model ready');
    if (prev === 'preparing' && st.server === 'error') notice(`The speech model could not start: ${st.error ?? 'unknown error'}`, 'error');
    prev = st.server;
  });
}
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** the engine for the next dictation: Whisper when chosen and ready to load, else Apple Speech (with the reason) */
function pickEngine(): { engine: 'whisper' | 'apple'; note?: string } {
  if (setting('engine', 'whisper') !== 'whisper') return { engine: 'apple' };
  const st = whisper.status();
  if (!st.binary) return { engine: 'apple', note: 'Whisper is missing from this build, so Apple Speech was used.' };
  if (st.model === 'downloading') return { engine: 'apple', note: 'The Whisper model is still downloading, so Apple Speech was used.' };
  if (st.model === 'missing') return { engine: 'apple', note: 'The Whisper model is not downloaded (Settings › General), so Apple Speech was used.' };
  if (st.server === 'error' && !whisper.loaded) {
    void whisper.start().catch(() => {}); // try again for the next dictation
    return { engine: 'apple', note: `Whisper could not start${st.error ? ` (${st.error})` : ''}, so Apple Speech was used.` };
  }
  // the one-time Core ML compile takes minutes: never make a dictation wait for it
  if (whisper.preparing || (!whisper.loaded && !whisper.compiledBefore())) {
    void whisper.start().catch(() => {});
    return { engine: 'apple', note: 'Preparing speech model… Apple Speech is used until it is ready.' };
  }
  return { engine: 'whisper' };
}

/** show an engine fallback note at most once every 10 minutes */
function showEngineNote(note: string | undefined) {
  if (!note) return;
  const last = lastEngineNote.get(note) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  lastEngineNote.set(note, Date.now());
  notice(note);
}

const whisperLanguage = () => (LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US').slice(0, 2);

/** Whisper recordings: transcribe the WAV the helper wrote (Apple Speech results pass through unchanged) */
async function speechToText(fin: Final): Promise<Final> {
  if (fin.engine !== 'whisper') return fin;
  if (!fin.audio || !existsSync(fin.audio)) return { ...fin, text: '' };
  if (!whisper.running && !SELFTEST_WAV) setPhase('processing', { kind: 'dictation', detail: whisper.preparing ? 'Preparing speech model…' : 'Loading speech model…' });
  const { wav, seconds } = toWhisperWav(new Uint8Array(readFileSync(fin.audio)));
  if (seconds < 0.3) return { ...fin, text: '' };
  const t0 = Date.now();
  const text = await whisper.transcribe(wav, { language: whisperLanguage(), prompt: glossaryPrompt(D().dictionary ?? []), timeoutMs: 60_000 + seconds * 3000 });
  log('[whisper] transcribed', { audioSeconds: Math.round(seconds * 10) / 10, ms: Date.now() - t0, chars: text.length });
  return { ...fin, text, via: 'whisper' };
}

/** the temporary WAV of a Whisper dictation with history audio off */
function dropTemp(fin: Final): Final {
  if (!fin.temp || !fin.audio) return fin;
  rmSync(fin.audio, { force: true });
  return { ...fin, audio: null };
}

/* ---- memory saver: unload the Whisper model after N idle minutes (a key-down reloads it, ≈1.6 s) */
let unloadTimer: NodeJS.Timeout | undefined;
function armUnload() {
  clearTimeout(unloadTimer);
  if (!whisper) return;
  const min = UNLOAD_OPTIONS[setting('unloadModel', 'After 15 min')] ?? 15;
  if (!min) return;
  unloadTimer = setTimeout(() => {
    if (!whisper.loaded) return;
    // never kill the one-time compile, an active dictation or a pending Undo
    if (whisper.preparing || phase !== 'idle' || cancelled) return armUnload();
    log('[whisper] idle, unloading model', { min });
    whisper.stop();
  }, min * 60_000);
}

/** start/stop the model to match the engine setting */
function applyEngine() {
  if (setting('engine', 'whisper') === 'whisper' && whisper.usable) {
    void whisper.start().catch(() => {});
    armUnload();
  } else {
    clearTimeout(unloadTimer);
    whisper.stop();
  }
}

let permissionHint = false; // interim currently holds a permission hint, not speech
const heard = () => (permissionHint ? '' : interim);

/** recordings shorter than this, or with no words, are dropped without a message */
const MIN_RECORDING_MS = 400;

/** stop the helper and wait for its final transcript. The helper answers within ~150 ms tail + 600 ms;
    if it does not, fall back to the last partial after 1.5 s. */
function finishRecording(): Promise<Final> {
  return new Promise<Final>((resolve) => {
    const t = setTimeout(() => {
      finalWaiter = null;
      resolve({ text: heard(), audio: null, seconds: (Date.now() - startedAt) / 1000, via: 'fallback' });
    }, 1500);
    finalWaiter = (f) => {
      clearTimeout(t);
      finalWaiter = null;
      const temp = !!f.audio && path.dirname(f.audio) === path.resolve(app.getPath('temp'));
      resolve({ ...f, temp, text: f.engine === 'whisper' ? '' : pickFinalText(f.text, heard()) });
    };
    helper.send({ cmd: 'stop' });
  });
}

async function stopDictation() {
  if (phase !== 'recording') return;
  const heldMs = Date.now() - startedAt;
  timing.keyUpAt = Date.now();
  setPhase('processing', { kind: 'dictation' });
  mute(false);
  // read the clipboard (to restore it after pasting) while the helper finishes, not after
  const savedClip = saveClipboard();
  let fin = await finishRecording();
  session = null;
  if (heldMs >= MIN_RECORDING_MS && fin.engine === 'whisper') {
    try {
      fin = await speechToText(fin);
    } catch (e) {
      log('[whisper] transcription failed', String(e));
      discardAudio(fin.audio);
      interim = '';
      return failDictation(`Whisper could not transcribe this dictation: ${(e as Error).message ?? e}`);
    }
  }
  fin = dropTemp(fin);
  timing.finalAt = Date.now();
  timing.stopToFinalMs = timing.finalAt - timing.keyUpAt;
  timing.finalVia = fin.via;
  const raw = fin.text.trim();
  if (!raw || heldMs < MIN_RECORDING_MS) {
    // nothing said (or an accidental tap): drop it quietly, like Wispr does
    log('[dictation] dropped', { heldMs, chars: raw.length });
    discardAudio(fin.audio);
    interim = '';
    return setPhase('idle');
  }
  sound('stop');
  await deliver(raw, fin, pendingId, startedAt, frontApp, await savedClip, timing);
  interim = '';
  setPhase('idle');
  showEngineNote(engineNote);
}

function discardAudio(file: string | null) {
  if (file) rmSync(file, { force: true });
}

/** clean up, paste and record one dictation */
async function deliver(raw: string, fin: Final, id: string, ts: number, app: { bundleId: string; name: string }, savedClip?: ClipboardItem[], t?: typeof timing) {
  const out = await processDictation(raw, app);
  const res = await pasteText(out.text, savedClip);
  if (res.pasted) learnAfterPaste(out.text);
  if (t?.keyUpAt) {
    const now = Date.now();
    const { keyDownAt: _k, keyUpAt, finalAt, ...rest } = t;
    recordTiming({ ...rest, finalToPasteMs: finalAt ? now - finalAt : undefined, totalMs: now - keyUpAt, engine: out.engine, audioSeconds: fin.seconds, chars: out.text.length });
  }
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
    speech: fin.engine ?? 'apple',
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
  let fin = await c.raw;
  try {
    // Whisper: the cancelled audio is transcribed only now that it is wanted
    fin = dropTemp(await speechToText(fin));
  } catch (e) {
    log('[whisper] transcription failed', String(e));
    discardAudio(fin.audio);
    return failDictation(`Whisper could not transcribe this dictation: ${(e as Error).message ?? e}`);
  }
  const raw = fin.text.trim();
  if (!raw) {
    discardAudio(fin.audio);
    setPhase('idle');
    return notice('Nothing was heard in that dictation.');
  }
  await deliver(raw, fin, c.id, c.ts, c.app);
  setPhase('idle');
}

/* ------------------------------------------------------------------ auto-learn from edits (RoyFlow learn.js)
   After a paste, read the focused field (AXValue via the helper; secure fields are skipped). A few seconds later,
   if the user fixed a word we got wrong, add the corrected spelling to the dictionary. */
interface LearnWatch {
  pid: number;
  pasted: string;
  before: string;
  timers: NodeJS.Timeout[];
}
let learnWatch: LearnWatch | null = null;
function clearLearn() {
  learnWatch?.timers.forEach(clearTimeout);
  learnWatch = null;
}
async function focusedField(): Promise<{ text: string | null; pid: number } | null> {
  const r = await helper.request<{ type: 'focusedText'; text: string | null; pid: number }>({ cmd: 'focusedText' }, 'focusedText', 800);
  return r ? { text: typeof r.text === 'string' ? r.text : null, pid: Number(r.pid) || 0 } : null;
}
function learnAfterPaste(pasted: string) {
  clearLearn();
  if (!setting('autoLearn', true)) return;
  setTimeout(async () => {
    const f = await focusedField();
    // a field we cannot read, or the paste did not land in it
    if (!f || f.text == null || !f.pid || !f.text.includes(pasted.trim().slice(0, 40))) return;
    clearLearn();
    const w: LearnWatch = { pid: f.pid, pasted, before: f.text, timers: [] };
    w.timers = LEARN_CHECK_AFTER_MS.map((ms) => setTimeout(() => void learnCheck(w), ms));
    learnWatch = w;
  }, 300);
}
async function learnCheck(w: LearnWatch) {
  if (learnWatch !== w) return;
  const f = await focusedField();
  if (learnWatch !== w || !f || f.pid !== w.pid || f.text == null) return; // only the same app's field
  const known = new Set((D().dictionary ?? []).map((d) => d.word.toLowerCase()));
  const add = correctionPairs(w.pasted, w.before, f.text).filter((c) => !known.has(c.word.toLowerCase()));
  if (!add.length) return;
  clearLearn();
  const now = Date.now();
  const words = add.map((c) => ({
    id: uid(),
    word: c.word,
    // a case-only fix needs no misspelling: dictionary words already match any casing
    misspelling: c.misspelling.toLowerCase() === c.word.toLowerCase() ? undefined : c.misspelling,
    scope: 'personal' as const,
    created: now,
    auto: true,
  }));
  mainPatch({ dictionary: [...words, ...(D().dictionary ?? [])] });
  log('[learn] added to dictionary', { count: words.length });
  notice(`Added ${words.map((x) => `“${x.word}”`).join(', ')} to your dictionary`);
}
/** a new dictation is starting: last chance to see the edit */
function learnBeforeDictation() {
  const w = learnWatch;
  if (!w) return;
  void learnCheck(w).finally(() => learnWatch === w && clearLearn());
}

/* ------------------------------------------------------------------ Focus Mode (RoyFlow): hide listed apps while they are frontmost */
const focusApps = () =>
  setting('focusApps', '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
let lastFocusNotice = 0;
function focusCheck(a: { name: string; pid: number }) {
  if (!setting('focusMode', false) || !a.pid || !focusApps().includes(a.name)) return;
  void helper.request<{ type: 'hidden'; ok: boolean }>({ cmd: 'hide', pid: a.pid }, 'hidden', 1000).then((r) => {
    if (!r?.ok || Date.now() - lastFocusNotice < 4000) return;
    lastFocusNotice = Date.now();
    log('[focus] hid an app');
    notice(`${a.name} is hidden in Focus Mode`);
  });
}
function focusCheckFrontmost() {
  if (!setting('focusMode', false)) return;
  void helper.request<{ type: 'frontmost'; name: string; pid: number }>({ cmd: 'frontmost' }, 'frontmost', 800).then((f) => f && focusCheck({ name: f.name, pid: Number(f.pid) || 0 }));
}

/* ------------------------------------------------------------------ a new microphone was plugged in: offer to switch */
function onDevicesChanged(list: string[], physical: string[]) {
  const before = new Set(devices);
  const known = devices.length > 0; // the startup list arrived (else everything would look new)
  devices = list;
  rebuildMenus();
  if (!known || !setting('offerNewMic', true) || phase !== 'idle' || meeting) return;
  const fresh = physical.find((d) => !before.has(d) && d !== setting('microphone', DEFAULT_MIC));
  if (!fresh) return;
  log('[mic] new input device');
  pinBar(8000);
  notice(`${fresh} connected`, undefined, { id: `switch-mic:${fresh}`, label: 'Switch' });
}
function switchMic(name: string) {
  if (!devices.includes(name)) return;
  mainPatch({ settings: { ...(D().settings ?? {}), microphone: name } });
  notice(`Using ${name}`);
}

function toggleDictation() {
  if (phase === 'recording') stopDictation();
  else if (phase === 'idle' || phase === 'error') startDictation('toggle');
}

const claudeCleanupOn = () => ai.hasKey() && setting('aiCleanup', false);
const autoApplyOn = () => setting('autoApply', false) && setting('transformsOptIn', true) && ai.hasKey();
/** live dictation budgets: the rules result is pasted if Claude is not back in time */
const CLEANUP_TIMEOUT_MS = 900;
const AUTO_APPLY_TIMEOUT_MS = 4000;

/** clean-up (rules, instant; Claude Haiku only when enabled, with a hard timeout), style per app category,
    dictionary, snippets, optional auto-applied Transform. `live` = a dictation waiting to be pasted. */
async function processDictation(raw: string, target: { bundleId: string; name: string }, live = true): Promise<{ text: string; fixes: number; dictFixes: number; engine: 'claude' | 'rules'; note?: string }> {
  const dict = (D().dictionary ?? []).map((w) => ({ word: w.word, misspelling: w.misspelling }));
  const snippets = (D().snippets ?? []).map((s) => ({ trigger: s.trigger, expansion: s.expansion }));
  const category = categoryFor(target.bundleId);
  const style = (D().styles ?? {})[styleKeyFor(category)] ?? 'formal';
  // in code editors and terminals keep text literal: no forced capitals or full stops ("Code-aware dictation")
  const codeAware = category === 'code' && setting('codeAware', true);
  const level = codeAware ? 'Light' : setting('autoCleanup', 'Medium');
  const d1 = applyDictionary(raw, dict);
  // rule-based clean-up is synchronous: this is what gets pasted unless Claude answers within the budget
  const rules = codeAware ? cleanUp(d1.text, 'Light') : styleText(cleanUp(d1.text, level), style);
  let text = rules;
  let engine: 'claude' | 'rules' = 'rules';
  let note: string | undefined;
  if (claudeCleanupOn()) {
    const budget = live ? CLEANUP_TIMEOUT_MS : 8000;
    try {
      const t0 = Date.now();
      const out = await withTimeout(ai.cleanupDictation(d1.text, { level, style: codeAware ? 'code' : style, app: target.name, category, timeoutMs: budget }), budget, () => '');
      if (out) {
        text = out;
        engine = 'claude';
      } else log('[ai] cleanup over budget, pasted rules version', { ms: Date.now() - t0 });
    } catch (e) {
      log('[ai] cleanup failed, pasted rules version', ai.errorText(e));
    }
  }
  const d2 = applyDictionary(text, dict);
  const u = D().user;
  const sn = applySnippets(d2.text, snippets, { first: u?.firstName, last: u?.lastName, email: u?.email });
  text = sn.text;
  if (setting('autoApply', false) && setting('transformsOptIn', true)) {
    const t = transforms().find((x) => x.name === setting('autoApplyTransform', 'Polish'));
    if (t && ai.hasKey()) {
      const budget = live ? AUTO_APPLY_TIMEOUT_MS : 45_000;
      try {
        const after = await withTimeout(ai.runTransform(text, t.prompt, t.name, budget), budget, () => '');
        if (after) {
          rememberChange({ name: t.name, before: text, after });
          text = after;
        } else note = `${t.name} took too long, so the text was pasted without it.`;
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

/* ------------------------------------------------------------------ Claude spending controls */
/* Model per feature and on/off switches come from Settings › Account; every response's token usage is priced and
   added to this month's total (ai-usage.json). At 80% of the monthly budget a notification warns once; at 100%
   Claude features pause until the next month or a higher budget. Dictation and transcripts never need Claude. */
let aiUsage: UsageMonth | null = null;
const usageNow = () => (aiUsage = currentMonth(aiUsage ?? readJson<UsageMonth | null>('ai-usage.json', null)));
function aiBudget() {
  return budgetUsd(setting('aiBudget', 'No limit'));
}
function aiUsageStatus(): AiUsageStatus {
  const u = usageNow();
  const budget = aiBudget();
  return { usage: u, budget, state: budgetState(u.usd, budget) };
}
function installAiControls() {
  ai.setControls({
    modelFor: (f: AiFeature) => modelFor(f, D().settings ?? {}),
    blocked: (f: AiFeature) => {
      if (f !== 'test' && !featureOn(f, D().settings ?? {})) return `${FEATURE_LABEL[f]} with Claude is turned off in Settings › Account.`;
      const u = usageNow();
      const budget = aiBudget();
      if (f !== 'test' && budgetState(u.usd, budget) === 'over')
        return `Your monthly Claude budget of ${usd(budget!)} is used up (${usd(u.usd)} spent). Raise it in Settings › Account, or wait until next month.`;
      return null;
    },
    record: (f, model, usage) => {
      const prev = usageNow();
      const next = addUsage(prev, f, model, usage);
      const budget = aiBudget();
      const state = budgetState(next.usd, budget);
      if (state !== 'ok' && !next.warned) {
        next.warned = true;
        notify(
          state === 'over' ? 'Claude budget used up' : 'Claude budget at 80%',
          `${usd(next.usd)} of your ${usd(budget!)} monthly budget is spent.${state === 'over' ? ' Claude features are paused until next month.' : ''}`,
          'suggestion',
          () => showHub({ settings: 'account' }),
        );
      }
      aiUsage = next;
      writeJson('ai-usage.json', next);
      broadcast('ai:usage', aiUsageStatus());
    },
  });
}

/* ------------------------------------------------------------------ Notetaker (meeting recording) */
/* With Whisper (the default) the helper cuts the mic into short WAV chunks at pauses; each chunk is transcribed
   in order while the meeting goes on, with the language detected per chunk (Wispr's "French detected").
   Stop saves the note at once, opens it in the hub, finishes the queued chunks, then writes the summary. */
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
  engine: 'whisper' | 'apple';
  chunkDir?: string;
  /** chunk transcriptions run one after another */
  queue: Promise<void>;
  pending: number;
  langVotes: Record<string, number>;
  language?: string;
  translate: boolean;
  thoughts: string;
  /** seconds already in a resumed note */
  offset: number;
  resumed: boolean;
  stage: 'recording' | 'finishing';
  /** live words of the chunk still being spoken, per side (Whisper previews), and which chunk they belong to */
  live: { mic: string; system: string };
  liveIdx: { mic: number; system: number };
  previewTimer?: NodeJS.Timeout;
  previewBusy?: boolean;
  previewTurn?: number;
  previewAt?: number;
  /** chunks waiting for Whisper, with the words Apple heard in them */
  waiting: { file: string; who: 'you' | 'them'; text: string; t: number; index?: number }[];
  systemAudio?: 'on' | 'off' | 'error';
}
let meeting: MeetingRun | null = null;
/** a stopped meeting whose last chunks are still being transcribed */
let finishing: MeetingRun | null = null;
let meetingFinal: ((ok: boolean) => void) | null = null;

const MAX_LEN: Record<string, number> = { '30 min': 30, '1 hour': 60, '2 hours': 120, '4 hours': 240 };
const isEnglish = (lang?: string) => !lang || /^(english|en)$/i.test(lang);
function meetingStatus(): MeetingStatus {
  const m = meeting ?? finishing;
  return m
    ? {
        recording: !!meeting,
        startedAt: m.startedAt,
        title: m.title,
        partial: m.partial,
        segments: m.segments,
        error: m.error,
        id: m.id,
        stage: m.stage,
        pending: m.pending,
        language: m.language,
        translate: m.translate,
        thoughts: m.thoughts,
        engine: m.engine,
        offset: m.offset,
        systemAudio: m.systemAudio,
        interim: [
          ...m.waiting.map((w) => ({ who: w.who, text: w.text, t: w.t })),
          ...(m.live.mic.trim() ? [{ who: 'you' as const, text: m.live.mic, t: m.offset + (Date.now() - m.startedAt) / 1000 }] : []),
          ...(m.live.system.trim() ? [{ who: 'them' as const, text: m.live.system, t: m.offset + (Date.now() - m.startedAt) / 1000 }] : []),
        ],
      }
    : { recording: false, startedAt: 0, title: '', partial: '', segments: [] };
}
let statusTimer: NodeJS.Timeout | undefined;
function pushMeetingStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    broadcast('meeting:status', meetingStatus());
  }, 120);
}

/* ---- the live note panel: a narrow window on the right edge while Notetaker records (Wispr's side panel) */
function showLive() {
  if (live && !live.isDestroyed()) {
    live.showInactive();
    sendTo(live, 'meeting:status', meetingStatus());
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readJson<Partial<Bounds>>('live-note-window.json', {});
  const width = saved.width ?? 440;
  const height = saved.height ?? Math.min(820, area.height - 40);
  const pos = saved.x !== undefined && visibleOnSomeDisplay(saved as Bounds) ? { x: saved.x, y: saved.y } : { x: area.x + area.width - width - 16, y: area.y + 20 };
  live = new BrowserWindow({
    title: 'Live note',
    width,
    height,
    ...pos,
    minWidth: 360,
    minHeight: 420,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: D().theme === 'dark' ? '#1f1f1e' : '#ffffff',
    show: false,
    webPreferences,
  });
  live.setAlwaysOnTop(true, 'floating');
  live.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadPage(live, 'index.html', '?window=livenote');
  live.once('ready-to-show', () => {
    live?.showInactive();
    sendTo(live, 'meeting:status', meetingStatus());
  });
  const save = () => live && !live.isDestroyed() && writeJson('live-note-window.json', live.getNormalBounds());
  live.on('moved', save);
  live.on('resized', save);
  live.on('closed', () => (live = null));
}
function closeLive() {
  if (live && !live.isDestroyed()) live.close();
  live = null;
}

/** the engine for a meeting: Whisper whenever it is chosen and its files are there (chunks wait while the
    model loads or compiles, so nothing is lost), else Apple Speech */
function meetingEngine(): 'whisper' | 'apple' {
  if (setting('engine', 'whisper') !== 'whisper') return 'apple';
  const st = whisper.status();
  return st.binary && st.model === 'ready' ? 'whisper' : 'apple';
}

async function startMeeting(title?: string, resumeId?: string): Promise<{ ok: boolean; error?: string }> {
  if (meeting) {
    showLive();
    return { ok: true };
  }
  if (finishing) return { ok: false, error: 'Notetaker is still finishing the last note. Try again in a moment.' };
  if (phase === 'recording' || phase === 'processing') return { ok: false, error: 'Finish your dictation first.' };
  if (!helper.available) return { ok: false, error: 'Native helper missing.' };
  const now = Date.now();
  const prev = resumeId ? meetingsList().find((x) => x.id === resumeId) : undefined;
  if (resumeId && !prev) return { ok: false, error: 'That note no longer exists.' };
  const ev = calendar.events.find((e) => !e.allDay && e.start - 5 * 60_000 <= now && e.end >= now);
  const engine = meetingEngine();
  const id = prev?.id ?? uid();
  const offset = prev ? (prev.durationSec ?? prev.minutes * 60) : 0;
  meeting = {
    id,
    startedAt: now,
    title: prev?.title ?? (title || ev?.title || 'New note'),
    segments: [...(prev?.transcript ?? [])],
    partial: '',
    lastVoice: now,
    timers: [],
    warned: false,
    engine,
    chunkDir: engine === 'whisper' ? path.join(app.getPath('temp'), `royflow-meeting-${id}-${now}`) : undefined,
    queue: Promise.resolve(),
    pending: 0,
    langVotes: {},
    language: prev?.language,
    translate: !!prev?.translated,
    thoughts: prev?.thoughts ?? '',
    offset,
    resumed: !!prev,
    stage: 'recording',
    live: { mic: '', system: '' },
    liveIdx: { mic: -1, system: -1 },
    waiting: [],
  };
  session = 'meeting';
  if (engine === 'whisper' && !setting('meetingSystemAudio', true)) meeting.systemAudio = 'off';
  const mic = setting('microphone', DEFAULT_MIC);
  helper.send({
    cmd: 'start',
    mode: 'meeting',
    locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US',
    device: mic === DEFAULT_MIC ? '' : mic,
    ...(engine === 'whisper' ? { engine: 'whisper', chunks: meeting.chunkDir, system: setting('meetingSystemAudio', true) } : {}),
  });
  if (engine === 'whisper') {
    void whisper.start().catch(() => {}); // load (or compile) the model while people talk
    if (liveWhisper?.hasModel()) void liveWhisper.start().catch(() => {});
    else if (liveWhisper && !liveWhisper.status().download) void liveWhisper.downloadModel({ coreml: false }).catch((e) => log('[live] download failed', String(e)));
    const run = meeting;
    run.previewTimer = setInterval(() => requestPreview(run), 300);
  }
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
  log('[meeting] started', { engine, resumed: !!prev });
  if (setting('liveTranscript', true) !== false) showLive();
  pushMeetingStatus();
  pushBarConfig();
  updateBarVisibility();
  updateTrayTitle();
  rebuildMenus();
  return { ok: true };
}

/** a chunk the helper closed: transcribe it after the ones before it. "heard" is what Apple's recognizer showed
    live for it; it stays on screen (greyed) until Whisper's text replaces it. */
function onMeetingChunk(file: string, start: number, source: string, seconds: number) {
  const m = meeting ?? finishing;
  if (!m || m.engine !== 'whisper' || !m.chunkDir || !file.startsWith(m.chunkDir)) return void rmSync(file, { force: true });
  const who: 'you' | 'them' = source === 'system' ? 'them' : 'you';
  const side = who === 'them' ? 'system' : 'mic';
  const index = Number(/(\d+)\.wav$/.exec(file)?.[1] ?? -1);
  // the live words shown for this chunk stay (greyed) until Whisper's final text replaces them
  const heard = m.liveIdx[side] === index ? m.live[side] : '';
  m.waiting.push({ file, who, text: heard, t: m.offset + start, index } as MeetingRun['waiting'][number]);
  m.live[side] = '';
  m.pending++;
  pushMeetingStatus();
  m.queue = m.queue.then(async () => {
    try {
      const { wav, seconds: audioSec } = toWhisperWav(new Uint8Array(readFileSync(file)));
      const t0 = Date.now();
      const r = await whisper.transcribeDetailed(wav, { language: 'auto', prompt: glossaryPrompt(D().dictionary ?? []), timeoutMs: 20 * 60_000 });
      if (MEETING_TRACE) appendFileSync(MEETING_TRACE, JSON.stringify({ ms: Date.now(), type: 'whisper', source, start, text: r.text, language: r.language }) + '\n');
      log('[meeting] chunk', { source, audioSeconds: Math.round(audioSec * 10) / 10, ms: Date.now() - t0, chars: r.text.length, language: r.language });
      if (r.text) {
        const seg: TranscriptSegment = { t: Math.round((m.offset + start) * 10) / 10, d: Math.round((seconds || audioSec) * 10) / 10, text: r.text, at: m.startedAt + start * 1000, ...(who === 'them' ? { who } : {}) };
        const before = m.segments.length;
        m.segments = addSegment(m.segments, seg);
        if (m.segments.length <= before) log('[meeting] dropped an echo', { source, chars: r.text.length });
        if (r.language && r.text.length >= 12) {
          m.langVotes[r.language] = (m.langVotes[r.language] ?? 0) + r.text.length;
          m.language = Object.entries(m.langVotes).sort((a, b) => b[1] - a[1])[0][0];
        }
        if (m.translate && !isEnglish(m.language)) void translateSegments(m.segments, () => pushMeetingStatus());
      }
    } catch (e) {
      log('[meeting] chunk failed', String(e));
      m.error = `A part of the recording could not be transcribed: ${(e as Error).message ?? e}`;
    } finally {
      rmSync(file, { force: true });
      m.waiting = m.waiting.filter((w) => w.file !== file);
      m.pending--;
      pushMeetingStatus();
    }
  });
}

/* ---- live words: while Whisper has nothing queued, transcribe the sentence still being spoken (about every
   2 s, taking turns between your mic and the call). Final chunks always go first. */
function requestPreview(m: MeetingRun) {
  if (m.previewBusy && Date.now() - (m.previewAt ?? 0) > 30_000) m.previewBusy = false; // never stuck on a lost reply
  const fast = !!liveWhisper?.running;
  // with the small model, previews run beside the final chunks; without it they wait their turn on the big one
  if (meeting !== m || m.previewBusy || (!fast && (m.pending > 0 || !whisper.running))) return;
  const sides: ('mic' | 'system')[] = m.systemAudio === 'on' ? ['mic', 'system'] : ['mic'];
  m.previewTurn = ((m.previewTurn ?? -1) + 1) % sides.length;
  m.previewBusy = true;
  m.previewAt = Date.now();
  helper.send({ cmd: 'preview', source: sides[m.previewTurn] });
}
async function onMeetingPreview(msg: HelperMessage) {
  const m = meeting;
  if (!m) return;
  const side = msg.source === 'system' ? 'system' : 'mic';
  if (msg.none || typeof msg.path !== 'string') {
    m.previewBusy = false;
    return;
  }
  const index = Number(msg.index);
  try {
    const { wav } = toWhisperWav(new Uint8Array(readFileSync(msg.path)));
    const t0 = Date.now();
    const fast = liveWhisper?.running ? liveWhisper : null;
    const r = await (fast ?? whisper).transcribeDetailed(wav, { language: 'auto', prompt: glossaryPrompt(D().dictionary ?? []), timeoutMs: 30_000 });
    if (MEETING_TRACE) appendFileSync(MEETING_TRACE, JSON.stringify({ ms: Date.now(), type: 'preview', source: side, index, seconds: msg.seconds, text: r.text, model: fast ? 'live' : 'main', whisperMs: Date.now() - t0 }) + '\n');
    const w = m.waiting.find((x) => x.index === index && x.who === (side === 'system' ? 'them' : 'you'));
    if (w) w.text = r.text || w.text; // the chunk closed while this was being transcribed
    else if (r.text) {
      m.live[side] = r.text;
      m.liveIdx[side] = index;
    }
    pushMeetingStatus();
  } catch (e) {
    log('[meeting] preview failed', String(e));
  } finally {
    m.previewBusy = false;
  }
}

/** fill in .tr (English) for segments that have none; Claude, in batches */
const translating = new WeakSet<TranscriptSegment>();
async function translateSegments(segs: TranscriptSegment[], onUpdate: () => void) {
  const todo = segs.filter((s) => !s.tr && !translating.has(s));
  if (!todo.length) return;
  todo.forEach((s) => translating.add(s));
  try {
    for (let i = 0; i < todo.length; i += 40) {
      const batch = todo.slice(i, i + 40);
      const out = await ai.translateLines(batch.map((s) => s.text));
      batch.forEach((s, k) => (s.tr = out[k] || s.text));
      onUpdate();
    }
  } finally {
    todo.forEach((s) => translating.delete(s));
  }
}

function saveMeetingNote(m: MeetingRun, patch: Partial<Meeting>) {
  const exists = meetingsList().some((x) => x.id === m.id);
  if (exists) mutate({ collection: 'meetings', op: 'patch', id: m.id, patch });
  else mutate({ collection: 'meetings', op: 'add', item: { id: m.id, title: m.title, ts: m.startedAt, minutes: 1, people: 1, overview: '', actionItems: [], ...patch } as Meeting });
}

async function stopMeeting(reason?: string) {
  const m = meeting;
  if (!m) return;
  m.timers.forEach((t) => clearInterval(t));
  clearInterval(m.previewTimer);
  liveWhisper?.stop(); // free its memory until the next meeting
  m.live = { mic: '', system: '' };
  m.stage = 'finishing';
  meeting = null;
  finishing = m;
  pushMeetingStatus();
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 9000);
    meetingFinal = (v) => {
      clearTimeout(t);
      resolve(v);
    };
    helper.send({ cmd: 'stop' });
  });
  meetingFinal = null;
  session = null;
  if (!ok) log('[meeting] stop timed out');
  if (m.partial.trim() && !m.segments.some((s) => s.text === m.partial.trim())) m.segments.push({ t: m.offset + (Date.now() - m.startedAt) / 1000, text: m.partial.trim() });
  m.partial = '';
  sound('stop');
  const durationSec = m.offset + Math.round((Date.now() - m.startedAt) / 1000);
  const base: Partial<Meeting> = {
    title: m.title,
    minutes: Math.max(1, Math.round(durationSec / 60)),
    durationSec,
    transcript: [...m.segments],
    thoughts: m.thoughts,
    language: m.language,
    translated: m.translate,
    summaryStatus: 'pending',
    step: 1,
  };
  if (!m.resumed) base.ts = m.startedAt;
  saveMeetingNote(m, base);
  log('[meeting] saved', { segments: m.segments.length, durationSec, pending: m.pending });
  if (reason) notify('Notetaker stopped', `${reason}. Your note “${m.title}” was saved.`, 'notetaker');
  // Wispr: the panel turns into the full note in the main window
  closeLive();
  showHub({ page: 'notetaker', meeting: m.id });
  pushBarConfig();
  updateBarVisibility();
  updateTrayTitle();
  rebuildMenus();
  await m.queue; // the last chunks
  if (m.chunkDir) rmSync(m.chunkDir, { recursive: true, force: true });
  finishing = null;
  pushMeetingStatus();
  const transcript = [...m.segments].sort((a, b) => a.t - b.t);
  const canSummarize = ai.hasKey() && featureOn('summaries', D().settings ?? {});
  saveMeetingNote(m, { transcript, language: m.language, step: 2, summaryStatus: transcript.length ? (canSummarize ? 'pending' : ai.hasKey() ? 'done' : 'nokey') : 'done' });
  const rec = meetingsList().find((x) => x.id === m.id);
  if (rec && transcript.length && canSummarize) {
    const r = await summarize(rec);
    if (r.ok) {
      const done = meetingsList().find((x) => x.id === m.id);
      notify('Your notes are ready', `That was ${done?.minutes ?? 1} min. Here's the short version.`, 'notetaker', () => showHub({ page: 'notetaker', meeting: m.id }));
    }
  } else saveMeetingNote(m, { step: undefined });
}

async function summarize(m: Meeting): Promise<{ ok: boolean; error?: string }> {
  if (!m.transcript?.length) return { ok: false, error: 'This note has no transcript to summarise.' };
  if (!ai.hasKey()) {
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'nokey', step: undefined } });
    return { ok: false, error: new ai.NoKeyError().message };
  }
  mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'pending', step: 2 } });
  try {
    const s = await ai.summarizeMeeting(m);
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { title: /^(New note|Untitled|Meeting [A-Z][a-z]{2} \d)/.test(m.title) ? s.title : m.title, overview: s.overview, sections: s.sections, actionItems: s.actionItems, summaryStatus: 'done', summaryError: undefined, step: undefined } });
    return { ok: true };
  } catch (e) {
    const error = ai.errorText(e);
    mutate({ collection: 'meetings', op: 'patch', id: m.id, patch: { summaryStatus: 'error', summaryError: error, step: undefined } });
    return { ok: false, error };
  }
}

const toggleMeeting = () => (meeting ? void stopMeeting() : void startMeeting().then((r) => !r.ok && notice(r.error ?? 'Could not start Notetaker', 'error')));

/* ------------------------------------------------------------------ helper messages */
/** test-only: ROYFLOW_MEETING_TRACE=1 writes the arrival time of every live word update and chunk to
    logs/meeting-trace.ndjson, to measure how quickly words appear */
const MEETING_TRACE = process.env.ROYFLOW_MEETING_TRACE ? path.join(app.getPath('logs'), 'meeting-trace.ndjson') : null;
helper.on('message', (m: HelperMessage) => {
  if (MEETING_TRACE && session === 'meeting' && ['chunk', 'system'].includes(m.type))
    appendFileSync(MEETING_TRACE, JSON.stringify({ ms: Date.now(), type: m.type, source: m.source, text: m.text ?? m.heard, start: m.start, seconds: m.seconds }) + '\n');
  if (!['level', 'partial', 'keys', 'segment', 'access', 'activated', 'focusedText', 'frontmost', 'chunk', 'preview'].includes(m.type)) log('[helper]', m.type === 'final' ? { type: 'final', chars: String(m.text ?? '').length, via: m.via, stopMs: m.stopMs } : m);
  switch (m.type) {
    case 'partial':
      if (session === 'meeting' && meeting) {
        if (meeting.engine === 'whisper') meeting.live[m.source === 'system' ? 'system' : 'mic'] = String(m.text ?? '');
        else meeting.partial = String(m.text ?? '');
        pushMeetingStatus();
        break;
      }
      permissionHint = false;
      interim = String(m.text ?? '');
      if (phase === 'recording') broadcast('dictation:status', { phase, interim, kind: 'dictation' });
      break;
    case 'chunk':
      onMeetingChunk(String(m.path ?? ''), Number(m.start) || 0, String(m.source ?? 'mic'), Number(m.seconds) || 0);
      break;
    case 'preview':
      void onMeetingPreview(m);
      break;
    case 'system':
      if (meeting) {
        meeting.systemAudio = m.ok ? 'on' : 'error';
        if (!m.ok) log('[meeting] system audio unavailable', m.error);
        pushMeetingStatus();
      }
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
      if (m.mode !== 'meeting' && phase === 'recording') {
        timing.helperStartMs = typeof m.ms === 'number' ? m.ms : undefined;
        timing.keyToMicMs = Date.now() - timing.keyDownAt;
        const label = micLabelToShow(String(m.deviceName || m.device || ''), lastMicLabel);
        if (label) {
          lastMicLabel = label;
          sendTo(bar, 'flowbar:mic', label);
        }
      }
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
      else finalWaiter?.({ text: String(m.text ?? ''), audio: typeof m.audio === 'string' ? m.audio : null, seconds: Number(m.seconds) || 0, via: typeof m.via === 'string' ? m.via : undefined, engine: m.engine === 'whisper' ? 'whisper' : 'apple' });
      break;
    case 'activated':
      focusCheck({ name: String(m.name ?? ''), pid: Number(m.pid) || 0 });
      break;
    case 'devices':
      if (m.changed && Array.isArray(m.devices)) onDevicesChanged(m.devices.map(String), Array.isArray(m.physical) ? m.physical.map(String) : []);
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
          if (meeting.chunkDir) rmSync(meeting.chunkDir, { recursive: true, force: true });
          meeting = null;
          session = null;
          closeLive();
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
  await new Promise((r) => setTimeout(r, 15));
  // the helper checks Accessibility itself before posting ⌘V (one round trip instead of two)
  const r = await helper.request<{ type: 'pasted'; ok: boolean; reason?: string }>({ cmd: 'paste' }, 'pasted');
  if (r?.reason === 'accessibility') {
    void checkAccess(false);
    return { pasted: false, reason: 'Copied to the clipboard. Allow Accessibility access so Roy Flow can paste for you.' };
  }
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
  showTimings,
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
    if (s.engine !== p.engine) applyEngine();
    if (s.unloadModel !== p.unloadModel) armUnload();
    if (s.focusMode !== p.focusMode || s.focusApps !== p.focusApps) focusCheckFrontmost();
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
    else if (typeof id === 'string' && id.startsWith('switch-mic:')) switchMic(id.slice(11));
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
  ipcMain.handle('ai:usage', () => aiUsageStatus());
  ipcMain.handle('ai:setKey', (_e, { key }: { key: string }) => ai.setKey(String(key ?? '')));
  ipcMain.handle('ai:clearKey', () => ai.clearKey());
  ipcMain.handle('ai:test', () => ai.testKey());
  ipcMain.handle('ai:cleanup', async (_e, { id }: { id: string }) => {
    const h = (D().history ?? []).find((x) => x.id === id);
    if (!h) return { ok: false, error: 'Transcript not found' };
    const raw = h.original ?? h.text;
    const out = await processDictation(raw, { bundleId: h.bundleId ?? '', name: h.app ?? '' }, false).catch(() => null);
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
  ipcMain.handle('meeting:start', (_e, { title, resumeId }: { title?: string; resumeId?: string }) => startMeeting(title, resumeId));
  ipcMain.handle('meeting:stop', () => stopMeeting());
  ipcMain.handle('meeting:translate', async (_e, { on, id }: { on: boolean; id?: string }) => {
    if (on && !ai.hasKey()) return { ok: false, error: 'Translating uses Claude. ' + new ai.NoKeyError().message };
    const run = meeting ?? finishing;
    try {
      if (!id || id === run?.id) {
        if (!run) return { ok: false, error: 'Notetaker is not recording.' };
        run.translate = on;
        pushMeetingStatus();
        if (on) await translateSegments(run.segments, () => pushMeetingStatus());
        return { ok: true };
      }
      const rec = meetingsList().find((x) => x.id === id);
      if (!rec) return { ok: false, error: 'Meeting not found' };
      mutate({ collection: 'meetings', op: 'patch', id, patch: { translated: on } });
      if (on) {
        const segs = (rec.transcript ?? []).map((x) => ({ ...x }));
        await translateSegments(segs, () => mutate({ collection: 'meetings', op: 'patch', id, patch: { transcript: segs.map((x) => ({ ...x })) } }));
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: ai.errorText(e) };
    }
  });
  ipcMain.handle('meeting:catchup', async (_e, { question }: { question?: string }) => {
    const run = meeting ?? finishing;
    if (!run) return { ok: false, error: 'Notetaker is not recording.' };
    if (!run.segments.length) return { ok: true, text: 'Nothing has been said yet.' };
    try {
      return { ok: true, text: await ai.catchUp(run.segments, question, run.offset + (Date.now() - run.startedAt) / 1000) };
    } catch (e) {
      return { ok: false, error: ai.errorText(e) };
    }
  });
  ipcMain.handle('meeting:thoughts', (_e, { text, title }: { text?: string; title?: string }) => {
    const run = meeting ?? finishing;
    if (!run) return;
    if (text !== undefined) run.thoughts = String(text);
    if (title !== undefined) run.title = String(title).trim() || 'New note';
  });
  ipcMain.handle('meeting:live', (_e, { show }: { show: boolean }) => (show ? meeting && showLive() : closeLive()));
  ipcMain.handle('meeting:open', (_e, { id }: { id: string }) => showHub({ page: 'notetaker', meeting: id }));
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
  ipcMain.handle('whisper:status', () => whisper.status());
  ipcMain.handle('whisper:download', async () => {
    try {
      await whisper.downloadModel();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('apps:installed', () => {
    const names = new Set<string>();
    for (const d of ['/Applications', '/System/Applications', path.join(app.getPath('home'), 'Applications')])
      for (const f of readdirSafe(d)) if (f.endsWith('.app')) names.add(f.slice(0, -4));
    names.delete('Roy Flow');
    return [...names].sort((a, b) => a.localeCompare(b));
  });
  ipcMain.handle('notify:test', () => notify('Notifications are on', 'Roy Flow will let you know about milestones and meetings.', 'milestone'));
}

/* ------------------------------------------------------------------ latency test (test-only: `open -a "Roy Flow" --args --latency-test a.wav,b.wav --latency-out out.json`)
   Runs the helper's --file mode as a child of the app, so it uses the app's Speech Recognition permission. */
function runLatencyTest() {
  const argv = process.argv;
  const files = (argv[argv.indexOf('--latency-test') + 1] ?? '').split(',').filter(Boolean);
  const outIdx = argv.indexOf('--latency-out');
  const outFile = outIdx > 0 ? argv[outIdx + 1] : path.join(app.getPath('logs'), 'latency-test.json');
  const results: unknown[] = [];
  for (const f of files) {
    for (let run = 0; run < 3; run++) {
      try {
        const line = execFileSync(helper.bin, ['--file', f], { encoding: 'utf8', timeout: 120_000 }).trim().split('\n').pop() ?? '{}';
        const r = JSON.parse(line) as Record<string, unknown>;
        results.push(r);
        const { fast_text: _a, final_text: _b, ...noText } = r;
        log('[latency-test]', noText);
      } catch (e) {
        results.push({ file: path.basename(f), error: String(e).slice(0, 200) });
        log('[latency-test] failed', path.basename(f));
      }
    }
  }
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  app.exit(0);
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
  whisper?.stop();
  liveWhisper?.stop();
  helper.kill();
});
app.on('window-all-closed', () => {
  /* stay alive in the menu bar */
});

/* ------------------------------------------------------------------ Whisper self-test (test-only, see SELFTEST_WAV) */
async function runWhisperSelfTest(file: string) {
  const out = process.env.ROYFLOW_SELFTEST_OUT || path.join(app.getPath('logs'), 'whisper-selftest.json');
  const result: Record<string, unknown> = { file, at: new Date().toISOString(), bin: WHISPER_BIN };
  let code = 1;
  try {
    initWhisper();
    result.status = whisper.status();
    result.compiledBefore = whisper.compiledBefore();
    log('[selftest] whisper', result.status, { compiledBefore: result.compiledBefore });
    const t0 = Date.now();
    await whisper.start();
    result.startMs = Date.now() - t0;
    const t1 = Date.now();
    // the same path a dictation takes: helper WAV -> 16 kHz mono -> whisper-server -> dictionary + rule clean-up
    const fin = await speechToText({ text: '', audio: file, seconds: 0, engine: 'whisper' });
    result.transcribeMs = Date.now() - t1;
    result.transcript = fin.text;
    const dict = (D().dictionary ?? []).map((w) => ({ word: w.word, misspelling: w.misspelling }));
    result.cleaned = cleanUp(applyDictionary(fin.text, dict).text, 'Medium');
    log('[selftest] transcript:', fin.text);
    code = fin.text.trim() ? 0 : 2;
    if (process.env.ROYFLOW_SELFTEST_AI) {
      // one real key test (Haiku, a few tokens) through the spending controls
      result.aiTest = await ai.testKey();
      result.aiUsage = aiUsageStatus();
    }
    if (process.env.ROYFLOW_SELFTEST_MEETING) {
      // the Notetaker path: two helper chunks -> ordered Whisper transcription with language detection
      const now = Date.now();
      const run: MeetingRun = {
        id: 'selftest', startedAt: now, title: 'New note', segments: [], partial: '', lastVoice: now, timers: [], warned: false, engine: 'whisper',
        chunkDir: path.join(app.getPath('temp'), `royflow-meeting-selftest-${now}`), queue: Promise.resolve(), pending: 0, langVotes: {}, translate: false,
        thoughts: '', offset: 0, resumed: false, stage: 'recording', live: { mic: '', system: '' }, liveIdx: { mic: -1, system: -1 }, waiting: [],
      };
      mkdirSync(run.chunkDir!, { recursive: true });
      finishing = run;
      const t2 = Date.now();
      [0, 1].forEach((k) => {
        const f = path.join(run.chunkDir!, `0000${k + 1}.wav`);
        copyFileSync(file, f);
        onMeetingChunk(f, k * 10, k ? 'system' : 'mic', 5);
      });
      result.meetingPendingAfterQueue = run.pending;
      await run.queue;
      finishing = null;
      result.meeting = { ms: Date.now() - t2, segments: run.segments, language: run.language, pending: run.pending, chunksLeft: readdirSync(run.chunkDir!).length, error: run.error };
      rmSync(run.chunkDir!, { recursive: true, force: true });
      if (run.segments.length !== 2 || run.pending !== 0) code = 3;
    }
  } catch (e) {
    result.error = String(e);
    log('[selftest] failed', String(e));
  } finally {
    whisper?.stop();
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(code);
  }
}

app.whenReady().then(async () => {
  loadData();
  installAiControls();
  if (SELFTEST_WAV) return void runWhisperSelfTest(SELFTEST_WAV);
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
  const migrated = migrateSettings(D().settings);
  if (migrated) {
    patchData({ settings: migrated });
    log('[app] settings migrated (1.3: Flow Bar at the bottom, Claude clean-up opt-in)');
  }
  log('[app] ready', { version: app.getVersion(), packaged: app.isPackaged, helper: helper.available, data: hasData() });
  if (process.argv.includes('--latency-test')) return void runLatencyTest();
  if (!isDev) serveDist();
  initWhisper();
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
  applyEngine();
  focusCheckFrontmost();
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
