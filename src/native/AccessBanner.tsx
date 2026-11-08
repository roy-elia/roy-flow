import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { native } from './bridge';

/** Onboarding row shown in the desktop app while Accessibility permission (needed to paste) is missing. */
export default function AccessBanner() {
  const [trusted, setTrusted] = useState(true);
  useEffect(() => {
    if (!native) return;
    let alive = true;
    const check = () =>
      native!
        .invoke('access:check', { prompt: false })
        .then((a) => alive && setTrusted(a.accessibility))
        .catch(() => {});
    check();
    const t = window.setInterval(check, 4000);
    const off = native.on('access:changed', (a) => setTrusted(a.accessibility));
    return () => {
      alive = false;
      window.clearInterval(t);
      off();
    };
  }, []);
  if (!native || trusted) return null;
  return (
    <div className="access-banner" role="status">
      <ShieldAlert size={18} />
      <span>
        <b>Allow Accessibility access</b> so Roy Flow can paste dictation into other apps. Until then, text is copied to the clipboard.
      </span>
      <button className="btn btn-primary" onClick={() => native!.invoke('access:check', { prompt: true }).then((a) => setTrusted(a.accessibility))}>
        Open System Settings
      </button>
    </div>
  );
}
