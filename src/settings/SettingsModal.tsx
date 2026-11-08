import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  CircleUserRound,
  CirclePlay,
  CloudCheck,
  Copy,
  CreditCard,
  Hash,
  Laptop,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
} from 'lucide-react';
import { getState, resetState, setSetting, setState, toast, useStore } from '../store';
import { go, openSettings, setNav, useNav, type SettingsTab } from '../nav';
import { ConnectorsIcon, McpIcon, NotetakerIcon } from '../components/icons';
import { Confirm, Dialog, Dropdown, Info, Switch } from '../components/ui';
import { toggleTheme } from '../components/Shell';
import { native } from '../native/bridge';
import { acceleratorLabel, DEFAULT_TOGGLE_SHORTCUT } from '../shared/ipc';

const APP_TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={18} /> },
  { id: 'system', label: 'System', icon: <Laptop size={18} /> },
  { id: 'notetaker', label: 'Notetaker', icon: <NotetakerIcon size={18} /> },
  { id: 'vibe', label: 'Vibe coding', icon: <Hash size={18} /> },
  { id: 'connectors', label: 'Connectors', icon: <ConnectorsIcon size={18} /> },
  { id: 'mcp', label: 'MCP', icon: <McpIcon size={18} /> },
];
const ACCOUNT_TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <CircleUserRound size={18} /> },
  { id: 'team', label: 'Team', icon: <Users size={18} /> },
  { id: 'billing', label: 'Plans and Billing', icon: <CreditCard size={18} /> },
  { id: 'privacy', label: 'Data and Privacy', icon: <ShieldCheck size={18} /> },
];

