/* Global shortcut model shared by the renderer (editor, chips) and the main process (matching, menus).
   A chord is a list of key names: modifiers first ("fn","ctrl","opt","shift","cmd"), then at most one key. */

export type Chord = string[];
export type HotkeyMap = Record<string, Chord[]>;

export interface HotkeyAction {
  id: string;
  label: string;
  desc: string;
  /** hold to use (down/up), otherwise fires on press */
  hold?: boolean;
  /** only active in this context (the helper only swallows the keys then) */
  when?: 'recording' | 'changes';
  /** modifier-only chords allowed (fn, ctrl+opt...) */
  modifierOnly?: boolean;
  /** a single key without modifiers is allowed (Esc) */
  standalone?: boolean;
  /** the last shortcut cannot be removed (Wispr: push to talk and Cancel) */
  required?: boolean;
}

export const MODIFIERS = ['fn', 'ctrl', 'opt', 'shift', 'cmd'] as const;
export const isModifier = (k: string) => (MODIFIERS as readonly string[]).includes(k);
export const MAX_CHORDS = 4; // per action, as in Wispr Flow
export const MAX_KEYS = 3; // per chord ("Shortcut must contain 3 or fewer keys")
/** mouse buttons a shortcut can use: middle (mouse3), back (mouse4), forward (mouse5) and extra buttons */
export const isMouse = (k: string) => /^mouse([3-9]|10)$/.test(k);
/** DOM MouseEvent.button -> key name (0 left / 2 right are never shortcuts) */
export function mouseButtonName(button: number): string | null {
  if (button === 1) return 'mouse3';
  if (button >= 3 && button <= 9) return `mouse${button + 1}`;
  return null;
}

export const BASE_ACTIONS: HotkeyAction[] = [
  { id: 'ptt', label: 'Push to talk', desc: 'Hold to dictate, release to paste', hold: true, modifierOnly: true, required: true },
  { id: 'handsfree', label: 'Hands-free mode', desc: 'Press to start dictating, press again to paste' },
  { id: 'cancel', label: 'Cancel', desc: 'Dismiss the current dictation without pasting', when: 'recording', standalone: true, required: true },
  { id: 'pasteLast', label: 'Paste last transcript', desc: 'Paste your most recent dictation again' },
  { id: 'copyLast', label: 'Copy last transcript', desc: 'Copy your most recent dictation to the clipboard' },
  { id: 'scratchpad', label: 'Open Scratchpad', desc: 'Open the Scratchpad window' },
  { id: 'notetaker', label: 'Start Notetaker', desc: 'Start or stop recording a meeting note' },
  { id: 'viewChanges', label: 'View changes', desc: 'Compare the text before and after the last Transform', when: 'changes' },
  { id: 'openApp', label: 'Open Roy Flow', desc: 'Bring the Roy Flow window to the front' },
];

export const DEFAULT_HOTKEYS: HotkeyMap = {
  ptt: [['fn']],
  handsfree: [['opt', 'space']],
  cancel: [['esc']],
  pasteLast: [['ctrl', 'cmd', 'v']],
  copyLast: [['ctrl', 'cmd', 'c']],
  scratchpad: [],
  notetaker: [['opt', 'm']],
  viewChanges: [['opt', 'o']],
  openApp: [],
};
/** defaults for the built-in transforms, keyed by transform id */
export const DEFAULT_TRANSFORM_HOTKEYS: Record<string, Chord[]> = { t1: [['opt', '1']], t2: [['opt', '2']] };

export function transformAction(t: { id: string; name: string }): HotkeyAction {
  return { id: `transform:${t.id}`, label: t.name, desc: 'Rewrite the selected text (or your last dictation) with this Transform' };
}
export function allActions(transforms: { id: string; name: string }[]): HotkeyAction[] {
  const base = BASE_ACTIONS.filter((a) => a.id !== 'openApp');
  return [...base, ...transforms.map(transformAction), BASE_ACTIONS.find((a) => a.id === 'openApp')!];
}
export function defaultsFor(actionId: string): Chord[] {
  if (actionId.startsWith('transform:')) return DEFAULT_TRANSFORM_HOTKEYS[actionId.slice(10)] ?? [];
  return DEFAULT_HOTKEYS[actionId] ?? [];
}
export function defaultHotkeyMap(transforms: { id: string }[]): HotkeyMap {
  const m: HotkeyMap = structuredClone(DEFAULT_HOTKEYS);
  for (const t of transforms) m[`transform:${t.id}`] = structuredClone(DEFAULT_TRANSFORM_HOTKEYS[t.id] ?? []);
  return m;
}
export function bindingsOf(map: HotkeyMap, actionId: string): Chord[] {
  return map[actionId] ?? defaultsFor(actionId);
}

