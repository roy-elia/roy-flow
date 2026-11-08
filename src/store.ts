import { useSyncExternalStore } from 'react';
import { defaultSettings, defaultTransforms, LEGACY_DEMO_IDS } from './seed';
import { applyDictionaryAndSnippets as applyShared, cleanUp, wordCount } from './shared/textPipeline';
import { defaultHotkeyMap, normalize, type HotkeyMap } from './shared/hotkeys';
import { native } from './native/bridge';
import type { HistoryItem, State } from './shared/types';

export type { AppCategory, Chat, ChatMessage, DictWord, HistoryItem, Meeting, Note, Scope, Snippet, State, Transform, TranscriptSegment, VoiceProfile } from './shared/types';

/** where the browser build (and the pre-1.1 desktop app) kept everything */
const LEGACY_KEY = 'roy-flow-state-v1';

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

function merge(base: State, saved: Partial<State>): State {
  const s = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) }, styles: { ...base.styles, ...(saved.styles || {}) } };
  s.hotkeys = { ...defaultHotkeyMap(s.transforms), ...(saved.hotkeys || {}) };
  s.chats = s.chats ?? [];
  s.announced = s.announced ?? {};
  s.voiceProfile = s.voiceProfile ?? null;
  return s;
}

/** Electron accelerator ("Control+Alt+K") -> chord */
function accToChord(acc: string): string[] {
  const m: Record<string, string> = { Control: 'ctrl', Ctrl: 'ctrl', Alt: 'opt', Option: 'opt', Shift: 'shift', Command: 'cmd', Cmd: 'cmd', Space: 'space', Escape: 'esc', Return: 'return' };
  return normalize(acc.split('+').map((p) => m[p] ?? p.toLowerCase()));
}

/** the old localStorage state shipped with sample data: drop it, keep what the user made */
function migrateLegacy(saved: Partial<State> & { settings?: Record<string, string | boolean> }): Partial<State> {
  const keep = <T extends { id: string }>(list: T[] | undefined) => (list ?? []).filter((x) => !LEGACY_DEMO_IDS.has(x.id));
  const out: Partial<State> = {
    ...saved,
    history: keep(saved.history),
    meetings: keep(saved.meetings),
    dictionary: keep(saved.dictionary),
    snippets: keep(saved.snippets),
  };
  if (saved.user?.lastName === 'Lee' && saved.user.firstName === 'Jordan') out.user = { firstName: '', lastName: '', email: '' };
  const set = { ...(saved.settings ?? {}) };
  const hk: HotkeyMap = {};
  if (typeof set.toggleShortcut === 'string' && set.toggleShortcut !== 'Alt+Space') hk.handsfree = [accToChord(set.toggleShortcut)];
  for (const k of ['toggleShortcut', 'pttKey', 'billing', 'improveModel', 'cloudStorage', 'publicInfo']) delete set[k];
  out.settings = set;
  if (Object.keys(hk).length) out.hotkeys = { ...(saved.hotkeys ?? {}), ...hk };
  delete (out as { totals?: unknown }).totals;
  return out;
}

let state: State = emptyState();
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
const pendingKeys = new Set<keyof State>();

function notify() {
  listeners.forEach((l) => l());
}

/** send changed top-level keys to the main process (desktop) or localStorage (browser) */
function persist(keys: (keyof State)[]) {
  keys.forEach((k) => pendingKeys.add(k));
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (native) {
      const patch: Record<string, unknown> = {};
      pendingKeys.forEach((k) => (patch[k] = state[k]));
      native.send('store:patch', patch);
    } else {
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
      } catch {
        /* quota */
      }
    }
    pendingKeys.clear();
  }, 150);
}

