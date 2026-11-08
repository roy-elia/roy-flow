/* Tray (menu-bar) menu and macOS application menu, adapted from analysis/wispr-flow/UI_MENUBAR.md §2, §3 and §6. */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { DEFAULT_MIC, LANGUAGES, type CalEvent, type NavRequest } from '../src/shared/ipc';

/** what the menus show; built by main from the data store */
export interface MenuSnapshot {
  settings: Record<string, string | boolean>;
  lastTranscript: string;
  totalWords: number;
  dictionaryCount: number;
  snippetCount: number;
  pastNotes: { id: string; title: string; ts: number }[];
}

export interface MenuContext {
  snap: MenuSnapshot;
  devices: string[];
  dev: boolean;
  /** Electron accelerators for the user's shortcuts (display only) */
  acc: { handsfree?: string; pasteLast?: string; copyLast?: string; notetaker?: string; scratchpad?: string; openApp?: string };
  upcoming: CalEvent[] | null;
  meetingActive: boolean;
  openHub(nav?: NavRequest): void;
  toggleDictation(): void;
  toggleMeeting(): void;
  openScratchpad(): void;
  pasteLast(): void;
  copyLast(): void;
  checkUpdates(): void;
  setSetting(key: string, value: string | boolean): void;
  quit(): void;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '...' : s);
const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  return `${date}, ${time}`;
};

function micItems(c: MenuContext): MenuItemConstructorOptions[] {
  const current = (c.snap.settings.microphone as string) || DEFAULT_MIC;
  const names = [DEFAULT_MIC, ...c.devices.filter((d) => d !== DEFAULT_MIC && !/^default\b/i.test(d))];
  return [...new Set(names)].map((label) => ({ label, type: 'checkbox', checked: label === current, click: () => c.setSetting('microphone', label) }));
}

function languageItems(c: MenuContext): MenuItemConstructorOptions[] {
  const current = (c.snap.settings.language as string) || 'English';
  return LANGUAGES.map((label) => ({ label, type: 'checkbox', checked: label === current, click: () => c.setSetting('language', label) }));
}

function pastNotes(c: MenuContext): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = c.snap.pastNotes.map((m) => ({
    label: truncate(m.title, 40),
    sublabel: fmtDate(m.ts),
    toolTip: m.title,
    click: () => c.openHub({ page: 'notetaker' }),
  }));
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: 'See all past notes', click: () => c.openHub({ page: 'notetaker' }) });
  return items;
}

function lastTranscriptPreview(c: MenuContext): MenuItemConstructorOptions[] {
  const t = c.snap.lastTranscript.replace(/\s+/g, ' ').trim();
  return t ? [{ label: truncate(t, 25), toolTip: truncate(t, 270), enabled: false }] : [];
}

const accel = (a?: string): Partial<MenuItemConstructorOptions> => (a ? { accelerator: a, registerAccelerator: false } : {});

function upcomingItems(c: MenuContext): MenuItemConstructorOptions[] {
  if (!c.upcoming) return [{ label: 'Connect your calendar…', click: () => c.openHub({ settings: 'connectors' }) }];
  const now = Date.now();
  const next = c.upcoming.filter((e) => e.end > now && !e.allDay).slice(0, 6);
  const items: MenuItemConstructorOptions[] = next.map((e) => ({ label: truncate(e.title, 40), sublabel: fmtDate(e.start), click: () => c.openHub({ page: 'notetaker' }) }));
  if (!items.length) items.push({ label: 'No upcoming meetings', enabled: false });
  items.push({ type: 'separator' }, { label: 'See all upcoming meetings', click: () => c.openHub({ page: 'notetaker' }) });
  return items;
}