/** canonical order: modifiers in MODIFIERS order, then the key */
export function normalize(keys: string[]): Chord {
  const uniq = [...new Set(keys.map((k) => k.toLowerCase()))];
  return [...MODIFIERS.filter((m) => uniq.includes(m)), ...uniq.filter((k) => !isModifier(k))];
}
export const chordId = (c: Chord) => normalize(c).join('+');

const GLYPH: Record<string, string> = {
  fn: 'fn',
  ctrl: '⌃',
  opt: '⌥',
  shift: '⇧',
  cmd: '⌘',
  space: 'Space',
  return: '↩',
  tab: '⇥',
  esc: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};
const WORD: Record<string, string> = { ctrl: 'Ctrl', opt: 'Opt', shift: 'Shift', cmd: 'Cmd' };
/** label for one key chip, e.g. "⌥ Opt", "Space", "V" */
export function keyChip(k: string): string {
  if (WORD[k]) return `${GLYPH[k]} ${WORD[k]}`;
  if (isMouse(k)) return k === 'mouse3' ? 'Middle click' : `Mouse ${k.slice(5)}`;
  if (GLYPH[k]) return GLYPH[k];
  return /^f\d+$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k;
}
/** compact label, e.g. "⌃⌘V", "fn", "⌥ Space" */
export function chordLabel(c: Chord | undefined): string {
  if (!c || !c.length) return '';
  const n = normalize(c);
  const mods = n.filter((k) => isModifier(k) && k !== 'fn').map((k) => GLYPH[k]).join('');
  const fn = n.includes('fn') ? 'fn' : '';
  const key = n.filter((k) => !isModifier(k)).map((k) => keyChip(k))[0] ?? '';
  return [fn, mods + (key && key.length > 1 && mods ? ' ' : '') + key].filter(Boolean).join(' ').trim();
}

const ACC_KEY: Record<string, string> = {
  space: 'Space', return: 'Return', tab: 'Tab', esc: 'Escape', backspace: 'Backspace', delete: 'Delete',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};
/** Electron accelerator for a chord, or null if it can't be expressed (fn, modifier-only) */
export function toAccelerator(c: Chord | undefined): string | null {
  if (!c || !c.length) return null;
  const n = normalize(c);
  if (n.includes('fn')) return null;
  const key = n.find((k) => !isModifier(k));
  if (!key) return null;
  const mods = n.filter(isModifier).map((m) => ({ ctrl: 'Control', opt: 'Alt', shift: 'Shift', cmd: 'Command' })[m as 'ctrl']);
  const k = ACC_KEY[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : null);
  if (!k) return null;
  return [...mods, k].join('+');
}

/** KeyboardEvent.code -> key name (fallback recorder when the native helper can't capture) */
export function codeToKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|20)$/.test(code)) return code.toLowerCase();
  const m: Record<string, string> = {
    Space: 'space', Enter: 'return', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down',
    ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Backquote: '`', Minus: '-',
    Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'opt', AltRight: 'opt', ShiftLeft: 'shift', ShiftRight: 'shift', MetaLeft: 'cmd', MetaRight: 'cmd',
  };
  return m[code] ?? null;
}

