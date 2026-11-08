/* Roy Flow: Electron main process.
   Windows follow analysis/wispr-flow/REPORT.md Appendix A §1: a hub window (1350x850, min 1140x750,
   hidden title bar with native traffic lights at 16,15) and a transparent, frameless, always-on-top,
   click-through "status" panel that hosts the Flow Bar. Dictation and paste run in the native helper. */
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray, type Rectangle } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Helper, type HelperMessage } from './helper';
import { buildAppMenu, buildTrayMenu, type MenuContext } from './menus';
import { processTranscript, wordCount } from '../src/shared/textPipeline';
import {
  DEFAULT_MIC,
  DEFAULT_TOGGLE_SHORTCUT,
  LANGUAGE_LOCALES,
  acceleratorLabel,
  type DictationPhase,
  type DictationStatus,
  type DockEdge,
  type EventChannels,
  type FlowBarConfig,
  type NavRequest,
  type StateSnapshot,
} from '../src/shared/ipc';

const DEV_URL = process.env.ROYFLOW_DEV_URL; // set by `npm run app:dev`
const isDev = !!DEV_URL;
const APP_ROOT = path.join(__dirname, '..');
const DIST = path.join(APP_ROOT, 'dist');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const RES = app.isPackaged ? process.resourcesPath : APP_ROOT;
const HELPER_BIN = app.isPackaged ? path.join(process.resourcesPath, 'RoyFlowHelper') : path.join(APP_ROOT, 'native/build/RoyFlowHelper');
const TRAY_ICON = app.isPackaged ? path.join(RES, 'tray/trayTemplate.png') : path.join(APP_ROOT, 'resources/trayTemplate.png');

const HUB = { width: 1350, height: 850, minWidth: 1140, minHeight: 750 };
const PASTE_LAST = 'Control+Command+V';
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

/* ------------------------------------------------------------------ persisted main-side state */
const userFile = (name: string) => path.join(app.getPath('userData'), name);
function readJson<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(userFile(name), 'utf8')) };
  } catch {
    return fallback;
  }
}
function writeJson(name: string, data: unknown) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(userFile(name), JSON.stringify(data));
  } catch (e) {
    console.warn('could not save', name, e);
  }
}

const EMPTY_SNAPSHOT: StateSnapshot = {
  settings: { showFlowBar: true, showInDock: false, flowBarDock: 'Bottom', toggleShortcut: DEFAULT_TOGGLE_SHORTCUT, microphone: DEFAULT_MIC, language: 'English', sounds: true },
  dictionary: [],
  snippets: [],
  lastTranscript: '',
  totalWords: 0,
  dictionaryCount: 0,
  snippetCount: 0,
  pastNotes: [],
  theme: 'light',
};

let snap: StateSnapshot = readJson('snapshot.json', EMPTY_SNAPSHOT);
let devices: string[] = [];
let hub: BrowserWindow | null = null;
let bar: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const helper = new Helper(HELPER_BIN);

const setting = <T extends string | boolean>(k: string, d: T): T => (snap.settings[k] ?? d) as T;

/* ------------------------------------------------------------------ renderer plumbing */
function sendTo<K extends keyof EventChannels>(win: BrowserWindow | null, ch: K, payload?: EventChannels[K]) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}
const broadcast = <K extends keyof EventChannels>(ch: K, payload?: EventChannels[K]) => {
  sendTo(hub, ch, payload);
  sendTo(bar, ch, payload);
};

function loadPage(win: BrowserWindow, page: 'index.html' | 'flowbar.html') {
  if (DEV_URL) win.loadURL(`${DEV_URL}/${page}`);
  else win.loadURL(`app://roy-flow/${page}`);
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
    backgroundColor: snap.theme === 'dark' ? '#1f1f1e' : '#f5f4f0',
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
  hub.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // keep running in the menu bar
    hub?.hide();
  });
  hub.on('show', applyDockPolicy);
  hub.on('hide', applyDockPolicy);
  hub.on('closed', () => (hub = null));
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

