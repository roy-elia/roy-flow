import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, ArrowUpRight, CalendarDays, ChevronDown, ChevronUp, FileText, Folder, MessageSquare, Plus, RotateCw, Search, Settings, Trash2, X } from 'lucide-react';
import { setSetting, setState, toast, uid, useStore, type Chat, type ChatMessage, type Meeting } from '../store';
import { openSettings, setNav, useNav } from '../nav';
import { Confirm, Tabs } from '../components/ui';
import { NotetakerIcon } from '../components/icons';
import { native } from '../native/bridge';
import { useCalendar } from '../native/useCalendar';
import { useShortcutLabel } from '../settings/ShortcutsEditor';
import type { MeetingStatus } from '../shared/ipc';

const dayKey = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const time = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const weekday = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' });
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** live Notetaker state from the main process */
function useMeetingStatus(): MeetingStatus {
  const [st, setSt] = useState<MeetingStatus>({ recording: false, startedAt: 0, title: '', partial: '', segments: [] });
  useEffect(() => {
    if (!native) return;
    return native.on('meeting:status', (s) => {
      setSt(s);
      if (s.error) toast(s.error, { tone: 'error' });
    });
  }, []);
  return st;
}

function SummaryStatus({ m }: { m: Meeting }) {
  const [busy, setBusy] = useState(false);
  const regen = async () => {
    if (!native) return;
    setBusy(true);
    const r = await native.invoke('meeting:summarize', { id: m.id });
    setBusy(false);
    if (!r.ok) toast(r.error ?? 'Could not summarise', { tone: 'error' });
  };
  if (m.summaryStatus === 'pending' || busy) return <p className="muted">Claude is writing the summary…</p>;
  if (m.summaryStatus === 'nokey')
    return (
      <p className="muted">
        Add an Anthropic API key in{' '}
        <button className="link" onClick={() => openSettings('account')}>
          Settings › Account
        </button>{' '}
        to get a summary and action items.{' '}
        {native && (
          <button className="link" onClick={regen}>
            Summarise now
          </button>
        )}
      </p>
    );
  if (m.summaryStatus === 'error')
    return (
      <p style={{ color: 'var(--destructive)' }}>
        {m.summaryError ?? 'The summary failed.'}{' '}
        <button className="link" onClick={regen}>
          Try again
        </button>
      </p>
    );
  return (
    <>
      <p>{m.overview || (m.transcript?.length ? 'No summary yet.' : 'Nothing was transcribed in this recording.')}</p>
      {native && !!m.transcript?.length && (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={regen}>
          <RotateCw size={14} /> Regenerate summary
        </button>
      )}
    </>
  );
}

