import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast, useStore } from './store';
import { setNav, useNav } from './nav';
import { Sidebar, TitleBar } from './components/Shell';
import { Dialog, Dropdown, Toasts } from './components/ui';
import Home from './pages/Home';
import Notetaker from './pages/Notetaker';
import Insights from './pages/Insights';
import { Dictionary, Snippets } from './pages/Lists';
import Style from './pages/Style';
import Transforms from './pages/Transforms';
import Scratchpad, { ScratchpadWindow } from './pages/Scratchpad';
import SettingsModal from './settings/SettingsModal';
import FlowBar from './flowbar/FlowBar';

export default function App() {
  const theme = useStore((s) => s.theme);
  const page = useNav((n) => n.page);
  const modal = useNav((n) => n.modal);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="window">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        {page === 'home' && <Home />}
        {page === 'notetaker' && <Notetaker />}
        {page === 'insights' && <Insights />}
        {page === 'dictionary' && <Dictionary />}
        {page === 'snippets' && <Snippets />}
        {page === 'style' && <Style />}
        {page === 'transforms' && <Transforms />}
        {page === 'scratchpad' && <Scratchpad />}
      </div>
      <ScratchpadWindow />
      <FlowBar />
      <SettingsModal />
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
      title="Contact support"
      subtitle="Tell us what went wrong or what you would love to see."
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
            toast('Feedback saved as a text file');
            close();
          }}
        >
          Send message
        </button>
      }
    >
      <Dropdown value={type} options={['Issue', 'Feature idea', 'Account & data']} onChange={setType} align="left" />
      <textarea className="field" placeholder="Describe the issue or idea" value={msg} onChange={(e) => setMsg(e.target.value)} />
    </Dialog>
  );
}

function ReferralDialog() {
  const link = 'https://roy-flow.local/invite/FRIEND1';
  return (
    <Dialog title="Share Roy Flow with a friend" subtitle="Send your invite link. When a friend starts dictating, you both get a month of extras." onClose={() => setNav({ modal: null })} width={512}>
      <div className="referral-card">
        <div className="caps" style={{ letterSpacing: '.14em', fontSize: 10 }}>
          Unlimited access for 1 month
        </div>
        <div className="serif" style={{ fontSize: 34, lineHeight: '36px' }}>
          Roy <em>Flow</em>
        </div>
      </div>
      <div className="url-field">
        <span>{link}</span>
        <button
          className="icon-btn"
          aria-label="Copy link"
          onClick={() => {
            navigator.clipboard?.writeText(link);
            toast('Invite link copied');
          }}
        >
          <Copy size={18} />
        </button>
      </div>
      <p className="small muted">Rewards are applied automatically (in a real deployment).</p>
    </Dialog>
  );
}
