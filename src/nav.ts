import { useSyncExternalStore } from 'react';

export type PageId = 'home' | 'notetaker' | 'insights' | 'dictionary' | 'snippets' | 'style' | 'transforms' | 'scratchpad';
export type SettingsTab =
  | 'general'
  | 'system'
  | 'notetaker'
  | 'vibe'
  | 'connectors'
  | 'mcp'
  | 'account'
  | 'team'
  | 'billing'
  | 'privacy';

export interface Nav {
  page: PageId;
  settings: SettingsTab | null;
  /** open Scratchpad editor window; null = closed, '' = new note */
  noteId: string | null;
  insightsTab: 'usage' | 'voice';
  modal: null | 'help' | 'referral' | 'notifications' | 'account';
}

const PAGES: PageId[] = ['home', 'notetaker', 'insights', 'dictionary', 'snippets', 'style', 'transforms', 'scratchpad'];
const fromHash = (): PageId => {
  const h = location.hash.replace('#/', '') as PageId;
  return PAGES.includes(h) ? h : 'home';
};

let nav: Nav = { page: fromHash(), settings: null, noteId: null, insightsTab: 'usage', modal: null };
const ls = new Set<() => void>();
export function setNav(p: Partial<Nav>) {
  nav = { ...nav, ...p };
  if (p.page) history.replaceState(null, '', `#/${p.page}`);
  ls.forEach((l) => l());
}
export const getNav = () => nav;
export function useNav<T>(sel: (n: Nav) => T): T {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => sel(nav),
  );
}
export const go = (page: PageId) => setNav({ page });
export const openSettings = (tab: SettingsTab = 'general') => setNav({ settings: tab });

window.addEventListener('hashchange', () => {
  const p = fromHash();
  if (p !== nav.page) setNav({ page: p });
});