export default function Notetaker() {
  const meetings = useStore((s) => s.meetings);
  const settings = useStore((s) => s.settings);
  const chats = useStore((s) => s.chats);
  const status = useMeetingStatus();
  const shortcut = useShortcutLabel('notetaker');
  const [cal, refreshCal] = useCalendar();
  const [tab, setTab] = useState<'past' | 'shared' | 'folders'>('past');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [, setTick] = useState(0);
  const [ask, setAsk] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [showChats, setShowChats] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // a past note picked in the menu bar
  const navMeeting = useNav((n) => n.meeting ?? null);
  useEffect(() => {
    if (!navMeeting) return;
    setNav({ meeting: null });
    if (meetings.some((m) => m.id === navMeeting)) setOpen(navMeeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMeeting]);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!status.recording) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [status.recording]);
  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight });
  }, [status.segments.length, status.partial]);
  useEffect(() => {
    if (!native) return;
    return native.on('ai:chunk', ({ id, delta }) => setStreaming((s) => (s && s.id === id ? { id, text: s.text + delta } : s)));
  }, []);

  const list = useMemo(
    () =>
      meetings
        .filter((m) => !m.shared)
        .filter((m) => !q || [m.title, m.overview, m.thoughts ?? '', ...(m.transcript ?? []).map((x) => x.text)].join(' ').toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.ts - a.ts),
    [meetings, q],
  );
  const groups = useMemo(() => {
    const g = new Map<string, Meeting[]>();
    list.forEach((m) => g.set(dayKey(m.ts), [...(g.get(dayKey(m.ts)) ?? []), m]));
    return [...g.entries()];
  }, [list]);
  const folders = useMemo(() => {
    const f = new Map<string, number>();
    meetings.forEach((m) => m.folder && f.set(m.folder, (f.get(m.folder) ?? 0) + 1));
    return [...f.entries()];
  }, [meetings]);
  const current = meetings.find((m) => m.id === (sel ?? list[0]?.id)) ?? null;
  const calConnected = !!(settings.connected_gcal || settings.connected_outlook) && cal?.status === 'authorized';
  const now = Date.now();
  const endOfDay = new Date().setHours(23, 59, 59, 999);
  const todays = (cal?.events ?? []).filter((e) => !e.allDay && e.end > now && e.start < endOfDay);

  const start = async (title?: string) => {
    if (!native) return toast('Notetaker records in the desktop app', { tone: 'error' });
    setStarting(true);
    const r = await native.invoke('meeting:start', { title });
    setStarting(false);
    if (!r.ok) toast(r.error ?? 'Could not start Notetaker', { tone: 'error' });
  };
  const toggleRec = async () => {
    if (status.recording) {
      await native?.invoke('meeting:stop');
      toast('Meeting note saved');
      setState((s) => ({ checklist: { ...s.checklist, try: true } }));
    } else start();
  };

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const submitAsk = async () => {
    const question = ask.trim();
    if (!question || streaming) return;
    if (!native) return toast('Ask runs in the desktop app', { tone: 'error' });
    setAsk('');
    setShowChats(false);
    let c: Chat = chat ?? { id: uid(), title: question.slice(0, 60), updated: Date.now(), messages: [] };
    const messages: ChatMessage[] = [...c.messages, { role: 'user', content: question }];
    c = { ...c, messages, updated: Date.now() };
    setState((s) => ({ chats: [c, ...s.chats.filter((x) => x.id !== c.id)] }));
    setChatId(c.id);
    const reqId = uid();
    setStreaming({ id: reqId, text: '' });
    let text = '';
    const off = native.on('ai:chunk', ({ id, delta }) => id === reqId && (text += delta));
    const r = await native.invoke('ai:ask', { id: reqId, messages });
    off();
    setStreaming(null);
    if (!r.ok && !text) {
      toast(r.error ?? 'Claude could not answer', { tone: 'error' });
      setState((s) => ({ chats: s.chats.map((x) => (x.id === c.id ? { ...x, messages: x.messages.slice(0, -1) } : x)).filter((x) => x.messages.length) }));
      return;
    }
    setState((s) => ({ chats: s.chats.map((x) => (x.id === c.id ? { ...x, updated: Date.now(), messages: [...x.messages, { role: 'assistant', content: text }] } : x)) }));
  };

  const openMeeting = meetings.find((m) => m.id === open);
  if (openMeeting) return <MeetingDetail m={openMeeting} onBack={() => setOpen(null)} list={list} setOpen={setOpen} />;

  const elapsed = status.recording ? Math.floor((Date.now() - status.startedAt) / 1000) : 0;

  return (
    <main className="page nt-page">
      <div className="nt-col">
        <header className="title-row nt-title">
          <h1>Notetaker</h1>
          <div className="row-gap">
            <button className="icon-btn lg" data-tip="Open Notetaker settings" aria-label="Open Notetaker settings" onClick={() => openSettings('notetaker')}>
              <Settings size={20} />
            </button>
            <button className={`btn ${status.recording ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleRec} disabled={starting} data-tip={shortcut ? `Shortcut: ${shortcut}` : undefined}>
              <NotetakerIcon size={18} />
              {status.recording ? `Stop · ${clock(elapsed)}` : starting ? 'Starting…' : 'Start Notetaker'}
            </button>
          </div>
        </header>
        <div className="nt-scroll">
          <div className="nt-content">
            {status.recording && (
              <section className="today-card nt-live">
                <span className="caps">
                  <span className="rec-dot" /> Recording · {status.title}
                </span>
                {settings.liveTranscript !== false ? (
                  <div className="nt-live-body" ref={liveRef}>
                    {status.segments.map((s, i) => (
                      <p key={i}>
                        <span className="muted small">{clock(s.t)}</span> {s.text}
                      </p>
                    ))}
                    {status.partial && <p className="muted">{status.partial}</p>}
                    {!status.segments.length && !status.partial && <p className="muted">Listening… words appear here as people speak.</p>}
                  </div>
                ) : (
                  <p className="muted">Live transcript is hidden. Turn it on in Notetaker settings.</p>
                )}
              </section>
            )}
            {!settings.notetakerAutoPromptDismissed && !settings.autoStartNotetaker && calConnected && (
              <div className="notice">
                <span className="notice-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="3.2" />
                  </svg>
                </span>
                <div className="notice-text">
                  <b>Want Notetaker to start automatically?</b>
                  <span className="muted">Notetaker will switch on when a meeting on your calendar starts</span>
                </div>
                <div className="row-gap" style={{ gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setSetting('notetakerAutoPromptDismissed', true)}>
                    Not now
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setSetting('autoStartNotetaker', true);
                      toast('Notetaker will start automatically');
                    }}
                  >
                    Turn on
                  </button>
                </div>
              </div>
            )}
            <section className="today-card">
              <span className="caps">Today</span>
              {calConnected && todays.length ? (
                <div className="nt-upcoming">
                  {todays.map((e) => {
                    const live = e.start <= now && e.end > now;
                    return (
                      <div key={e.id} className="nt-row" style={{ cursor: 'default' }}>
                        <span className="nt-icon">
                          <CalendarDays size={18} />
                        </span>
                        <div className="nt-row-text">
                          <span className="nt-row-title">{e.title}</span>
                          <span className="nt-row-meta">
                            {live ? 'Now' : time(e.start)} – {time(e.end)}
                            {e.calendar ? ` · ${e.calendar}` : ''}
                          </span>
                        </div>
                        {!status.recording && (
                          <button className="btn btn-outline btn-sm" onClick={() => start(e.title)}>
                            Take notes
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="today-empty">
                  <CalendarDays size={40} strokeWidth={1.4} />
                  <div className="today-empty-title">{calConnected ? 'No more meetings today' : 'No calendar connected'}</div>
                  {!calConnected && (
                    <button className="btn btn-primary" onClick={() => (cal?.status === 'authorized' ? (setSetting('connected_gcal', true), refreshCal(false)) : openSettings('connectors'))}>
                      Connect calendar
                    </button>
                  )}
                </div>
              )}
            </section>
            <div>
              <Tabs
                tabs={[
                  { id: 'past', label: 'Past notes' },
                  { id: 'folders', label: 'Folders' },
                ]}
                value={tab}
                onChange={setTab}
                utils={
                  searching ? (
                    <div className="search-field">
                      <Search size={14} className="muted" />
                      <input autoFocus placeholder="Search notes and transcripts..." value={q} onChange={(e) => setQ(e.target.value)} />
                      <button aria-label="Clear" onClick={() => (setQ(''), setSearching(false))}>
                        <X size={14} className="muted" />
                      </button>
                    </div>
                  ) : (
                    <button className="icon-btn" aria-label="Search notes" onClick={() => setSearching(true)}>
                      <Search size={20} className="muted" />
                    </button>
                  )
                }
              />
              {tab === 'shared' ? (
                <div className="empty">Sharing is not available in the local build. Notes stay on this Mac.</div>
              ) : tab === 'folders' ? (
                <div className="nt-folders">
                  {folders.length === 0 && <div className="empty">No folders yet. Open a note and add it to a folder.</div>}
                  {folders.map(([f, n]) => (
                    <button key={f} className="nt-row" onClick={() => (setQ(''), setTab('past'), setSel(meetings.find((m) => m.folder === f)?.id ?? null))}>
                      <span className="nt-icon">
                        <Folder size={18} />
                      </span>
                      <div className="nt-row-text">
                        <span className="nt-row-title">{f}</span>
                        <span className="muted small">
                          {n} note{n === 1 ? '' : 's'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="empty">{q ? `No notes found for "${q}"` : `No meeting notes yet. Click Start Notetaker${shortcut ? ` or press ${shortcut}` : ''} when a meeting begins.`}</div>
              ) : (
                groups.map(([day, ms]) => (
                  <div key={day} className="nt-day">
                    <div className="caps nt-day-label">{day}</div>
                    {ms.map((m) => (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        className={`nt-row ${current?.id === m.id ? 'selected' : ''}`}
                        onClick={() => setSel(m.id)}
                        onDoubleClick={() => setOpen(m.id)}
                        onKeyDown={(e) => e.key === 'Enter' && setOpen(m.id)}
                      >
                        <span className="nt-icon">
                          <FileText size={18} strokeWidth={1.6} />
                        </span>
                        <div className="nt-row-text">
                          <span className="nt-row-title">
                            {m.title} {m.demo && <span className="badge">Demo</span>}
                          </span>
                          <span className="nt-row-meta">
                            {time(m.ts)} · {m.minutes} min{m.summaryStatus === 'pending' ? ' · summarising…' : ''}
                          </span>
                        </div>
                        <div className="row-actions" style={{ padding: 0 }}>
                          <button className="icon-btn" data-tip="Delete meeting" aria-label="Delete meeting" onClick={(e) => (e.stopPropagation(), setDel(m.id))}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div style={{ height: 110 }} />
          </div>
        </div>
        {(chat || showChats) && (
          <div className="ask-answer nt-chat">
            <div className="row-gap" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="caps muted">{showChats ? 'Past chats' : chat?.title}</span>
              <span className="row-gap" style={{ gap: 4 }}>
                {chat && !showChats && (
                  <button className="icon-btn" data-tip="New chat" aria-label="New chat" onClick={() => setChatId(null)}>
                    <Plus size={16} />
                  </button>
                )}
                <button className="icon-btn" aria-label="Close" onClick={() => (setChatId(null), setShowChats(false))}>
                  <X size={16} />
                </button>
              </span>
            </div>
            {showChats ? (
              chats.length ? (
                <div className="nt-chat-list">
                  {[...chats]
                    .sort((a, b) => b.updated - a.updated)
                    .map((c) => (
                      <div key={c.id} className="nt-row" role="button" tabIndex={0} onClick={() => (setChatId(c.id), setShowChats(false))}>
                        <span className="nt-icon">
                          <MessageSquare size={16} />
                        </span>
                        <div className="nt-row-text">
                          <span className="nt-row-title">{c.title}</span>
                          <span className="nt-row-meta">
                            {dayKey(c.updated)} · {c.messages.length} messages
                          </span>
                        </div>
                        <button className="icon-btn" aria-label="Delete chat" onClick={(e) => (e.stopPropagation(), setState((s) => ({ chats: s.chats.filter((x) => x.id !== c.id) })))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="muted">No past chats yet.</p>
              )
            ) : (
              <div className="nt-chat-body">
                {chat?.messages.map((m, i) => (
                  <div key={i} className={`nt-msg ${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {streaming && <div className="nt-msg assistant">{streaming.text || <span className="muted">Thinking…</span>}</div>}
              </div>
            )}
          </div>
        )}
        <div className="ask-slot">
          <form
            className="ask-bar"
            onSubmit={(e) => {
              e.preventDefault();
              submitAsk();
            }}
          >
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={chat ? 'Ask a follow-up…' : 'Ask anything about your meetings'} aria-label="Ask" disabled={!!streaming} />
            {ask ? (
              <button className="ask-send" aria-label="Ask">
                <ArrowUp size={16} />
              </button>
            ) : (
              <button type="button" className="ask-pill" onClick={() => (setShowChats(!showChats), setChatId(null))}>
                Past chats <ArrowUpRight size={14} />
              </button>
            )}
          </form>
        </div>
      </div>
      <aside className="nt-panel" aria-label="Meeting detail">
        {current ? (
          <>
            <div className="nt-panel-head">
              <h2>{current.title}</h2>
              <span className="muted">
                {weekday(current.ts)} • {time(current.ts)} • {current.minutes} min
              </span>
              <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', marginTop: 12 }} onClick={() => setOpen(current.id)}>
                Open note
              </button>
            </div>
            <div className="nt-panel-body">
              <div className="caps muted">Overview</div>
              <SummaryStatus m={current} />
              {!!current.actionItems?.length && (
                <>
                  <div className="caps muted" style={{ marginTop: 16 }}>
                    Action items
                  </div>
                  <ul>
                    {current.actionItems.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="nt-panel-body muted">Select a note to preview it here.</div>
        )}
      </aside>
      {del && (
        <Confirm
          title="Delete this meeting note?"
          subtitle="The summary and transcript will be removed from this device."
          onClose={() => setDel(null)}
          onConfirm={() => {
            setState((s) => ({ meetings: s.meetings.filter((m) => m.id !== del) }));
            if (sel === del) setSel(null);
            toast('Meeting deleted');
          }}
        />
      )}
    </main>
  );
}

function MeetingDetail({ m, onBack, list, setOpen }: { m: Meeting; onBack: () => void; list: Meeting[]; setOpen: (id: string) => void }) {
  const [tab, setTab] = useState<'thoughts' | 'summary' | 'transcript'>('summary');
  const [thoughts, setThoughts] = useState(m.thoughts ?? '');
  const [folder, setFolder] = useState(m.folder ?? '');
  const i = list.findIndex((x) => x.id === m.id);
  const patch = (p: Partial<Meeting>) => setState((s) => ({ meetings: s.meetings.map((x) => (x.id === m.id ? { ...x, ...p } : x)) }));
  useEffect(() => {
    setThoughts(m.thoughts ?? '');
    setFolder(m.folder ?? '');
  }, [m.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['TEXTAREA', 'INPUT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') onBack();
      if (e.key === 'j' && list[i - 1]) setOpen(list[i - 1].id);
      if (e.key === 'k' && list[i + 1]) setOpen(list[i + 1].id);
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  return (
    <main className="page nt-l2">
      <div className="nt-l2-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="row-gap" style={{ gap: 4 }}>
          <button className="icon-btn" data-tip="Previous (J)" disabled={!list[i - 1]} onClick={() => list[i - 1] && setOpen(list[i - 1].id)}>
            <ChevronUp size={18} />
          </button>
          <button className="icon-btn" data-tip="Next (K)" disabled={!list[i + 1]} onClick={() => list[i + 1] && setOpen(list[i + 1].id)}>
            <ChevronDown size={18} />
          </button>
        </div>
      </div>
      <input className="nt-l2-title nt-title-input" value={m.title} onChange={(e) => patch({ title: e.target.value })} aria-label="Meeting title" />
      <div className="muted row-gap" style={{ padding: '0 8px 12px', gap: 8 }}>
        {dayKey(m.ts)} · {time(m.ts)} · {m.minutes} min
        <span style={{ flex: 1 }} />
        <Folder size={14} />
        <input
          className="nt-folder-input"
          placeholder="Add to folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={() => patch({ folder: folder.trim() || undefined })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="nt-l2-card">
        <div className="pill-tabs">
          {(
            [
              ['thoughts', 'My thoughts'],
              ['summary', 'Summary'],
              ['transcript', 'Transcript'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`pill-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'summary' && (
          <div className="nt-l2-body">
            <div className="caps muted">Overview</div>
            <SummaryStatus m={m} />
            {!!m.actionItems?.length && (
              <>
                <div className="caps muted" style={{ marginTop: 16 }}>
                  Action items
                </div>
                <ul>
                  {m.actionItems.map((a, k) => (
                    <li key={k}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {tab === 'transcript' && (
          <div className="nt-l2-body">
            {m.transcript?.length ? (
              m.transcript.map((s, k) => (
                <p key={k} style={{ marginBottom: 10 }}>
                  <span className="muted small">{clock(s.t)}</span> {s.text}
                </p>
              ))
            ) : (
              <p className="muted">{m.demo ? 'Demo notes have no transcript.' : 'No transcript was recorded.'}</p>
            )}
          </div>
        )}
        {tab === 'thoughts' && (
          <textarea
            className="nt-thoughts"
            placeholder="Write your own notes..."
            value={thoughts}
            onChange={(e) => {
              setThoughts(e.target.value);
              patch({ thoughts: e.target.value });
            }}
          />
        )}
      </div>
    </main>
  );
}
