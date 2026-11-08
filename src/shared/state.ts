/* Default state and the merge used when loading saved data. Shared by the renderer store and the Electron main
   process, so main can create the data file itself and the hub window can be closed (and freed) at any time. */
import { defaultSettings, defaultTransforms } from '../seed';
import { defaultHotkeyMap } from './hotkeys';
import type { HistoryItem, Meeting, State } from './types';
import type { StoreMutation } from './ipc';

export function emptyState(): State {
  const transforms = defaultTransforms();
  return {
    theme: 'light',
    sidebarOpen: true,
    user: { firstName: '', lastName: '', email: '' },
    history: [],
    dictionary: [],
    snippets: [],
    notes: [],
    meetings: [],
    transforms,
    chats: [],
    hotkeys: defaultHotkeyMap(transforms),
    voiceProfile: null,
    dismissed: {},
    checklist: {},
    settings: defaultSettings(),
    styles: { personal: 'casual', work: 'formal', email: 'formal', other: 'formal' },
    announced: {},
  };
}

/** saved data over defaults (new settings keys and new actions' default shortcuts appear automatically) */
export function mergeState(base: State, saved: Partial<State>): State {
  const s = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) }, styles: { ...base.styles, ...(saved.styles || {}) } };
  s.hotkeys = { ...defaultHotkeyMap(s.transforms), ...(saved.hotkeys || {}) };
  s.chats = s.chats ?? [];
  s.announced = s.announced ?? {};
  s.voiceProfile = s.voiceProfile ?? null;
  return s;
}

/** apply an add/patch/remove on the history or meetings list; returns the changed top-level patch */
export function applyMutation(s: Partial<State>, m: StoreMutation): Partial<State> {
  if (m.collection === 'history') {
    const list = s.history ?? [];
    if (m.op === 'add') return { history: [m.item as HistoryItem, ...list.filter((h) => h.id !== m.item.id)] };
    return { history: list.map((h) => (h.id === m.id ? { ...h, ...(m.patch as Partial<HistoryItem>) } : h)) };
  }
  const list = s.meetings ?? [];
  if (m.op === 'add') return { meetings: [m.item as Meeting, ...list.filter((x) => x.id !== m.item.id)] };
  return { meetings: list.map((x) => (x.id === m.id ? { ...x, ...(m.patch as Partial<Meeting>) } : x)) };
}

/** retention: drop history older than 30 days when "Auto-delete after 30 days" is chosen */
export function retainHistory(history: HistoryItem[], policy: string | boolean | undefined, now = Date.now()): HistoryItem[] | null {
  if (policy !== 'Auto-delete after 30 days') return null;
  const cutoff = now - 30 * 86400_000;
  return history.some((h) => h.ts < cutoff) ? history.filter((h) => h.ts >= cutoff) : null;
}
