import { useEffect } from 'react';
import { setState, toast } from '../store';
import { getNav, setNav, type PageId, type SettingsTab } from '../nav';
import { go } from '../nav';
import { native } from './bridge';
import type { HistoryItem, Meeting } from '../shared/types';

/** Hub-side glue to the Electron main process. Renders nothing; a no-op in the browser. */
export default function HubBridge() {
  useEffect(() => {
    if (!native) return;
    const offs = [
      native.on('nav', (n) => {
        const patch: Parameters<typeof setNav>[0] = {};
        if (n.page) patch.page = n.page as PageId;
        if (n.settings) patch.settings = n.settings as SettingsTab;
        if (n.modal !== undefined) patch.modal = n.modal;
        if (n.page && getNav().settings && !n.settings) patch.settings = null;
        setNav(patch);
      }),
      native.on('dictation:result', (r) => {
        setState((st) => ({ history: [r.item, ...st.history.filter((h) => h.id !== r.item.id)] }));
        if (!r.pasted && document.hasFocus()) toast(r.reason ?? 'Copied to the clipboard', { action: { label: 'View', run: () => go('home') } });
        if (r.note && document.hasFocus()) toast(r.note, { tone: 'error' });
      }),
      native.on('store:mutate', (m) => {
        if (m.op === 'add') {
          if (m.collection === 'history') setState((s) => ({ history: [m.item as HistoryItem, ...s.history] }));
          else setState((s) => ({ meetings: [m.item as Meeting, ...s.meetings] }));
        } else if (m.collection === 'history') {
          setState((s) => ({ history: s.history.map((h) => (h.id === m.id ? { ...h, ...(m.patch as Partial<HistoryItem>) } : h)) }));
        } else {
          setState((s) => ({ meetings: s.meetings.map((x) => (x.id === m.id ? { ...x, ...(m.patch as Partial<Meeting>) } : x)) }));
        }
      }),
      native.on('toast', (t) => toast(t.text, { tone: t.tone })),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  return null;
}
