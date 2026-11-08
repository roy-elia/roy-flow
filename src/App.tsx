import { lazy, Suspense, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast, useStore } from './store';
import { setNav, useNav } from './nav';
import { Sidebar, TitleBar } from './components/Shell';
import { Dialog, Dropdown, Toasts } from './components/ui';
import Home from './pages/Home';
import Scratchpad, { ScratchpadWindow } from './pages/Scratchpad';
import HubBridge from './native/HubBridge';
// pages and dialogs other than Home load on first use (smaller start-up, less memory in the hub renderer)
const Notetaker = lazy(() => import('./pages/Notetaker'));
const Insights = lazy(() => import('./pages/Insights'));
const Dictionary = lazy(() => import('./pages/Lists').then((m) => ({ default: m.Dictionary })));
const Snippets = lazy(() => import('./pages/Lists').then((m) => ({ default: m.Snippets })));
const Style = lazy(() => import('./pages/Style'));
const Transforms = lazy(() => import('./pages/Transforms'));
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
const ShortcutsDialog = lazy(() => import('./settings/ShortcutsEditor'));
const FlowBar = lazy(() => import('./flowbar/FlowBar'));
import AccessBanner from './native/AccessBanner';
import { isElectron } from './native/bridge';

export default function App() {
  const theme = useStore((s) => s.theme);
  const page = useNav((n) => n.page);
  const modal = useNav((n) => n.modal);
  const settingsOpen = useNav((n) => !!n.settings);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="window">
      <TitleBar />
      <AccessBanner />
      <div className="app-body">
        <Sidebar />
        <Suspense fallback={<div className="page" />}>
        {page === 'home' && <Home />}
        {page === 'notetaker' && <Notetaker />}
        {page === 'insights' && <Insights />}
        {page === 'dictionary' && <Dictionary />}
        {page === 'snippets' && <Snippets />}
        {page === 'style' && <Style />}
        {page === 'transforms' && <Transforms />}
        {page === 'scratchpad' && <Scratchpad />}
        </Suspense>
      </div>
      <ScratchpadWindow />
      {/* in the desktop app the Flow Bar lives in its own always-on-top panel window */}
      {/* one boundary each, so a dialog loading for the first time never hides another one */}
      {isElectron ? (
        <HubBridge />
      ) : (
        <Suspense fallback={null}>
          <FlowBar />
        </Suspense>
      )}
      <Suspense fallback={null}>{settingsOpen && <SettingsModal />}</Suspense>
      <Suspense fallback={null}>{modal === 'shortcuts' && <ShortcutsDialog onClose={() => setNav({ modal: null })} />}</Suspense>
      {modal === 'help' && <HelpDialog />}
      {modal === 'referral' && <ReferralDialog />}
      <Toasts />
    </div>
  );
}

function HelpDialog() {
  const [type, setType] = useState('Issue');
  const [msg, setMsg] = useState('');
  const close = () => setNav({ modal: null });
  return (
    <Dialog
      title="Help and feedback"
      subtitle="Roy Flow is a local app with no support service. Write your note here and save it as a text file to keep or send."
      onClose={close}
      width={520}
      actions={
        <button
          className="btn btn-primary"
          disabled={!msg.trim()}
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([`Type: ${type}\n\n${msg}`], { type: 'text/plain' }));
            a.download = 'roy-flow-feedback.txt';
            a.click();
            toast('Saved roy-flow-feedback.txt to Downloads');
            close();
          }}
        >
          Save as text file
        </button>
      }
    >
      <Dropdown value={type} options={['Issue', 'Feature idea', 'Account & data']} onChange={setType} align="left" />
      <textarea className="field" placeholder="Describe the issue or idea" value={msg} onChange={(e) => setMsg(e.target.value)} />
    </Dialog>
  );
}

function ReferralDialog() {
  const text = 'I dictate with Roy Flow: hold a key, talk, and clean text lands in any app. It runs on my Mac.';
  return (
    <Dialog title="Share Roy Flow" subtitle="Roy Flow is a local app with no accounts or referral rewards. Copy a short note to tell a friend about it." onClose={() => setNav({ modal: null })} width={512}>
      <div className="referral-card">
        <div className="caps" style={{ letterSpacing: '.14em', fontSize: 10 }}>
          Dictation for your Mac
        </div>
        <div className="serif" style={{ fontSize: 34, lineHeight: '36px' }}>
          Roy <em>Flow</em>
        </div>
      </div>
      <div className="url-field">
        <span>{text}</span>
        <button
          className="icon-btn"
          aria-label="Copy"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            toast('Copied');
          }}
        >
          <Copy size={18} />
        </button>
      </div>
    </Dialog>
  );
}
