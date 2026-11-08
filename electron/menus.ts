/* Tray (menu-bar) menu and macOS application menu, adapted from analysis/wispr-flow/UI_MENUBAR.md §2, §3 and §6. */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { DEFAULT_MIC, LANGUAGES, type NavRequest, type StateSnapshot } from '../src/shared/ipc';

export interface MenuContext {
  snap: StateSnapshot;
  devices: string[];
  dev: boolean;
  openHub(nav?: NavRequest): void;
  toggleDictation(): void;
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

export function buildTrayMenu(c: MenuContext): Menu {
  const hasLast = !!c.snap.lastTranscript.trim();
  const t: MenuItemConstructorOptions[] = [
    { label: 'See all upcoming meetings', click: () => c.openHub({ page: 'notetaker' }) },
    { label: 'Past notes', submenu: pastNotes(c) },
    { type: 'separator' },
    { label: 'Start Notetaker', click: () => c.openHub({ page: 'notetaker' }) },
    { label: 'Open Roy Flow', click: () => c.openHub({ page: 'home' }) },
    { type: 'separator' },
    { label: 'Check for updates...', click: c.checkUpdates },
    { type: 'separator' },
    { label: 'Paste last transcript', accelerator: 'Control+Command+V', registerAccelerator: false, enabled: hasLast, click: c.pasteLast },
    ...lastTranscriptPreview(c),
    { type: 'separator' },
    { label: 'Shortcuts', click: () => c.openHub({ settings: 'general' }) },
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
        { label: 'Start dictation', click: c.toggleDictation },
        { label: 'Start Notetaker', click: () => c.openHub({ page: 'notetaker' }) },
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
        { label: 'Copy last transcript', enabled: hasLast, click: c.copyLast },
        ...lastTranscriptPreview(c),
        { type: 'separator' },
        { label: 'Microphone', submenu: micItems(c) },
        { label: 'Languages', submenu: languageItems(c) },
      ],
    },
    {
      label: 'Notetaker',
      submenu: [
        { label: 'Start Notetaker', click: () => c.openHub({ page: 'notetaker' }) },
        { label: 'See all upcoming meetings', click: () => c.openHub({ page: 'notetaker' }) },
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
        { label: 'Shortcuts', click: () => c.openHub({ settings: 'general' }) },
      ],
    },
    { label: 'Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'close', label: 'Close Window' }] },
  ];
  return Menu.buildFromTemplate(t);
}