/** combos macOS or every app relies on (Wispr's blocked set, macOS flavour) */
const BLOCKED = new Set([
  ...'cvxzrafghmnopstwq,'.split('').map((k) => `cmd+${k}`),
  'shift+cmd+z', 'cmd+tab', 'shift+cmd+tab', 'cmd+space', 'ctrl+cmd+space', 'ctrl+cmd+q', 'ctrl+cmd+f', 'opt+cmd+esc',
  'shift+cmd+3', 'shift+cmd+4', 'shift+cmd+5', 'cmd+`', 'cmd+left', 'cmd+right', 'cmd+up', 'cmd+down', 'opt+cmd+d',
]);
/** combos macOS uses by default but that can be turned off: allowed, with a warning */
const RESERVED_SOFT: Record<string, string> = {
  'ctrl+space': 'macOS uses ⌃ Space to switch input sources. Turn that off in System Settings › Keyboard › Keyboard Shortcuts › Input Sources.',
  'ctrl+opt+space': 'macOS uses ⌃⌥ Space for the next input source. Turn that off in Keyboard Shortcuts › Input Sources.',
  'ctrl+up': 'macOS uses ⌃↑ for Mission Control. Turn that off in Keyboard Shortcuts › Mission Control.',
  'ctrl+down': 'macOS uses ⌃↓ for App Exposé. Turn that off in Keyboard Shortcuts › Mission Control.',
  'ctrl+left': 'macOS uses ⌃← to move between Spaces.',
  'ctrl+right': 'macOS uses ⌃→ to move between Spaces.',
  'opt+cmd+space': 'macOS uses ⌥⌘ Space to open a Finder search window.',
};
const PRINTABLE = /^([a-z0-9]|[-=[\]\\;',./`]|space|return|tab|backspace)$/;

/** validate a chord for an action; returns an error message (Wispr Flow's wording where it has one), or null */
export function validateChord(action: HotkeyAction, chord: Chord, map: HotkeyMap, actions: HotkeyAction[]): string | null {
  const c = normalize(chord);
  const keys = c.filter((k) => !isModifier(k));
  const mods = c.filter(isModifier);
  const mouse = keys.some(isMouse);
  if (!c.length) return 'Press at least one key';
  if (c.length > MAX_KEYS) return `Shortcut must contain ${MAX_KEYS} or fewer keys`;
  if (keys.length > 1) return 'Use one key (or mouse button) plus modifiers';
  if (!keys.length && !action.modifierOnly) return `${action.label} needs a key besides modifiers (for example ⌥ Space)`;
  if (BLOCKED.has(chordId(c))) return `This shortcut is not allowed: ${chordLabel(c)} (macOS or most apps use it)`;
  if (keys.length && !mods.length && !mouse && !action.standalone && !/^f\d+$/.test(keys[0])) return 'Shortcut must include a modifier key or a valid mouse button';
  // ⇧ + a letter types a capital letter: it would break typing
  if (keys.length && !mouse && mods.length === 1 && mods[0] === 'shift' && PRINTABLE.test(keys[0])) return `This shortcut is not allowed: ${chordLabel(c)} (it is needed for typing)`;
  const id = chordId(c);
  for (const a of actions) {
    if (a.id === action.id) continue;
    // contextual bindings only clash with each other when their contexts overlap
    if (a.when && action.when && a.when !== action.when) continue;
    if (bindingsOf(map, a.id).some((x) => chordId(x) === id)) return `This shortcut is already in use by “${a.label}”`;
  }
  if (bindingsOf(map, action.id).some((x) => chordId(x) === id)) return 'This shortcut is already in use';
  return null;
}

/** macOS default shortcut this chord collides with (soft: the shortcut is saved, with this warning) */
export function reservedWarning(chord: Chord): string | null {
  return RESERVED_SOFT[chordId(chord)] ?? null;
}

/** soft warning: a hands-free chord that contains a push-to-talk chord */
export function chordWarning(actionId: string, chord: Chord, map: HotkeyMap): string | null {
  const c = new Set(normalize(chord));
  const other = actionId === 'ptt' ? bindingsOf(map, 'handsfree') : actionId === 'handsfree' ? bindingsOf(map, 'ptt') : [];
  for (const o of other) {
    const big = actionId === 'ptt' ? new Set(o) : c;
    const small = actionId === 'ptt' ? c : new Set(o);
    if ([...small].every((k) => big.has(k)) && small.size < big.size)
      return 'Your Hands-free shortcut contains your Push-to-talk keys. Push to talk will start briefly before Hands-free takes over.';
  }
  return null;
}

/** what the helper needs: one entry per chord */
export interface HelperBinding {
  action: string;
  keys: string[];
  hold: boolean;
  when: string | null;
}
export function helperBindings(map: HotkeyMap, actions: HotkeyAction[]): HelperBinding[] {
  const out: HelperBinding[] = [];
  for (const a of actions) for (const c of bindingsOf(map, a.id)) if (c.length) out.push({ action: a.id, keys: normalize(c), hold: !!a.hold, when: a.when ?? null });
  return out;
}
