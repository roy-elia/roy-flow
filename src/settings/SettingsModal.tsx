import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  CircleUserRound,
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
import { resetState, setSetting, setState, toast, useStore } from '../store';
import { openSettings, setNav, useNav, type SettingsTab } from '../nav';
import { ConnectorsIcon, McpIcon, NotetakerIcon } from '../components/icons';
import { Confirm, Dialog, Dropdown, Switch } from '../components/ui';
import { useCalendar } from '../native/useCalendar';
import { toggleTheme } from '../components/Shell';
import { native } from '../native/bridge';
import { DEFAULT_MIC, LANGUAGES, MODELS, type McpInfo } from '../shared/ipc';
import { demoData } from '../seed';
import { useShortcutLabel } from './ShortcutsEditor';

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
            <span>Roy Flow v{__APP_VERSION__}</span>
            <span className="muted" data-tip="This local build does not update itself">Local build</span>
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

/* ------------------------------------------------------------------ General */
function General() {
  const s = useStore((st) => st.settings);
  const theme = useStore((st) => st.theme);
  const ptt = useShortcutLabel('ptt');
  const hands = useShortcutLabel('handsfree');
  const [dlg, setDlg] = useState<null | 'mic' | 'lang'>(null);
  const openKeys = () => setNav({ modal: 'shortcuts' });
  return (
    <Page title="General">
      <Card>
        <Row
          label="Shortcuts"
          desc={
            ptt ? (
              <>
                Hold <span className="key-inline">{ptt}</span> and speak, let go to paste.
              </>
            ) : (
              'No push-to-talk key set.'
            )
          }
        >
          <button className="btn btn-secondary set-btn" onClick={openKeys} data-testid="change-shortcuts">
            Change
          </button>
        </Row>
        <Row
          label="Hands-free dictation"
          desc={
            hands ? (
              <>
                Press <span className="key-inline">{hands}</span> anywhere to start, press again to paste.
              </>
            ) : (
              'No hands-free shortcut set.'
            )
          }
        >
          <button className="btn btn-secondary set-btn" onClick={openKeys}>
            Change
          </button>
        </Row>
        <Row label="Microphone" desc={s.microphone as string}>
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('mic')}>
            Change
          </button>
        </Row>
        <Row label="My languages" desc={`${s.language as string} · used for speech recognition`}>
          <button className="btn btn-secondary set-btn" onClick={() => setDlg('lang')}>
            Change
          </button>
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
      {dlg === 'mic' && <MicDialog onClose={() => setDlg(null)} />}
      {dlg === 'lang' && (
        <PickDialog title="Languages" sub="Select the language you speak for better accuracy." options={LANGUAGES} value={s.language as string} onPick={(v) => setSetting('language', v)} onClose={() => setDlg(null)} />
      )}
    </Page>
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
  const [devices, setDevices] = useState<string[]>([DEFAULT_MIC]);
  useEffect(() => {
    if (native) {
      native.invoke('devices:get').then((d) => setDevices([DEFAULT_MIC, ...d]));
      return;
    }
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        const names = d.filter((x) => x.kind === 'audioinput' && x.label).map((x) => x.label);
        if (names.length) setDevices([DEFAULT_MIC, ...names.filter((n) => !/default/i.test(n))]);
      })
      .catch(() => {});
  }, []);
  return (
    <PickDialog
      title="Microphone"
      sub="Used for dictation and Notetaker. “Built-in mic” follows the macOS default input."
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
          <Toggle k="launchAtLogin" label="Launch app at login" desc="Starts in the menu bar when you log in" />
          <Toggle k="showFlowBar" label="Show Flow Bar at all times" desc="When off, the Flow Bar only appears while you dictate" />
          <Row label="Flow Bar position" desc="Where the Flow Bar docks on screen">
            <Select k="flowBarDock" options={['Bottom', 'Left', 'Right']} width={165} />
          </Row>
          <Toggle k="showInDock" label="Show app in dock" desc="When off, Roy Flow lives in the menu bar while its windows are closed" />
        </Card>
      </Section>
      <Section title="Sound">
        <Card>
          <Toggle k="sounds" label="Dictation and notification sounds" />
          <Toggle k="muteWhileDictating" label="Mute all audio while dictating" desc="Mutes your Mac's output while you speak and restores it afterwards" />
        </Card>
      </Section>
      <Section title="Notifications">
        <Card>
          <Toggle k="suggestions" label="Suggestions" desc="Tips for getting set up and getting more out of Roy Flow." />
          <Toggle k="announcements" label="Announcements" desc="New features after an update" />
          <Toggle k="milestones" label="Milestones" desc="Word-count milestones and streaks" />
          {native && (
            <Row label="Test notifications" desc="macOS asks once whether Roy Flow may show notifications">
              <button className="btn btn-secondary set-btn" onClick={() => native!.invoke('notify:test')}>
                Send test
              </button>
            </Row>
          )}
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
          <Toggle k="autoAddDictionary" label="Auto-add to dictionary" desc="When you correct a word in a transcript on Home, the correction is added to your dictionary" />
          <Toggle k="creatorMode" label="Creator mode" desc='Show "Dictating with Roy Flow" on the Flow Bar while you dictate' />
          <Row
            label="Smart Formatting"
            desc={
              <>
                Smart Formatting now lives in the{' '}
                <button className="link" onClick={() => setNav({ settings: null, page: 'style', styleTab: 'cleanup' })}>
                  Auto Cleanup
                </button>{' '}
                tab.
              </>
            }
          />
        </Card>
      </Section>
      <Section title="Data">
        <Card>
          <Row label="Reset app" desc="Deletes all Roy Flow data on this Mac (history, notes, dictionary, settings, API key), then restarts.">
            <button className="btn btn-secondary set-btn" onClick={() => setReset(true)}>
              Reset &amp; restart
            </button>
          </Row>
        </Card>
      </Section>
      {reset && (
        <Confirm
          title="Reset and restart?"
          subtitle="Everything Roy Flow stored on this Mac is deleted, including your Anthropic API key. This cannot be undone."
          confirm="Reset & restart"
          onClose={() => setReset(false)}
          onConfirm={() => {
            if (native) native.invoke('store:reset');
            else {
              resetState();
              location.reload();
            }
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
  const key = useShortcutLabel('notetaker');
  return (
    <Page
      title="Notetaker"
    >
      <Section title="Meeting detection">
        <Card>
          <Row label="Notify before scheduled meetings start" desc="A macOS notification before a meeting on your calendar starts">
            <Select k="notifyBefore" options={['Off', '15 sec', '1 min', '5 min']} />
          </Row>
          <Toggle k="showNextMeeting" label="Show your next meeting in the menu bar" desc="Shows the meeting name and a countdown next to the menu bar icon. Turn it off to keep just the icon." />
          <Toggle k="autoStartNotetaker" label="Start Notetaker automatically" desc="Start Notetaker when a meeting on your calendar begins" />
          <Row label="Maximum recording length" desc="Notetaker stops at this length, with a notification a minute before">
            <Select k="maxRecording" options={['30 min', '1 hour', '2 hours', '4 hours']} />
          </Row>
          <Toggle k="stopWhenCallEnds" label="Stop Notetaker when a call ends" desc="Stops after 3 minutes without anyone speaking" />
        </Card>
      </Section>
      <Section title="While Notetaker is active">
        <Card>
          <Toggle k="hideInCapture" label="Don't show the Flow Bar in screen capture" desc="The Flow Bar stays out of screenshots and screen shares (at all times, not only while Notetaker records)." />
          <Row
            label="Keyboard shortcut"
            desc={
              key ? (
                <>
                  Press <b>{key}</b> to start or stop Notetaker
                </>
              ) : (
                'No shortcut set'
              )
            }
          >
            <button className="btn btn-secondary set-btn" onClick={() => setNav({ modal: 'shortcuts' })}>
              Change shortcut
            </button>
          </Row>
        </Card>
      </Section>
      <Section title="Transcript">
        <Card>
          <Toggle k="liveTranscript" label="Show live transcript" desc="See the words appear on the Notetaker page while it records" />
        </Card>
      </Section>
      <p className="small muted">Notetaker records your microphone and transcribes it on this Mac. Always tell people when you are taking notes of a call.</p>
    </Page>
  );
}

/* ------------------------------------------------------------------ Vibe coding */
function Vibe() {
  return (
    <Page title="Vibe coding">
      <Card>
        <Toggle
          k="codeAware"
          label="Code-aware dictation"
          desc={
            <>
              In code editors and terminals (VS Code, Cursor, Xcode, Zed, Windsurf, JetBrains, Terminal, iTerm, Warp) Roy Flow keeps your words literal: fillers are removed, but nothing is capitalised and no full stop is added, so names like{' '}
              <code className="code-chip">index.tsx</code> or <code className="code-chip">userId</code> paste as spoken. Your Style choice is not applied there.
            </>
          }
        />
      </Card>
    </Page>
  );
}

/* ------------------------------------------------------------------ Connectors / MCP */
const Logo = ({ l, c }: { l: string; c: string }) => (
  <span className="ph-logo" style={{ background: c }}>
    {l}
  </span>
);

const CAL = [
  { k: 'connected_gcal', name: 'Google Calendar', l: 'G', c: '#7aa7e0' },
  { k: 'connected_outlook', name: 'Outlook Calendar', l: 'O', c: '#6f9bd1' },
];
const SOON = [
  { name: 'Slack', l: 'S', c: '#b48ac0', d: 'Context from messages, folded into your summaries and briefs' },
  { name: 'Gmail', l: 'M', c: '#d98b80', d: 'Bring context from your emails into Ask Anything and summaries' },
  { name: 'Notion', l: 'N', c: '#8a8780', d: 'Links to docs and relevant context in summaries and briefs' },
];
function Connectors() {
  const s = useStore((st) => st.settings);
  const [cal, refresh] = useCalendar();
  const connect = async (k: string, name: string) => {
    if (s[k]) {
      setSetting(k, false);
      return toast(`${name} disconnected`);
    }
    if (!native) return toast('Calendar access needs the desktop app', { tone: 'error' });
    const c = await refresh(true);
    if (c?.status === 'authorized') {
      setSetting(k, true);
      setState((st) => ({ checklist: { ...st.checklist, calendar: true } }));
      toast(`${name} connected · ${c.events.length} event${c.events.length === 1 ? '' : 's'} this week`);
    } else {
      toast('Allow Roy Flow to access your calendars in System Settings › Privacy & Security › Calendars', { tone: 'error' });
      native.invoke('access:open', { pane: 'calendar' });
    }
  };
  return (
    <Page title="Connectors" desc="Connecting your apps helps Roy Flow give you accurate reminders, summaries, and briefs">
      {CAL.map((c) => (
        <div className="conn-card" key={c.k}>
          <div className="set-text">
            <div className="set-label row-gap" style={{ gap: 10 }}>
              <Logo l={c.l} c={c.c} />
              {c.name}
            </div>
            <div className="set-row-desc">
              Reads meetings from the macOS Calendar app on this Mac. Add your {c.name.split(' ')[0]} account in System Settings › Internet Accounts if it is not there yet.
              {s[c.k] && cal?.status === 'denied' && <span style={{ color: 'var(--destructive)' }}> Calendar access is turned off.</span>}
            </div>
          </div>
          <div className="set-controls">
            <button className="btn btn-outline conn-btn" onClick={() => connect(c.k, c.name)}>
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
      {SOON.map((c) => (
        <div className="conn-card" key={c.name}>
          <div className="set-text">
            <div className="set-label row-gap" style={{ gap: 10 }}>
              <Logo l={c.l} c={c.c} />
              {c.name} <span className="badge">Coming soon</span>
            </div>
            <div className="set-row-desc">{c.d}</div>
          </div>
          <div className="set-controls">
            <button className="btn btn-outline conn-btn" disabled>
              Coming soon
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

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="url-field">
      <span title={value}>{value || 'Starting…'}</span>
      <button
        className="icon-btn"
        aria-label={`Copy ${label}`}
        disabled={!value}
        onClick={() => {
          navigator.clipboard?.writeText(value);
          toast(`${label} copied`);
        }}
      >
        <Copy size={18} />
      </button>
    </div>
  );
}
function Mcp() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const load = () => native?.invoke('mcp:info').then(setInfo);
  useEffect(() => {
    load();
  }, []);
  const others = [
    { n: 'Cursor', l: 'C', c: '#8a8780', how: 'Settings › MCP › Add new MCP server, type “command”, and paste the command below.' },
    { n: 'ChatGPT', l: 'G', c: '#9fb8ad', how: 'ChatGPT connectors need a public URL; use the local URL only with apps on this Mac that support local MCP servers.' },
  ];
  if (!native)
    return (
      <Page title="MCP" desc="Sync Notetaker with your favourite AI apps.">
        <p className="muted">The MCP server runs inside the Roy Flow desktop app.</p>
      </Page>
    );
  return (
    <Page title="MCP" desc="Let your AI apps read your Notetaker meeting notes and transcripts through a local MCP server on this Mac. It never exposes your dictations.">
      <div className="conn-card">
        <div className="set-text">
          <div className="set-label row-gap" style={{ gap: 10 }}>
            <Logo l="C" c="#e3a58c" />
            Claude Desktop
          </div>
          <div className="set-row-desc">
            {info?.added ? 'Added. Restart Claude Desktop, then ask it about your meetings.' : info?.claudeInstalled === false ? 'Claude Desktop does not seem to be installed.' : 'Adds Roy Flow to Claude Desktop\'s MCP config after you confirm.'}
          </div>
        </div>
        <button
          className="btn btn-outline conn-btn"
          disabled={!info}
          onClick={async () => {
            const r = await native!.invoke('mcp:addClaude');
            if (r.ok) {
              setState((s) => ({ checklist: { ...s.checklist, mcp: true } }));
              toast('Added to Claude. Restart Claude Desktop to use it.');
            } else if (!r.cancelled) toast(r.error ?? 'Could not add to Claude', { tone: 'error' });
            load();
          }}
        >
          {info?.added ? (
            <>
              <Check size={16} /> Added
            </>
          ) : (
            'Add to Claude'
          )}
        </button>
      </div>
      {others.map((a) => (
        <div className="conn-card" key={a.n}>
          <div className="set-text">
            <div className="set-label row-gap" style={{ gap: 10 }}>
              <Logo l={a.l} c={a.c} />
              {a.n}
            </div>
            <div className="set-row-desc">{a.how}</div>
          </div>
        </div>
      ))}
      <h3 className="set-section-title" style={{ fontWeight: 550 }}>
        All other apps:
      </h3>
      <div className="conn-card mcp-steps">
        <span className="set-label">Local command (stdio), works while Roy Flow is closed</span>
        <CopyField value={info?.command ?? ''} label="Command" />
        <span className="set-label">Local URL (Streamable HTTP), works while Roy Flow is running</span>
        <CopyField value={info?.url ?? ''} label="URL" />
        <span className="small muted">The URL contains a private token. Only share it with apps on this Mac. Tools: list_meetings, get_meeting, search_meetings.</span>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ Account pages */
function AiKey() {
  const [status, setStatus] = useState<{ hasKey: boolean; encryption: boolean; hint?: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => native?.invoke('ai:status').then(setStatus);
  useEffect(() => {
    load();
  }, []);
  if (!native)
    return (
      <Card>
        <Row label="Claude" desc="Claude features run in the Roy Flow desktop app." />
      </Card>
    );
  const test = async () => {
    setBusy(true);
    setResult(null);
    const r = await native!.invoke('ai:test');
    setBusy(false);
    setResult(r.ok ? { ok: true, text: `Connected to ${r.model} in ${((r.ms ?? 0) / 1000).toFixed(1)} s` } : { ok: false, text: r.error ?? 'Test failed' });
  };
  return (
    <Section title="Claude (AI)">
      <Card>
        <Row
          label="Anthropic API key"
          desc={
            status?.hasKey ? (
              <>
                Saved in your macOS Keychain ({status.hint}). Used for clean-up ({MODELS.quick}), Transforms, summaries and Ask ({MODELS.smart}).
              </>
            ) : (
              <>Paste a key from console.anthropic.com. It is encrypted with your Keychain and never leaves the app except to call Claude.</>
            )
          }
        >
          {status?.hasKey && (
            <>
              <button className="btn btn-secondary set-btn" disabled={busy} onClick={test} data-testid="ai-test">
                {busy ? 'Testing…' : 'Test'}
              </button>
              <button
                className="btn btn-secondary set-btn"
                onClick={async () => {
                  await native!.invoke('ai:clearKey');
                  setResult(null);
                  load();
                  toast('API key removed');
                }}
              >
                Remove
              </button>
            </>
          )}
        </Row>
        {!status?.hasKey && (
          <div className="set-row" style={{ gap: 12 }}>
            <input
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="Anthropic API key"
              data-testid="ai-key"
            />
            <button
              className="btn btn-primary"
              disabled={!key.trim() || busy}
              onClick={async () => {
                setBusy(true);
                const r = await native!.invoke('ai:setKey', { key });
                setBusy(false);
                setKey('');
                if (!r.ok) return setResult({ ok: false, text: r.error ?? 'Could not save the key' });
                await load();
                await test();
              }}
            >
              Save
            </button>
          </div>
        )}
        <Toggle k="aiCleanup" label="Clean up dictation with Claude" desc="Uses your Auto Cleanup level and Style choices. Without a key, Roy Flow uses basic on-device rules." />
        {result && (
          <div className="set-row">
            <span className="small" style={{ color: result.ok ? 'var(--success, inherit)' : 'var(--destructive)' }}>
              {result.ok ? '✓ ' : ''}
              {result.text}
            </span>
          </div>
        )}
        {status && !status.encryption && (
          <div className="set-row">
            <span className="small" style={{ color: 'var(--destructive)' }}>Secure storage is unavailable, so a key cannot be saved.</span>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Account() {
  const user = useStore((s) => s.user);
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName);
  const [email, setEmail] = useState(user.email);
  return (
    <Page title="Account" desc="Roy Flow runs locally: there is no online account. Your name is only used on this Mac.">
      <Card>
        <Row label="Profile picture" desc="Your initials">
          <span className="avatar-lg">{((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '·'}</span>
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
        <div className="set-row" style={{ gap: 12 }}>
          <label className="tf-field" style={{ flex: 1 }}>
            <span className="set-label">Email (optional). Snippets can insert it with {'{email}'}, and your name with {'{name}'}</span>
            <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <div className="set-row" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!first.trim()) return toast("First name can't be empty", { tone: 'error' });
              setState({ user: { firstName: first.trim(), lastName: last.trim(), email: email.trim() } });
              toast('Profile updated');
            }}
          >
            Save
          </button>
        </div>
      </Card>
      <AiKey />
    </Page>
  );
}

function Team() {
  return (
    <Page title="Team" desc="Share dictionary words and snippets with the people you work with.">
      <div className="empty-container">
        <b>Teams are not available in the local build</b>
        <span className="muted">Everything stays on this Mac. To share words or snippets, export your data from Data and Privacy.</span>
      </div>
    </Page>
  );
}

function Billing() {
  return (
    <Page title="Plans and Billing">
      <div className="plan-current">
        <div>
          <div className="set-label">Local plan — all features included</div>
          <div className="set-row-desc">Roy Flow has no subscription. Claude features use your own Anthropic API key and are billed by Anthropic to that key.</div>
        </div>
        <button className="btn btn-secondary set-btn" onClick={() => openSettings('account')}>
          API key
        </button>
      </div>
      <div className="plans">
        <div className="plan current">
          <div className="set-label">Included</div>
          <ul>
            {['Unlimited dictation, on-device speech recognition', 'Dictionary, snippets, styles and Scratchpad', 'Notetaker with live transcripts', 'Transforms, summaries and Ask (with your Claude key)', 'Local MCP server for your meeting notes'].map((x) => (
              <li key={x}>
                <Check size={14} /> {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Page>
  );
}

function Privacy() {
  const [del, setDel] = useState(false);
  const hasDemo = useStore((s) => s.meetings.some((m) => m.demo) || s.history.some((h) => h.id.startsWith('demo-')));
  return (
    <Page title="Data and Privacy">
      <Card>
        <Toggle k="contextAwareness" label="Context awareness" desc="Check which app you are dictating into, to pick its Style and show usage by app" />
        <Row label="Local data storage" desc="History and dictation audio stay on this Mac. “Never store” keeps transcripts but no audio.">
          <Select k="localStorage" options={['Store normally', 'Auto-delete after 30 days', 'Never store']} width={220} />
        </Row>
      </Card>
      <Card>
        <Row label="Export all data" desc="Save everything Roy Flow stores (history, notes, meetings, dictionary, settings) as JSON. Your API key is not included.">
          <button
            className="btn btn-secondary set-btn"
            onClick={async () => {
              if (native) {
                const r = await native.invoke('store:export');
                if (r.ok) toast(`Exported to ${r.path}`);
                return;
              }
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([localStorage.getItem('roy-flow-state-v1') ?? '{}'], { type: 'application/json' }));
              a.download = 'roy-flow-data.json';
              a.click();
            }}
          >
            Export
          </button>
        </Row>
        <Row label="Delete all data" desc="Removes your history, audio, notes, meetings, chats, dictionary and snippets. Settings and your API key stay.">
          <button className="btn btn-destructive" onClick={() => setDel(true)}>
            Delete
          </button>
        </Row>
        <Row label={hasDemo ? 'Remove demo data' : 'Load demo data'} desc="Sample dictations, meetings, words and snippets to explore the app. They are marked as demo and never shared over MCP.">
          <button
            className="btn btn-secondary set-btn"
            onClick={() => {
              if (hasDemo) {
                setState((s) => ({
                  history: s.history.filter((h) => !h.id.startsWith('demo-')),
                  meetings: s.meetings.filter((m) => !m.demo),
                  dictionary: s.dictionary.filter((d) => !d.id.startsWith('demo-')),
                  snippets: s.snippets.filter((x) => !x.id.startsWith('demo-')),
                }));
                return toast('Demo data removed');
              }
              const d = demoData();
              setState((s) => ({ history: [...s.history, ...d.history], meetings: [...s.meetings, ...d.meetings], dictionary: [...s.dictionary, ...d.dictionary], snippets: [...s.snippets, ...d.snippets] }));
              toast('Demo data loaded');
            }}
          >
            {hasDemo ? 'Remove' : 'Load'}
          </button>
        </Row>
      </Card>
      <p className="small muted row-gap" style={{ gap: 6 }}>
        <Monitor size={14} /> Speech is recognised on this Mac. Text only leaves it when you use Claude features with your own API key.
      </p>
      {del && (
        <Confirm
          title="Delete all data?"
          subtitle="Your dictation history, audio, notes, meetings, chats, dictionary and snippets will be removed from this Mac."
          onClose={() => setDel(false)}
          onConfirm={() => {
            setState({ history: [], notes: [], meetings: [], chats: [], dictionary: [], snippets: [], voiceProfile: null });
            toast('All data deleted');
          }}
        />
      )}
    </Page>
  );
}
