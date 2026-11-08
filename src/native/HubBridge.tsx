import { useEffect } from 'react';
import { getState, setSetting, setState, toast, uid, useStore, type HistoryItem, type State } from '../store';
import { getNav, setNav, type PageId, type SettingsTab } from '../nav';
import { go } from '../nav';
import { native } from './bridge';
import type { StateSnapshot } from '../shared/ipc';

function snapshot(s: State): StateSnapshot {
  const last = s.history.find((h) => h.status === 'ok');
  return {
    settings: s.settings,
    dictionary: s.dictionary.map((w) => ({ word: w.word, misspelling: w.misspelling })),
    snippets: s.snippets.map((x) => ({ trigger: x.trigger, expansion: x.expansion })),
    lastTranscript: last?.text ?? '',
    totalWords: s.totals.words,
    dictionaryCount: s.dictionary.length,
    snippetCount: s.snippets.length,
    pastNotes: [...s.meetings].sort((a, b) => b.ts - a.ts).slice(0, 5).map((m) => ({ id: m.id, title: m.title, ts: m.ts })),
    theme: s.theme,
  };
}

async function listDevices(): Promise<string[]> {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter((x) => x.kind === 'audioinput' && x.label && x.deviceId !== 'default' && x.deviceId !== 'communications').map((x) => x.label);
  } catch {
    return [];
  }
}

/** Hub-side glue to the Electron main process. Renders nothing; a no-op in the browser. */
export default function HubBridge() {
  const state = useStore((s) => s);

  // push the store slice main needs, debounced
  useEffect(() => {
    if (!native) return;
    const t = window.setTimeout(() => native!.send('state:sync', snapshot(state)), 120);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!native) return;
    const sendDevices = () => listDevices().then((d) => native!.send('devices:list', d));
    sendDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', sendDevices);
    const offs = [
      native.on('devices:request', sendDevices),
      native.on('nav', (n) => {
        const patch: Parameters<typeof setNav>[0] = {};
        if (n.page) patch.page = n.page as PageId;
        if (n.settings) patch.settings = n.settings as SettingsTab;
        if (n.modal !== undefined) patch.modal = n.modal;
        if (n.page && getNav().settings && !n.settings) patch.settings = null;
        setNav(patch);
      }),
      native.on('settings:patch', ({ key, value }) => setSetting(key, value)),
      native.on('dictation:result', (r) => {
        const item: HistoryItem = { id: uid(), ts: Date.now(), text: r.text, original: r.original, status: 'ok', app: 'Roy Flow' };
        const minutes = Math.max(r.durationMs / 60000, 0.05);
        setState((st) => ({
          history: [item, ...st.history],
          totals: { ...st.totals, words: st.totals.words + r.words, wpm: Math.round((st.totals.wpm * 9 + Math.min(220, r.words / minutes)) / 10) },
        }));
        if (!r.pasted && document.hasFocus()) {
          toast(r.reason ?? 'Copied to the clipboard', { action: { label: 'View', run: () => go('home') } });
        }
      }),
    ];
    // first sync immediately so menus have data
    native.send('state:sync', snapshot(getState()));
    return () => {
      offs.forEach((o) => o());
      navigator.mediaDevices?.removeEventListener?.('devicechange', sendDevices);
    };
  }, []);
  return null;
}