export default function SettingsModal() {
  const tab = useNav((n) => n.settings);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.dialog') && setNav({ settings: null });
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  if (!tab) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setNav({ settings: null })}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-modal">
        <aside className="set-side">
          <div className="set-top">
            <div className="set-group caps">Settings</div>
            {APP_TABS.map((t) => (
              <button key={t.id} className={`nav-item set-item ${tab === t.id ? 'active' : ''}`} onClick={() => openSettings(t.id)}>
                {t.icon}
                {t.label}
              </button>
            ))}
            <div className="side-divider" style={{ margin: '6px 0' }} />
            <div className="set-group caps">Account</div>
            {ACCOUNT_TABS.map((t) => (
              <button key={t.id} className={`nav-item set-item ${tab === t.id ? 'active' : ''}`} onClick={() => openSettings(t.id)}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="set-version">
            <span>Roy Flow v1.0.0</span>
            <button className="icon-btn" data-tip="Up to date" aria-label="Up to date" onClick={() => toast('Roy Flow is up to date')}>
              <CloudCheck size={18} />
            </button>
          </div>
        </aside>
        <div className="set-content">
          {tab === 'general' && <General />}
          {tab === 'system' && <System />}
          {tab === 'notetaker' && <NotetakerSettings />}
          {tab === 'vibe' && <Vibe />}
          {tab === 'connectors' && <Connectors />}
          {tab === 'mcp' && <Mcp />}
          {tab === 'account' && <Account />}
          {tab === 'team' && <Team />}
          {tab === 'billing' && <Billing />}
          {tab === 'privacy' && <Privacy />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ building blocks */
function Page({ title, desc, action, children }: { title: string; desc?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-page">
      <div className="set-header">
        <div className="set-title-row">
          <h2 className="set-title">{title}</h2>
          {action}
        </div>
        {desc && <p className="set-desc">{desc}</p>}
      </div>
      <div className="set-body">{children}</div>
    </div>
  );
}
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-section">
      {title && <h3 className="set-section-title">{title}</h3>}
      {children}
    </section>
  );
}
function Card({ children }: { children: ReactNode[] | ReactNode }) {
  const kids = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div className="set-card">
      {kids.map((c, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {i > 0 && <div className="set-rule" />}
          {c}
        </div>
      ))}
    </div>
  );
}
function Row({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-label">{label}</div>
        {desc && <div className="set-row-desc">{desc}</div>}
      </div>
      {children && <div className="set-controls">{children}</div>}
    </div>
  );
}
function Toggle({ k, label, desc }: { k: string; label: ReactNode; desc?: ReactNode }) {
  const v = useStore((s) => !!s.settings[k]);
  return (
    <Row label={label} desc={desc}>
      <Switch on={v} onChange={(x) => setSetting(k, x)} label={typeof label === 'string' ? label : k} />
    </Row>
  );
}
function Select({ k, options, width = 200 }: { k: string; options: string[]; width?: number }) {
  const v = useStore((s) => s.settings[k] as string);
  return <Dropdown value={v} options={options} onChange={(x) => setSetting(k, x)} width={width} />;
}
const Learn = ({ onClick }: { onClick?: () => void }) => (
  <button className="learn" onClick={onClick ?? (() => toast('Docs are not bundled with this local build'))}>
    Learn more <ArrowRight size={14} strokeWidth={2.4} />
  </button>
);

/* ------------------------------------------------------------------ General */
const KEYS = ['fn', 'ctrl + opt', 'right cmd', 'right opt', 'ctrl + space'];
function General() {
  const s = useStore((st) => st.settings);
  const theme = useStore((st) => st.theme);
  const [dlg, setDlg] = useState<null | 'keys' | 'mic' | 'lang'>(null);
  return (
    <Page title="General">
      <Card>
        <Row
          label="Shortcuts"
          desc={
            <>
              Hold <span className="key-inline">{s.pttKey as string}</span> and speak. <Learn />
            </>
          }
        >
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('keys')}>
            Change
          </button>
        </Row>
        <Row
          label="Hands-free dictation"
          desc={
            <>
              Press <span className="key-inline">{acceleratorLabel((s.toggleShortcut as string) || DEFAULT_TOGGLE_SHORTCUT)}</span> anywhere to start, press again to paste.
            </>
          }
        >
          <ShortcutRecorder />
        </Row>
        <Row label="Microphone" desc={s.microphone as string}>
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('mic')}>
            Change
          </button>
        </Row>
        <Row label="My languages" desc={s.language as string}>
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('lang')}>
            Change
          </button>
        </Row>
        <Row label="App Language" desc="Choose the language Roy Flow is shown in">
          <Select k="appLanguage" options={['English', 'Français', 'Español', 'Deutsch']} width={165} />
        </Row>
        <Row label="Theme">
          <Dropdown
            value={theme}
            width={165}
            options={[
              { value: 'light', label: 'Light', icon: <Sun size={18} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={18} /> },
            ]}
            onChange={(v) => v !== theme && toggleTheme()}
          />
        </Row>
      </Card>
      {dlg === 'keys' && (
        <PickDialog
          title="Shortcuts"
          sub="Choose the key you hold to dictate."
          options={KEYS}
          value={s.pttKey as string}
          onPick={(v) => setSetting('pttKey', v)}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'mic' && <MicDialog onClose={() => setDlg(null)} />}
      {dlg === 'lang' && (
        <PickDialog
          title="Languages"
          sub="Select the language you speak for better accuracy."
          options={['English', 'French', 'Spanish', 'German', 'Portuguese', 'Italian', 'Japanese']}
          value={s.language as string}
          onPick={(v) => setSetting('language', v)}
          onClose={() => setDlg(null)}
        />
      )}
    </Page>
  );
}

const CODE_KEYS: Record<string, string> = { Space: 'Space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' };
function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

/** records a key combination as an Electron accelerator for the global toggle shortcut */
function ShortcutRecorder() {
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) return setRec(false);
      const key = codeToKey(e.code);
      if (!key) return; // modifier only, keep listening
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean) as string[];
      if (!mods.length && !/^F\d+$/.test(key)) return toast('Use at least one modifier key (⌃ ⌥ ⇧ ⌘)', { tone: 'error' });
      const acc = [...mods, key].join('+');
      setRec(false);
      const apply = () => {
        setSetting('toggleShortcut', acc);
        toast(`Shortcut set to ${acceleratorLabel(acc)}`);
      };
      if (!native) return apply();
      native.invoke('shortcut:set', { accelerator: acc }).then((r) => (r.ok ? apply() : toast(r.error ?? 'That shortcut is in use by another app', { tone: 'error' })));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rec]);
  return (
    <button className="btn btn-secondary set-btn" onClick={() => setRec(!rec)} aria-live="polite">
      {rec ? 'Press keys…' : 'Change'}
    </button>
  );
}

