import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { native } from './bridge';
import type { AccessStatus } from '../shared/ipc';

/** live permission state from the main process (polled every few seconds while mounted) */
export function useAccess(): AccessStatus | null {
  const [a, setA] = useState<AccessStatus | null>(null);
  useEffect(() => {
    if (!native) return;
    let alive = true;
    const check = () =>
      native!
        .invoke('access:check', { prompt: false })
        .then((x) => alive && setA(x))
        .catch(() => {});
    check();
    const t = window.setInterval(check, 4000);
    const off = native.on('access:changed', (x) => setA(x));
    return () => {
      alive = false;
      window.clearInterval(t);
      off();
    };
  }, []);
  return a;
}

/** Onboarding row shown in the desktop app while Accessibility (paste, shortcuts) or Input Monitoring (shortcuts) is missing. */
export default function AccessBanner() {
  const a = useAccess();
  if (!native || !a) return null;
  if (!a.accessibility)
    return (
      <div className="access-banner" role="status">
        <ShieldAlert size={18} />
        <span>
          <b>Allow Accessibility access</b> so Roy Flow can paste dictation into other apps and use shortcuts like fn. Until then, text is copied to the clipboard.
        </span>
        <button className="btn btn-primary" onClick={() => native!.invoke('access:check', { prompt: true })}>
          Open System Settings
        </button>
      </div>
    );
  if (a.tap === 'off')
    return (
      <div className="access-banner" role="status">
        <ShieldAlert size={18} />
        <span>
          <b>Allow Input Monitoring</b> so Roy Flow can hear its shortcuts (hold fn to dictate) in every app. After turning it on, quit and reopen Roy Flow.
        </span>
        <button className="btn btn-primary" onClick={() => native!.invoke('access:check', { prompt: false, listen: true })}>
          Open System Settings
        </button>
      </div>
    );
  return null;
}