/** load persisted data before the first render. Desktop: the JSON store in app data (migrating localStorage once). */
export async function hydrate(): Promise<void> {
  if (native) {
    const { data } = await native.invoke('store:load');
    if (data && 'settings' in data) {
      state = merge(emptyState(), data as Partial<State>);
    } else {
      // main may already hold a few keys of its own (notification bookkeeping): keep them
      let legacy: Partial<State> | null = null;
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) legacy = migrateLegacy(JSON.parse(raw) as Partial<State>);
      } catch {
        legacy = null;
      }
      state = merge(emptyState(), { ...((data ?? {}) as Partial<State>), ...(legacy ?? {}) });
      if (!state.user.firstName) {
        const info = await native.invoke('app:info').catch(() => null);
        const [first = '', ...rest] = (info?.fullName ?? '').split(' ');
        state.user = { ...state.user, firstName: first, lastName: rest.join(' ') };
      }
      // first run of the JSON store: write everything
      native.send('store:patch', state as unknown as Record<string, unknown>);
      if (legacy) localStorage.setItem(`${LEGACY_KEY}-migrated`, localStorage.getItem(LEGACY_KEY) ?? '');
      localStorage.removeItem(LEGACY_KEY);
    }
    native.on('store:changed', (p) => {
      state = { ...state, ...(p as Partial<State>) };
      notify();
    });
  } else {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) state = merge(emptyState(), JSON.parse(raw) as Partial<State>);
    } catch {
      /* ignore corrupt storage */
    }
  }
  // retention: "Auto-delete after 30 days"
  if (state.settings.localStorage === 'Auto-delete after 30 days') {
    const cutoff = Date.now() - 30 * 86400_000;
    if (state.history.some((h) => h.ts < cutoff)) setState((s) => ({ history: s.history.filter((h) => h.ts >= cutoff) }));
  }
}

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  notify();
  persist(Object.keys(p) as (keyof State)[]);
}

export function setSetting(key: string, value: string | boolean) {
  setState((s) => ({ settings: { ...s.settings, [key]: value } }));
}

/** browser-only reset; the desktop app resets through the main process (store:reset) */
export function resetState() {
  localStorage.removeItem(LEGACY_KEY);
  state = emptyState();
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ derived stats (from real history) */
export interface Stats {
  words: number;
  wpm: number;
  streak: number;
  longestStreak: number;
  dictations: number;
  fixes: number;
  dictFixes: number;
}
const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
export const itemWords = (h: HistoryItem) => h.words ?? wordCount(h.text);
let statsCache: { src: HistoryItem[]; v: Stats } | null = null;
export function computeStats(history: HistoryItem[]): Stats {
  if (statsCache?.src === history) return statsCache.v;
  const ok = history.filter((h) => h.status === 'ok');
  const words = ok.reduce((n, h) => n + itemWords(h), 0);
  const timed = ok.filter((h) => h.durationMs && h.durationMs > 800);
  const tWords = timed.reduce((n, h) => n + itemWords(h), 0);
  const tSecs = timed.reduce((n, h) => n + h.durationMs! / 1000, 0);
  const wpm = tSecs > 0 ? Math.round(tWords / (tSecs / 60)) : 0;
  const days = new Set(ok.map((h) => dayKey(h.ts)));
  let streak = 0;
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  const sortedDays = [...new Set(ok.map((h) => new Date(new Date(h.ts).toDateString()).getTime()))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    run = i > 0 && Math.round((sortedDays[i] - sortedDays[i - 1]) / 86400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const v = {
    words,
    wpm,
    streak,
    longestStreak: longest,
    dictations: ok.length,
    fixes: ok.reduce((n, h) => n + (h.fixes ?? 0), 0),
    dictFixes: ok.reduce((n, h) => n + (h.dictFixes ?? 0), 0),
  };
  statsCache = { src: history, v };
  return v;
}
export const useStats = () => computeStats(useStore((s) => s.history));

/* ------------------------------------------------------------------ toasts (not persisted) */
export interface Toast {
  id: string;
  text: string;
  tone?: 'success' | 'error';
  action?: { label: string; run: () => void };
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}) {
  const t = { id: uid(), text, tone: opts.tone ?? 'success', ...opts };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  window.setTimeout(() => dismissToast(t.id), t.tone === 'error' ? 6000 : 4000);
}
export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  toastListeners.forEach((l) => l());
}
export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
}

/* ------------------------------------------------------------------ text pipeline (shared with Electron main) */
export { cleanUp, wordCount };
export function applyDictionaryAndSnippets(text: string, s: State = state): string {
  return applyShared(text, s.dictionary, s.snippets);
}