function PickDialog({ title, sub, options, value, onPick, onClose }: { title: string; sub: string; options: string[]; value: string; onPick: (v: string) => void; onClose: () => void }) {
  return (
    <Dialog title={title} subtitle={sub} onClose={onClose} width={460}>
      <div className="pick-list">
        {options.map((o) => (
          <button
            key={o}
            className={`menu-item ${o === value ? 'selected' : ''}`}
            onClick={() => {
              onPick(o);
              onClose();
            }}
          >
            {o}
            {o === value && <Check size={16} className="check" />}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function MicDialog({ onClose }: { onClose: () => void }) {
  const cur = useStore((s) => s.settings.microphone as string);
  const [devices, setDevices] = useState<string[]>(['Built-in mic (recommended)']);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        const names = d.filter((x) => x.kind === 'audioinput' && x.label).map((x) => x.label);
        if (names.length) setDevices(['Built-in mic (recommended)', ...names.filter((n) => !/default/i.test(n))]);
      })
      .catch(() => {});
  }, []);
  return (
    <PickDialog
      title="Microphone"
      sub="Used for dictation. Notetaker always picks the best available mic."
      options={devices}
      value={cur}
      onPick={(v) => setSetting('microphone', v)}
      onClose={onClose}
    />
  );
}

/* ------------------------------------------------------------------ System */
function System() {
  const [reset, setReset] = useState(false);
  const scratch = useStore((s) => s.settings.scratchpadOpen as string);
  const [pick, setPick] = useState(false);
  return (
    <Page title="System">
      <Section title="App settings">
        <Card>
          <Toggle k="launchAtLogin" label="Launch app at login" />
          <Toggle k="showFlowBar" label="Show Flow Bar at all times" />
          <Row label="Flow Bar position" desc="Where the Flow Bar docks on screen">
            <Select k="flowBarDock" options={['Bottom', 'Left', 'Right']} width={165} />
          </Row>
          <Toggle k="showInDock" label="Show app in dock" />
        </Card>
      </Section>
      <Section title="Sound">
        <Card>
          <Toggle k="sounds" label="Dictation and notification sounds" />
          <Toggle k="muteWhileDictating" label="Mute all audio while dictating" />
        </Card>
      </Section>
      <Section title="Notifications">
        <Card>
          <Toggle k="suggestions" label="Suggestions" desc="Tips for getting set up and getting more out of Roy Flow." />
          <Toggle k="announcements" label="Announcements" desc="New features or capabilities" />
          <Toggle k="milestones" label="Milestones" desc="Word-count milestones, streaks, and referral activity" />
        </Card>
      </Section>
      <Section title="Scratchpad">
        <Card>
          <Row label="Scratchpad open behavior" desc={scratch}>
            <button className="btn btn-secondary set-btn" onClick={() => setPick(true)}>
              Customize
            </button>
          </Row>
        </Card>
      </Section>
      <Section title="Extras">
        <Card>
          <Toggle k="autoAddDictionary" label="Auto-add to dictionary" desc="Adds corrected words automatically" />
          <Toggle k="creatorMode" label="Creator mode" desc='Show "Dictating with Roy Flow" while you dictate' />
          <Row
            label="Smart Formatting"
            desc={
              <>
                Smart Formatting now lives in the{' '}
                <button className="link" onClick={() => (setNav({ settings: null }), go('style'))}>
                  Auto Cleanup
                </button>{' '}
                tab.
              </>
            }
          />
          <Row label="Show Roy Flow on your profile" desc="List Roy Flow under the apps on your public profile">
            <button className="btn btn-secondary set-btn sm" onClick={() => toast('Profile sharing is not available offline')}>
              Connect
            </button>
          </Row>
        </Card>
      </Section>
      <Section title="Data">
        <Card>
          <Row
            label="Reset app"
            desc={
              <>
                Only reset if support asks you to. <Learn />
              </>
            }
          >
            <button className="btn btn-secondary set-btn" onClick={() => setReset(true)}>
              Reset &amp; restart
            </button>
          </Row>
        </Card>
      </Section>
      {reset && (
        <Confirm
          title="Reset and restart?"
          subtitle="Clears everything this app stored in your browser and restores the sample data."
          confirm="Reset & restart"
          onClose={() => setReset(false)}
          onConfirm={() => {
            resetState();
            location.reload();
          }}
        />
      )}
      {pick && (
        <PickDialog
          title="Scratchpad open behavior"
          sub="What Scratchpad shows when you open it."
          options={['Resume last note', 'Start a new note', 'Show all notes']}
          value={scratch}
          onPick={(v) => setSetting('scratchpadOpen', v)}
          onClose={() => setPick(false)}
        />
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ Notetaker */
function NotetakerSettings() {
  const who = useStore((s) => s.settings.autoShareWho as string);
  const forW = useStore((s) => s.settings.autoShareFor as string);
  return (
    <Page
      title="Notetaker"
      action={
        <button className="btn btn-outline btn-sm" onClick={() => (setNav({ settings: null }), go('notetaker'), toast('Tutorial: click Start Notetaker to record'))}>
          <CirclePlay size={16} /> Start tutorial
        </button>
      }
    >
      <Section title="Meeting detection">
        <Card>
          <Row label="Notify before scheduled meetings start" desc="Pick how early you get a heads-up before a meeting on your calendar starts">
            <Select k="notifyBefore" options={['Off', '15 sec', '1 min', '5 min']} />
          </Row>
          <Toggle k="showNextMeeting" label="Show your next meeting in the menu bar" desc="Shows the meeting name and a countdown next to the menu bar icon. Turn it off to keep just the icon." />
          <Toggle k="detectCalls" label="Automatically detect any call" desc="Notetaker offers to take notes when you join a call" />
          <Toggle k="autoStartNotetaker" label="Start Notetaker automatically" desc="Start Notetaker when a meeting begins" />
          <Row label="Maximum recording length" desc="Notetaker stops at this length, with a warning shortly before">
            <Select k="maxRecording" options={['30 min', '1 hour', '2 hours', '4 hours']} />
          </Row>
          <Toggle k="stopWhenCallEnds" label="Stop Notetaker when a call ends" desc="Notetaker stops on its own so you don't have to" />
        </Card>
      </Section>
      <Section title="While Notetaker is active">
        <Card>
          <Toggle
            k="hideInCapture"
            label="Don't show Notepad and Flow Bar in screen capture"
            desc="Notepad and Flow Bar stay out of screenshots and screen shares. Always ask before you transcribe."
          />
        </Card>
      </Section>
      <Section title="Notepad">
        <Card>
          <Row label="Notepad View" desc="Choose the default view. Side by side shows the meeting and Notepad together.">
            <Select k="notepadView" options={['Open Notepad', 'Side by side', 'Minimized']} />
          </Row>
          <Row
            label="Keyboard shortcut"
            desc={
              <>
                Press <b>Opt + M</b> to join a meeting or start the Notetaker
              </>
            }
          >
            <button className="btn btn-secondary set-btn" onClick={() => toast('Shortcut editing is coming soon')}>
              Change shortcut
            </button>
          </Row>
        </Card>
      </Section>
      <Section title="Transcript">
        <Card>
          <Toggle k="liveTranscript" label="Show live transcript" desc="See the words appear on screen while Notetaker is on" />
        </Card>
      </Section>
      <Section title="Consent">
        <Card>
          <Row
            label={
              <span className="row-gap" style={{ gap: 6 }}>
                Calendar notice <Info tip="Adds a short line to your calendar invites" />
              </span>
            }
            desc="Mention in your calendar event descriptions that you'll use Notetaker"
          >
            <Select k="calendarNotice" options={['Off', 'My events', 'All events']} />
          </Row>
          <Toggle k="consentNotice" label="Post a consent notice in the meeting chat" desc="When Notetaker starts, let everyone on the call know you're transcribing" />
        </Card>
      </Section>
      <Section title="Sharing">
        <Card>
          <Row label="Default for Notetaker links" desc="Choose who can open Notetaker links. Transcripts are only visible to people you invite by email.">
            <Select k="linkDefault" options={['Anyone with the link', 'Only invited people', 'People at my domain']} />
          </Row>
          <Row
            label="Auto-share notes"
            desc={
              <span className="row-gap" style={{ gap: 6, flexWrap: 'wrap' }}>
                When notes are ready, share them with
                <Dropdown inline value={who} options={['no one', 'attendees', 'my team']} onChange={(v) => setSetting('autoShareWho', v)} align="left" />
                for
                <Dropdown inline value={forW} options={['all meetings', 'internal meetings', 'external meetings']} onChange={(v) => setSetting('autoShareFor', v)} align="left" />
              </span>
            }
          />
        </Card>
      </Section>
      <Card>
        <Row label="Import your meeting notes" desc={<span className="muted">Bring over past meeting notes, summaries, and transcripts</span>}>
          <button className="btn btn-secondary set-btn" onClick={() => (setState((s) => ({ checklist: { ...s.checklist, import: true } })), toast('Nothing to import yet'))}>
            Import
          </button>
        </Row>
      </Card>
    </Page>
  );
}

/* ------------------------------------------------------------------ Vibe coding */
function Vibe() {
  const [setup, setSetup] = useState(false);
  return (
    <Page title="Vibe coding">
      <Card>
        <Row
          label="Variable recognition (VS Code, Cursor, Devin)"
          desc={
            <>
              Recognises variable names in your code. <Learn />
            </>
          }
        >
          <button className="btn btn-secondary set-btn" onClick={() => setSetup(true)}>
            Set up
          </button>
        </Row>
        <Row
          label="File Tagging in Chat (Cursor & Devin)"
          desc={
            <>
              Tags files in your IDE (like <code className="code-chip">index.tsx</code>).
              <br />
              <Learn />
            </>
          }
        >
          <ToggleOnly k="fileTagging" />
        </Row>
      </Card>
      {setup && (
        <Dialog title="Set up variable recognition" subtitle="Two quick steps in your editor:" onClose={() => setSetup(false)} actions={<button className="btn btn-primary" onClick={() => setSetup(false)}>Done</button>}>
          <ol className="steps">
            <li>Open your editor's settings and search for “Screen Reader Optimized”.</li>
            <li>Turn it on, then restart the editor so Roy Flow can read symbol names.</li>
          </ol>
        </Dialog>
      )}
    </Page>
  );
}
function ToggleOnly({ k }: { k: string }) {
  const v = useStore((s) => !!s.settings[k]);
  return <Switch on={v} onChange={(x) => setSetting(k, x)} label={k} />;
}

/* ------------------------------------------------------------------ Connectors / MCP */
const Logo = ({ l, c }: { l: string; c: string }) => (
  <span className="ph-logo" style={{ background: c }}>
    {l}
  </span>
);
const CONNECTORS = [
  { k: 'connected_gcal', name: 'Google Calendar', l: 'G', c: '#7aa7e0', d: 'Accurate reminders for Google meetings before they begin' },
  { k: 'connected_outlook', name: 'Outlook Calendar', l: 'O', c: '#6f9bd1', d: 'Accurate reminders for Outlook meetings before they begin' },
  { k: 'connected_slack', name: 'Slack', l: 'S', c: '#b48ac0', d: 'Context from messages, folded into your summaries and briefs', info: true },
  { k: 'connected_gmail', name: 'Gmail', l: 'M', c: '#d98b80', d: 'Bring context from your emails into Ask Anything and summaries' },
  { k: 'connected_notion', name: 'Notion', l: 'N', c: '#8a8780', d: 'Links to docs and relevant context in summaries and briefs', info: true },
];
function Connectors() {
  const s = useStore((st) => st.settings);
  return (
    <Page title="Connectors" desc="Connecting your apps helps Roy Flow give you accurate reminders, summaries, and briefs">
      {CONNECTORS.map((c) => (
        <div className="conn-card" key={c.k}>
          <div className="set-text">
            <div className="set-label row-gap" style={{ gap: 10 }}>
              <Logo l={c.l} c={c.c} />
              {c.name}
            </div>
            <div className="set-row-desc">{c.d}</div>
          </div>
          <div className="set-controls">
            {c.info && <Info tip="Only metadata is read; messages stay in the app" />}
            <button
              className="btn btn-outline conn-btn"
              onClick={() => {
                setSetting(c.k, !s[c.k]);
                if (!s[c.k] && c.k.includes('cal')) setState((st) => ({ checklist: { ...st.checklist, calendar: true } }));
                toast(s[c.k] ? `${c.name} disconnected` : `${c.name} connected (simulated)`);
              }}
            >
              {s[c.k] ? (
                <>
                  <Check size={16} /> Connected
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </div>
      ))}
      <div className="conn-footer">
        <span className="orb-stack">
          <Logo l="A" c="#e3a58c" />
          <Logo l="C" c="#9fb8ad" />
          <Logo l="G" c="#a9b6e3" />
        </span>
        <span style={{ flex: 1 }}>Give your AI access to your meeting transcripts and notes</span>
        <button className="btn btn-outline conn-btn" onClick={() => openSettings('mcp')}>
          Go to MCP
        </button>
      </div>
    </Page>
  );
}
function Mcp() {
  const url = 'https://roy-flow.local/connect/mcp';
  const apps = [
    { n: 'Claude', l: 'C', c: '#e3a58c' },
    { n: 'ChatGPT', l: 'G', c: '#9fb8ad' },
    { n: 'Gemini', l: 'G', c: '#a9b6e3' },
    { n: 'Cursor', l: 'C', c: '#8a8780' },
  ];
  return (
    <Page title="MCP" desc="Sync Notetaker with your favourite AI apps, so you can ask about your meeting transcripts and notes. The MCP server never sees your dictations.">
      {apps.map((a) => (
        <div className="conn-card" key={a.n}>
          <div className="set-text">
            <div className="set-label row-gap" style={{ gap: 10 }}>
              <Logo l={a.l} c={a.c} />
              {a.n}
            </div>
            <div className="set-row-desc">Allow {a.n} to access your meeting notes and transcripts</div>
          </div>
          <button
            className="btn btn-outline conn-btn"
            onClick={() => {
              setState((s) => ({ checklist: { ...s.checklist, mcp: true } }));
              toast(`Copy the connection URL into ${a.n}`);
            }}
          >
            Add to {a.n}
          </button>
        </div>
      ))}
      <h3 className="set-section-title" style={{ fontWeight: 550 }}>
        All other apps:
      </h3>
      <div className="conn-card mcp-steps">
        <div className="row-gap" style={{ gap: 12 }}>
          <span className="set-label" style={{ whiteSpace: 'nowrap' }}>
            1. Copy your connection URL
          </span>
          <div className="url-field">
            <span>{url}</span>
            <button
              className="icon-btn"
              aria-label="Copy URL"
              onClick={() => {
                navigator.clipboard?.writeText(url);
                toast('URL copied');
              }}
            >
              <Copy size={18} />
            </button>
          </div>
        </div>
        <span className="set-label">2. Add it to your AI tool as a custom connector or plugin</span>
        <span className="set-label">3. Approve access in your browser and start asking your AI about your meetings</span>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ Account pages */
function Account() {
  const user = useStore((s) => s.user);
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName);
  const [dlg, setDlg] = useState<null | 'out' | 'delete'>(null);
  const [typed, setTyped] = useState('');
  return (
    <Page title="Account">
      <Card>
        <Row label="Profile picture" desc="Click to upload a new profile picture (max 5MB)">
          <span className="avatar-lg">{(first[0] ?? '') + (last[0] ?? '')}</span>
        </Row>
        <div className="set-row" style={{ gap: 12 }}>
          <label className="tf-field" style={{ flex: 1 }}>
            <span className="set-label">First name</span>
            <input className="field" value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label className="tf-field" style={{ flex: 1 }}>
            <span className="set-label">Last name</span>
            <input className="field" value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
        </div>
        <Row label="Email" desc={user.email} />
        <div className="set-row" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!first.trim() || !last.trim()) return toast("First name and last name can't be empty", { tone: 'error' });
              setState({ user: { ...user, firstName: first.trim(), lastName: last.trim() } });
              toast('Profile updated successfully!');
            }}
          >
            Save
          </button>
        </div>
      </Card>
      <Card>
        <Row label="Sign out" desc="Sign out of Roy Flow on this device">
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('out')}>
            Sign out
          </button>
        </Row>
        <Row label="Delete account" desc="Delete all your data, dictionary and notes from this device">
          <button className="btn btn-destructive" onClick={() => setDlg('delete')}>
            Delete account
          </button>
        </Row>
      </Card>
      {dlg === 'out' && (
        <Confirm title="Are you sure you want to sign out?" subtitle="This local build has no account, so nothing will change." confirm="Sign out" onClose={() => setDlg(null)} onConfirm={() => toast('Still signed in (local build)')} />
      )}
      {dlg === 'delete' && (
        <Dialog
          title="Are you sure you want to delete your account?"
          subtitle="This deletes all your data, notes and dictionary stored in this browser. Type DELETE to confirm."
          onClose={() => setDlg(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setDlg(null)}>
                Cancel
              </button>
              <button
                className="btn btn-destructive"
                disabled={typed !== 'DELETE'}
                onClick={() => {
                  resetState();
                  location.reload();
                }}
              >
                Delete account
              </button>
            </>
          }
        >
          <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
        </Dialog>
      )}
    </Page>
  );
}

function Team() {
  const user = useStore((s) => s.user);
  const [members, setMembers] = useState<string[]>(() => JSON.parse(localStorage.getItem('roy-flow-team') ?? '[]'));
  const [email, setEmail] = useState('');
  const [tab, setTab] = useState<'members' | 'requests'>('members');
  const invite = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Please enter a valid email address', { tone: 'error' });
    const next = [...members, email];
    setMembers(next);
    localStorage.setItem('roy-flow-team', JSON.stringify(next));
    setEmail('');
    toast(`Invite saved for ${email}`);
  };
  return (
    <Page title="Team" desc="Share dictionary words and snippets with the people you work with.">
      <div className="tabs" style={{ marginBottom: 4 }}>
        <button className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>
          Team members
        </button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
          Requests
        </button>
      </div>
      {tab === 'members' ? (
        <>
          <div className="table">
            <div className="row" style={{ padding: '0 16px' }}>
              <span className="avatar">{user.firstName[0]}</span>
              <span style={{ flex: 1, marginLeft: 12 }}>
                {user.firstName} {user.lastName} <span className="muted">(you)</span>
              </span>
              <span className="muted">Admin</span>
            </div>
            {members.map((m) => (
              <div className="row" key={m} style={{ padding: '0 16px' }}>
                <span className="avatar b">{m[0].toUpperCase()}</span>
                <span style={{ flex: 1, marginLeft: 12 }}>{m}</span>
                <span className="muted">Invited</span>
              </div>
            ))}
          </div>
          <div className="row-gap" style={{ gap: 8 }}>
            <input className="field" placeholder="Enter email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} />
            <button className="btn btn-primary" onClick={invite}>
              Invite
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard?.writeText('https://roy-flow.local/join/team');
                toast('Invite link copied');
              }}
            >
              Copy link
            </button>
          </div>
        </>
      ) : (
        <div className="empty-container">
          <b>No requests</b>
          <span className="muted">People asking to join your team will show up here.</span>
        </div>
      )}
    </Page>
  );
}

function Billing() {
  const cycle = useStore((s) => s.settings.billing as string);
  const annual = cycle === 'Annual';
  const plans = [
    { n: 'Free', p: '$0', f: ['2,000 words a week', 'Dictionary and snippets', 'Works in every app'] },
    { n: 'Pro', p: annual ? '$12' : '$15', f: ['Unlimited words', 'Transforms and styles', 'Notetaker with summaries'], current: true },
    { n: 'Enterprise', p: 'Custom', f: ['Team dictionary', 'Admin controls', 'Priority support'] },
  ];
  return (
    <Page
      title="Plans and Billing"
      action={
        <div className="segmented">
          {['Monthly', 'Annual'].map((c) => (
            <button key={c} className={cycle === c ? 'on' : ''} onClick={() => setSetting('billing', c)}>
              {c}
            </button>
          ))}
        </div>
      }
    >
      <div className="plan-current">
        <div>
          <div className="set-label">Pro plan</div>
          <div className="set-row-desc">Local build: every feature is unlocked.</div>
        </div>
        <button className="btn btn-secondary set-btn" onClick={() => toast('No billing in this local build')}>
          Manage billing
        </button>
      </div>
      <h3 className="set-section-title">All plans</h3>
      <div className="plans">
        {plans.map((p) => (
          <div key={p.n} className={`plan ${p.current ? 'current' : ''}`}>
            <div className="set-label">{p.n}</div>
            <div className="serif" style={{ fontSize: 32, lineHeight: '36px' }}>
              {p.p}
              {p.p.startsWith('$') && <span className="small muted" style={{ fontFamily: 'Figtree', letterSpacing: 0 }}> / month</span>}
            </div>
            <ul>
              {p.f.map((x) => (
                <li key={x}>
                  <Check size={14} /> {x}
                </li>
              ))}
            </ul>
            <button className={`btn ${p.current ? 'btn-secondary' : 'btn-primary'}`} disabled={p.current}>
              {p.current ? 'Current plan' : p.n === 'Enterprise' ? 'Contact sales' : 'Switch'}
            </button>
          </div>
        ))}
      </div>
      {!annual && (
        <div className="plan-current">
          <span>Switch to annual billing and save 20%</span>
          <button className="btn btn-primary" onClick={() => setSetting('billing', 'Annual')}>
            Update now
          </button>
        </div>
      )}
    </Page>
  );
}

function Privacy() {
  const [del, setDel] = useState(false);
  return (
    <Page title="Data and Privacy">
      <Card>
        <Toggle k="improveModel" label="Improve the model for everyone" desc="Share anonymised dictation snippets to improve accuracy" />
        <Toggle k="cloudStorage" label="Dictation cloud storage" desc="Keep a copy of your history so it syncs between devices" />
        <Toggle k="contextAwareness" label="Context awareness" desc="Read nearby text in the active app to spell names correctly" />
        <Toggle k="publicInfo" label="Show your public information" desc="Let teammates see your name and avatar" />
        <Row label="Local data storage" desc="How long history stays on this device">
          <Select k="localStorage" options={['Store normally', 'Auto-delete after 30 days', 'Never store']} width={220} />
        </Row>
      </Card>
      <Card>
        <Row label="Download your data" desc="Get a copy of everything Roy Flow stores in this browser (JSON)">
          <button
            className="btn btn-secondary set-btn"
            onClick={() => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' }));
              a.download = 'roy-flow-data.json';
              a.click();
            }}
          >
            Download
          </button>
        </Row>
        <Row label="Delete usage data" desc="Clears your dictation history and statistics">
          <button className="btn btn-secondary set-btn" onClick={() => setDel(true)}>
            Delete
          </button>
        </Row>
      </Card>
      <p className="small muted row-gap" style={{ gap: 6 }}>
        <Monitor size={14} /> Everything in Roy Flow is stored locally in your browser.
      </p>
      {del && (
        <Confirm
          title="Delete usage data?"
          subtitle="Your dictation history and stats will be removed. Dictionary and snippets stay."
          onClose={() => setDel(false)}
          onConfirm={() => {
            setState({ history: [], totals: { words: 0, wpm: 0, streak: 0 } });
            toast('Usage data deleted');
          }}
        />
      )}
    </Page>
  );
}
