import { Bell, Check, CircleHelp, CircleUserRound, Gift, Mic, Moon, PanelLeft, Scissors, Settings, Sun, Users, WandSparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { setState, useStore } from '../store';
import { go, openSettings, setNav, useNav, type PageId } from '../nav';
import { DictionaryIcon, Glyph, InsightsIcon, NotetakerIcon, ScratchpadIcon, StyleIcon } from './icons';
import { useClickOutside } from './ui';
import { isElectron } from '../native/bridge';

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  const html = document.documentElement;
  html.dataset.themeTransition = 'fade';
  setState({ theme: next });
  window.setTimeout(() => delete html.dataset.themeTransition, 260);
}

export function TitleBar() {
  const theme = useStore((s) => s.theme);
  const user = useStore((s) => s.user);
  const open = useStore((s) => s.sidebarOpen);
  const [pop, setPop] = useState<null | 'bell' | 'account'>(null);
  const ref = useClickOutside(!!pop, () => setPop(null));
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        {isElectron ? (
          /* native traffic lights are drawn by macOS here (trafficLightPosition 16,15) */
          <div className="traffic-spacer" aria-hidden />
        ) : (
          <div className="traffic" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )}
        <button className="tb-btn" aria-label="Toggle sidebar" aria-expanded={open} onClick={() => setState({ sidebarOpen: !open })} data-tip="Toggle sidebar" data-tip-pos="bottom">
          <PanelLeft size={20} strokeWidth={1.8} />
        </button>
      </div>
      <div className="titlebar-right" ref={ref}>
        <button className="tb-btn" aria-label="Toggle dark mode" onClick={toggleTheme} data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'} data-tip-pos="bottom">
          {theme === 'dark' ? <Sun size={20} strokeWidth={1.8} /> : <Moon size={20} strokeWidth={1.8} />}
        </button>
        <button className="tb-btn" aria-label="Notifications" onClick={() => setPop(pop === 'bell' ? null : 'bell')}>
          <Bell size={20} strokeWidth={1.8} />
        </button>
        <button className="tb-btn" aria-label="Account" onClick={() => setPop(pop === 'account' ? null : 'account')}>
          <CircleUserRound size={21} strokeWidth={1.8} />
        </button>
        {pop === 'bell' && (
          <div className="menu popover" style={{ top: 44, right: 50, width: 320 }}>
            <div className="pop-head">Notifications</div>
            <div className="pop-item">
              <b>2 day streak</b>
              <span className="muted">Keep dictating tomorrow to extend it.</span>
            </div>
            <div className="pop-item">
              <b>Welcome to Roy Flow</b>
              <span className="muted">Hold your shortcut anywhere and speak.</span>
            </div>
          </div>
        )}
        {pop === 'account' && (
          <div className="menu popover" style={{ top: 44, right: 8, width: 260 }}>
            <div className="pop-item">
              <b>
                {user.firstName} {user.lastName}
              </b>
              <span className="muted">{user.email}</span>
            </div>
            <button className="menu-item" onClick={() => (setPop(null), openSettings('account'))}>
              Account settings
            </button>
            <button className="menu-item" onClick={() => (setPop(null), openSettings('billing'))}>
              Plans and Billing
            </button>
            <button className="menu-item" onClick={() => (setPop(null), setNav({ modal: 'shortcuts' }))}>
              Shortcuts
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

const NAV: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Dictation', icon: <Mic size={18} /> },
  { id: 'notetaker', label: 'Notetaker', icon: <NotetakerIcon /> },
  { id: 'insights', label: 'Insights', icon: <InsightsIcon /> },
  { id: 'dictionary', label: 'Dictionary', icon: <DictionaryIcon /> },
  { id: 'snippets', label: 'Snippets', icon: <Scissors size={18} /> },
  { id: 'style', label: 'Style', icon: <StyleIcon /> },
  { id: 'transforms', label: 'Transforms', icon: <WandSparkles size={18} /> },
  { id: 'scratchpad', label: 'Scratchpad', icon: <ScratchpadIcon /> },
];

const STEPS = [
  { id: 'try', label: 'Try Notetaker', run: () => go('notetaker') },
  { id: 'calendar', label: 'Connect calendar', run: () => openSettings('connectors') },
  { id: 'import', label: 'Import your past meetings', run: () => openSettings('notetaker') },
  { id: 'mcp', label: 'Set up MCP', run: () => openSettings('mcp') },
];

export function Sidebar() {
  const page = useNav((n) => n.page);
  const open = useStore((s) => s.sidebarOpen);
  const checklist = useStore((s) => s.checklist);
  const done = STEPS.filter((s) => checklist[s.id]).length;
  return (
    <aside className={`sidebar ${open ? '' : 'collapsed'}`} aria-label="Sidebar">
      <div>
        <div className="logo-row" onClick={() => go('home')} role="link" aria-label="Roy Flow home">
          <Glyph />
          <span className="wordmark">Roy Flow</span>
        </div>
        <nav aria-label="Main navigation">
          <ul className="nav">
            {NAV.map((n) => (
              <li key={n.id}>
                <button
                  className={`nav-item ${page === n.id ? 'active' : ''}`}
                  aria-current={page === n.id ? 'page' : undefined}
                  onClick={() => go(n.id)}
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    const i = NAV.findIndex((x) => x.id === page);
                    if (e.key === 'ArrowDown') go(NAV[Math.min(NAV.length - 1, i + 1)].id);
                    if (e.key === 'ArrowUp') go(NAV[Math.max(0, i - 1)].id);
                  }}
                >
                  {n.icon}
                  <span className="nav-label">{n.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="bottom-section">
        {done < STEPS.length && (
          <div className="side-card">
            <h4>Set up Notetaker</h4>
            <div className="progress">
              <div style={{ width: `${Math.max(8, (done / STEPS.length) * 100)}%` }} />
            </div>
            {STEPS.map((s) => (
              <button
                key={s.id}
                className="check-row"
                onClick={() => {
                  setState((st) => ({ checklist: { ...st.checklist, [s.id]: true } }));
                  s.run();
                }}
              >
                <span className={`check-dot ${checklist[s.id] ? 'done' : ''}`}>{checklist[s.id] && <Check size={13} strokeWidth={2.6} />}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="side-divider" />
        <ul className="nav bottom-nav">
          <li>
            <button className="nav-item" onClick={() => openSettings('team')}>
              <Users size={18} />
              <span className="nav-label">Invite your team</span>
            </button>
          </li>
          <li>
            <button className="nav-item" onClick={() => setNav({ modal: 'referral' })}>
              <Gift size={18} />
              <span className="nav-label">Share Roy Flow</span>
            </button>
          </li>
          <li>
            <button className="nav-item" onClick={() => openSettings('general')}>
              <Settings size={18} />
              <span className="nav-label">Settings</span>
            </button>
          </li>
          <li>
            <button className="nav-item" onClick={() => setNav({ modal: 'help' })}>
              <CircleHelp size={18} />
              <span className="nav-label">Help</span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}
