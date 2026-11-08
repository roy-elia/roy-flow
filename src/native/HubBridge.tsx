import { useEffect } from 'react';
import { toast } from '../store';
import { getNav, setNav, type PageId, type SettingsTab } from '../nav';
import { go } from '../nav';
import { native } from './bridge';

/** Hub-side glue to the Electron main process. Renders nothing; a no-op in the browser.
    Main owns the data (history items and meetings are added there and arrive as store:changed),
    so this only handles navigation requests and toasts. */
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
        patch.meeting = n.meeting ?? null;
        patch.add = !!n.add;
        setNav(patch);
      }),
      native.on('dictation:result', (r) => {
        if (!r.pasted && document.hasFocus()) toast(r.reason ?? 'Copied to the clipboard', { action: { label: 'View', run: () => go('home') } });
        if (r.note && document.hasFocus()) toast(r.note, { tone: 'error' });
      }),
      native.on('toast', (t) => toast(t.text, { tone: t.tone })),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  return null;
}