export function buildTrayMenu(c: MenuContext): Menu {
  const hasLast = !!c.snap.lastTranscript.trim();
  const t: MenuItemConstructorOptions[] = [
    { label: 'Upcoming meetings', submenu: upcomingItems(c) },
    { label: 'Past notes', submenu: pastNotes(c) },
    { type: 'separator' },
    { label: c.meetingActive ? 'Stop Notetaker' : 'Start Notetaker', ...accel(c.acc.notetaker), click: c.toggleMeeting },
    { label: 'Start dictation', ...accel(c.acc.handsfree), click: c.toggleDictation },
    { label: 'Open Scratchpad', ...accel(c.acc.scratchpad), click: c.openScratchpad },
    { label: 'Open Roy Flow', ...accel(c.acc.openApp), click: () => c.openHub({ page: 'home' }) },
    { type: 'separator' },
    { label: 'Check for updates...', click: c.checkUpdates },
    { type: 'separator' },
    { label: 'Paste last transcript', ...accel(c.acc.pasteLast), enabled: hasLast, click: c.pasteLast },
    { label: 'Copy last transcript', ...accel(c.acc.copyLast), enabled: hasLast, click: c.copyLast },
    ...lastTranscriptPreview(c),
    { type: 'separator' },
    { label: 'Shortcuts', click: () => c.openHub({ settings: 'general', modal: 'shortcuts' }) },
    { label: 'Microphone', submenu: micItems(c) },
    { label: 'Languages', submenu: languageItems(c) },
    { type: 'separator' },
    { label: 'Help center', click: () => c.openHub({ modal: 'help' }) },
    { label: 'Talk to support', accelerator: 'Command+/', registerAccelerator: false, click: () => c.openHub({ modal: 'help' }) },
    { label: 'Share feedback', click: () => c.openHub({ modal: 'help' }) },
    { type: 'separator' },
    { label: 'Quit Roy Flow', accelerator: 'Command+Q', click: c.quit },
  ];
  return Menu.buildFromTemplate(t);
}

export function buildAppMenu(c: MenuContext): Menu {
  const hasLast = !!c.snap.lastTranscript.trim();
  const t: MenuItemConstructorOptions[] = [
    {
      label: 'Roy Flow',
      submenu: [
        { role: 'about', label: 'About Roy Flow' },
        { label: 'Check for updates…', click: c.checkUpdates },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'Command+,', click: () => c.openHub({ settings: 'general' }) },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Roy Flow' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Roy Flow', accelerator: 'Command+Q', click: c.quit },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Start dictation', ...accel(c.acc.handsfree), click: c.toggleDictation },
        { label: c.meetingActive ? 'Stop Notetaker' : 'Start Notetaker', ...accel(c.acc.notetaker), click: c.toggleMeeting },
        { label: 'Open Scratchpad', ...accel(c.acc.scratchpad), click: c.openScratchpad },
        { type: 'separator' },
        { role: 'close', label: 'Close window' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll', label: 'Select All', accelerator: 'CmdOrCtrl+A' }],
    },
    {
      label: 'Dictation',
      submenu: [
        { label: `Words dictated: ${c.snap.totalWords.toLocaleString('en-US')}`, click: () => c.openHub({ page: 'insights' }) },
        { type: 'separator' },
        { label: 'Paste last transcript', ...accel(c.acc.pasteLast), enabled: hasLast, click: c.pasteLast },
        { label: 'Copy last transcript', ...accel(c.acc.copyLast), enabled: hasLast, click: c.copyLast },
        ...lastTranscriptPreview(c),
        { type: 'separator' },
        { label: 'Microphone', submenu: micItems(c) },
        { label: 'Languages', submenu: languageItems(c) },
      ],
    },
    {
      label: 'Notetaker',
      submenu: [
        { label: c.meetingActive ? 'Stop Notetaker' : 'Start Notetaker', ...accel(c.acc.notetaker), click: c.toggleMeeting },
        { label: 'Upcoming meetings', submenu: upcomingItems(c) },
        { label: 'Past notes', submenu: pastNotes(c) },
        { type: 'separator' },
        { label: 'Open Notetaker', click: () => c.openHub({ page: 'notetaker' }) },
      ],
    },
    {
      label: 'My Voice',
      submenu: [
        { label: `Dictionary words: ${c.snap.dictionaryCount}`, click: () => c.openHub({ page: 'dictionary' }) },
        { label: `Snippets created: ${c.snap.snippetCount}`, click: () => c.openHub({ page: 'snippets' }) },
        { type: 'separator' },
        { label: 'Add a word to dictionary', click: () => c.openHub({ page: 'dictionary' }) },
        { label: 'Create a new snippet', click: () => c.openHub({ page: 'snippets' }) },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, ...(c.dev ? ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []), { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'Help center', click: () => c.openHub({ modal: 'help' }) },
        { label: 'Talk to support', accelerator: 'Command+/', click: () => c.openHub({ modal: 'help' }) },
        { label: 'Share feedback', click: () => c.openHub({ modal: 'help' }) },
        { label: 'Shortcuts', click: () => c.openHub({ settings: 'general', modal: 'shortcuts' }) },
      ],
    },
    { label: 'Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'close', label: 'Close Window' }] },
  ];
  return Menu.buildFromTemplate(t);
}