/** "Show app in dock": on = always in the dock; off = accessory (LSUIElement-style) while the hub is hidden */
function applyDockPolicy() {
  if (!app.dock || quitting) return;
  const hubVisible = !!hub && !hub.isDestroyed() && (hub.isVisible() || hub.isMinimized());
  if (setting('showInDock', false) || hubVisible) app.dock.show().catch(() => {});
  else app.dock.hide();
}

/* ------------------------------------------------------------------ Flow Bar panel window */
const BAR_SIZE: Record<DockEdge, { width: number; height: number }> = {
  bottom: { width: 560, height: 240 },
  left: { width: 460, height: 420 },
  right: { width: 460, height: 420 },
};

function flowBarConfig(): FlowBarConfig {
  const dock = String(setting('flowBarDock', 'Bottom')).toLowerCase() as DockEdge;
  return {
    show: setting('showFlowBar', true),
    dock: dock === 'left' || dock === 'right' ? dock : 'bottom',
    scratchpadInBar: setting('scratchpadInBar', true),
    transformsOptIn: setting('transformsOptIn', true),
    shortcutLabel: acceleratorLabel(setting('toggleShortcut', DEFAULT_TOGGLE_SHORTCUT)),
    sounds: setting('sounds', true),
  };
}

function barBounds(dock: DockEdge, area: Rectangle): Rectangle {
  const { width, height } = BAR_SIZE[dock];
  const y = Math.round(area.y + (area.height - height) / 2);
  if (dock === 'left') return { x: area.x, y, width, height };
  if (dock === 'right') return { x: area.x + area.width - width, y, width, height };
  return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height, width, height };
}

function positionBar(onCursorDisplay = false) {
  if (!bar || bar.isDestroyed()) return;
  const display = onCursorDisplay ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
  bar.setBounds(barBounds(flowBarConfig().dock, display.workArea));
}

