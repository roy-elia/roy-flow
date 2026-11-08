import { useSyncExternalStore } from 'react';
import { seedState } from './seed';

export type Scope = 'personal' | 'team';
export interface HistoryItem {
  id: string;
  ts: number;
  text: string;
  /** raw transcript before the AI clean-up pass (for Undo AI edit) */
  original?: string;
  status: 'ok' | 'dismissed';
  flagged?: boolean;
  app?: string;
}
export interface DictWord {
  id: string;
  word: string;
  misspelling?: string;
  scope: Scope;
  starred?: boolean;
  created: number;
}
export interface Snippet {
  id: string;
  trigger: string;
  expansion: string;
  scope: Scope;
  created: number;
}
export interface Note {
  id: string;
  title: string;
  html: string;
  updated: number;
  pinned?: boolean;
}
export interface Meeting {
  id: string;
  title: string;
  ts: number;
  minutes: number;
  people: number;
  overview: string;
  shared?: boolean;
  folder?: string;
}
export interface Transform {
  id: string;
  name: string;
  description: string;
  prompt: string;
  keys: string[];
  builtin?: boolean;
}

export interface State {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  user: { firstName: string; lastName: string; email: string };
  history: HistoryItem[];
  dictionary: DictWord[];
  snippets: Snippet[];
  notes: Note[];
  meetings: Meeting[];
  transforms: Transform[];
  dismissed: Record<string, boolean>;
  checklist: Record<string, boolean>;
  settings: Record<string, string | boolean>;
  styles: Record<string, string>;
  totals: { words: number; wpm: number; streak: number };
}

const KEY = 'roy-flow-state-v1';

function load(): State {
  const seed = seedState();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State>;
      return { ...seed, ...saved, settings: { ...seed.settings, ...(saved.settings || {}) } };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return seed;
}

let state: State = load();
const listeners = new Set<() => void>();
let saveTimer: number | undefined;

function emit() {
  listeners.forEach((l) => l());
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }, 150);
}

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

export function setSetting(key: string, value: string | boolean) {
  setState((s) => ({ settings: { ...s.settings, [key]: value } }));
}

export function resetState() {
  localStorage.removeItem(KEY);
  state = seedState();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export const uid = () => Math.random().toString(36).slice(2, 10);

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
  window.setTimeout(() => dismissToast(t.id), 4000);
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

/* ------------------------------------------------------------------ text pipeline */
export function applyDictionaryAndSnippets(text: string, s: State = state): string {
  let out = text;
  for (const w of s.dictionary) {
    if (w.misspelling) {
      const re = new RegExp(`\\b${escapeRe(w.misspelling)}\\b`, 'gi');
      out = out.replace(re, w.word);
    } else {
      // fix casing of known words
      const re = new RegExp(`\\b${escapeRe(w.word)}\\b`, 'gi');
      out = out.replace(re, w.word);
    }
  }
  for (const sn of s.snippets) {
    const re = new RegExp(`\\b${escapeRe(sn.trigger)}\\b`, 'gi');
    out = out.replace(re, sn.expansion);
  }
  return out;
}

/** a light "AI clean-up": drop filler words, capitalise, end with punctuation */
export function cleanUp(text: string): string {
  let t = text.replace(/\b(um+|uh+|erm|you know|like,)\s*/gi, '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