function createBar() {
  bar = new BrowserWindow({
    type: 'panel', // NSPanel: never activates the app, so paste targets stay frontmost
    width: BAR_SIZE.bottom.width,
    height: BAR_SIZE.bottom.height,
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

function updateBarVisibility() {
  if (!bar || bar.isDestroyed()) return;
  const want = flowBarConfig().show || phase !== 'idle';
  if (want && !bar.isVisible()) bar.showInactive();
  if (!want && bar.isVisible()) bar.hide();
}

/* ------------------------------------------------------------------ dictation */
let phase: DictationPhase = 'idle';
let startedAt = 0;
let interim = '';
let finalWaiter: ((text: string) => void) | null = null;

function setPhase(p: DictationPhase, extra: Partial<DictationStatus> = {}) {
  if (p !== phase) log('[dictation]', phase, '->', p, extra.error ?? '');
  phase = p;
  broadcast('dictation:status', { phase: p, interim, ...extra });
  updateBarVisibility();
  if (p === 'recording') globalShortcut.register('Escape', cancelDictation);
  else if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
}

function failDictation(message: string) {
  setPhase('error', { error: message });
  setTimeout(() => phase === 'error' && setPhase('idle'), 2600);
}

function startDictation() {
  if (phase === 'recording' || phase === 'processing') return;
  if (!helper.available) return failDictation('Native helper missing. Run npm run native.');
  interim = '';
  permissionHint = false;
  startedAt = Date.now();
  positionBar(true);
  const mic = setting('microphone', DEFAULT_MIC);
  const ok = helper.send({
    cmd: 'start',
    locale: LANGUAGE_LOCALES[setting('language', 'English')] ?? 'en-US',
    device: mic === DEFAULT_MIC ? '' : mic,
  });
  if (!ok) return failDictation('Could not start the native helper');
  setPhase('recording');
}

let permissionHint = false; // interim currently holds a permission hint, not speech
const heard = () => (permissionHint ? '' : interim);

async function stopDictation() {
  if (phase !== 'recording') return;
  setPhase('processing');
  const raw = await new Promise<string>((resolve) => {
    const t = setTimeout(() => {
      finalWaiter = null;
      resolve(heard());
    }, 5000);
    finalWaiter = (text) => {
      clearTimeout(t);
      finalWaiter = null;
      resolve(text || heard());
    };
    helper.send({ cmd: 'stop' });
  });
  const original = raw.trim();
  if (!original) return failDictation('No speech detected');
  const text = processTranscript(original, snap.dictionary, snap.snippets);
  const res = await pasteText(text);
  snap = { ...snap, lastTranscript: text };
  const result = { text, original, words: wordCount(text), durationMs: Date.now() - startedAt, ...res };
  broadcast('dictation:result', result);
  interim = '';
  setPhase('idle');
  rebuildMenus();
}

function cancelDictation() {
  if (phase !== 'recording') return;
  helper.send({ cmd: 'cancel' });
  interim = '';
  setPhase('idle');
}

function toggleDictation() {
  if (phase === 'recording') stopDictation();
  else if (phase === 'idle' || phase === 'error') startDictation();
}

helper.on('message', (m: HelperMessage) => {
  if (m.type !== 'level' && m.type !== 'partial') log('[helper]', m.type === 'final' ? { type: 'final', chars: String(m.text ?? '').length } : m);
  switch (m.type) {
    case 'partial':
      permissionHint = false;
      interim = String(m.text ?? '');
      if (phase === 'recording') broadcast('dictation:status', { phase, interim });
      break;
    case 'authorizing':
      if (phase === 'recording') {
        permissionHint = true;
        interim = m.service === 'speech' ? 'Allow Speech Recognition for Roy Flow in the system prompt, then dictate again.' : 'Allow microphone access for Roy Flow in the system prompt, then dictate again.';
        broadcast('dictation:status', { phase, interim });
      }
      break;
    case 'started':
      if (phase === 'recording' && permissionHint) {
        permissionHint = false;
        interim = '';
        broadcast('dictation:status', { phase, interim });
      }
      break;
    case 'level':
      sendTo(bar, 'dictation:level', Number(m.value) || 0);
      break;
    case 'final':
      finalWaiter?.(String(m.text ?? ''));
      break;
    case 'error':
      if (phase === 'recording' || phase === 'processing') {
        if (finalWaiter) finalWaiter('');
        else {
          helper.send({ cmd: 'cancel' });
          failDictation(String(m.message ?? 'Dictation failed'));
        }
      }
      break;
  }
});
helper.on('exit', (code: number | null, sig: string | null) => {
  log('[helper] exited', { code, sig });
  if (phase === 'recording') failDictation('The dictation helper stopped unexpectedly');
  if (finalWaiter) finalWaiter('');
});

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

async function pasteText(text: string): Promise<{ pasted: boolean; reason?: string }> {
  const saved = await saveClipboard();
  await clipboard.writeText(text);
  if (!(await accessibilityTrusted())) {
    broadcast('access:changed', { accessibility: false, helper: helper.available });
    return { pasted: false, reason: 'Copied to the clipboard. Allow Accessibility access so Roy Flow can paste for you.' };
  }
  await new Promise((r) => setTimeout(r, 30));
  const r = await helper.request<{ type: 'pasted'; ok: boolean }>({ cmd: 'paste' }, 'pasted');
  if (!r?.ok) return { pasted: false, reason: 'Copied to the clipboard (paste failed).' };
  // give the target app time to read the pasteboard, then put back what was there
  setTimeout(async () => {
    if ((await clipboard.readText()) === text) restoreClipboard(saved);
  }, 600);
  return { pasted: true };
}

function pasteLast() {
  const t = snap.lastTranscript.trim();
  if (t) pasteText(t);
}

/* ------------------------------------------------------------------ shortcuts */
let toggleAcc = '';
function registerToggle(acc: string): boolean {
  if (toggleAcc && globalShortcut.isRegistered(toggleAcc)) globalShortcut.unregister(toggleAcc);
  let ok = false;
  try {
    ok = globalShortcut.register(acc, toggleDictation);
  } catch {
    ok = false;
  }
  toggleAcc = ok ? acc : '';
  log('[shortcut] toggle', acc, ok ? 'registered' : 'FAILED');
  return ok;
}

/* ------------------------------------------------------------------ menus + tray */
const menuContext = (): MenuContext => ({
  snap,
  devices,
  dev: isDev,
  openHub: showHub,
  toggleDictation,
  pasteLast,
  copyLast: () => {
    if (snap.lastTranscript) clipboard.writeText(snap.lastTranscript);
  },
  checkUpdates: () => {
    dialog.showMessageBox({ type: 'info', message: 'Roy Flow is up to date', detail: `Version ${app.getVersion()}. This local build does not update itself.`, buttons: ['OK'] });
  },
  setSetting: (key, value) => {
    snap = { ...snap, settings: { ...snap.settings, [key]: value } };
    sendTo(hub, 'settings:patch', { key, value });
    rebuildMenus();
  },
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

function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON);
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Roy Flow');
  tray.on('mouse-down', () => sendTo(hub, 'devices:request')); // refresh device list for next open
  rebuildMenus();
}

/* ------------------------------------------------------------------ IPC */
function wireIpc() {
  ipcMain.on('state:sync', (_e, s: StateSnapshot) => {
    const prev = snap;
    snap = s;
    writeJson('snapshot.json', s);
    rebuildMenus();
    const p = prev.settings;
    const n = s.settings;
    if (n.toggleShortcut !== p.toggleShortcut || !toggleAcc) registerToggle(String(n.toggleShortcut || DEFAULT_TOGGLE_SHORTCUT));
    if (n.showInDock !== p.showInDock) applyDockPolicy();
    if (n.launchAtLogin !== p.launchAtLogin && p.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: !!n.launchAtLogin });
    if (n.flowBarDock !== p.flowBarDock) positionBar();
    sendTo(bar, 'flowbar:config', flowBarConfig());
    updateBarVisibility();
    if (hub && s.theme !== prev.theme) hub.setBackgroundColor(s.theme === 'dark' ? '#1f1f1e' : '#f5f4f0');
  });
  ipcMain.on('dictation:toggle', toggleDictation);
  ipcMain.on('dictation:cancel', cancelDictation);
  ipcMain.on('flowbar:interactive', (_e, on: boolean) => setBarInteractive(!!on));
  ipcMain.on('flowbar:ready', () => {
    sendTo(bar, 'flowbar:config', flowBarConfig());
    sendTo(bar, 'dictation:status', { phase, interim });
  });
  ipcMain.on('hub:open', (_e, nav: NavRequest) => showHub(nav));
  ipcMain.on('devices:list', async (_e, list: string[]) => {
    devices = list.length ? list : ((await helper.request<{ type: 'devices'; devices: string[] }>({ cmd: 'devices' }, 'devices'))?.devices ?? []);
    rebuildMenus();
  });
  ipcMain.handle('access:check', async (_e, { prompt }: { prompt: boolean }) => {
    const accessibility = await accessibilityTrusted(prompt);
    if (prompt && !accessibility) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return { accessibility, helper: helper.available };
  });
  ipcMain.handle('shortcut:set', (_e, { accelerator }: { accelerator: string }) => {
    const prev = toggleAcc;
    if (registerToggle(accelerator)) return { ok: true };
    if (prev) registerToggle(prev);
    return { ok: false, error: `${acceleratorLabel(accelerator)} could not be registered. It may be in use by another app.` };
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
}

/* ------------------------------------------------------------------ lifecycle */
app.on('second-instance', () => showHub());
app.on('activate', () => showHub());
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  helper.kill();
});
app.on('window-all-closed', () => {
  /* stay alive in the menu bar */
});

app.whenReady().then(() => {
  log('[app] ready', { version: app.getVersion(), packaged: app.isPackaged, helper: helper.available });
  if (!isDev) serveDist();
  wireIpc();
  createTray();
  createBar();
  createHub(!process.argv.includes('--hidden'));
  registerToggle(setting('toggleShortcut', DEFAULT_TOGGLE_SHORTCUT));
  log('[shortcut] paste last', PASTE_LAST, globalShortcut.register(PASTE_LAST, pasteLast) ? 'registered' : 'FAILED');
  applyDockPolicy();
  screen.on('display-metrics-changed', () => positionBar());
  screen.on('display-removed', () => positionBar());
});
