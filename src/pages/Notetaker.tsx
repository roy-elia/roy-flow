import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUp, ArrowUpRight, CalendarDays, ChevronDown, ChevronUp, FileText, Folder, FolderPlus, Search, Settings, Trash2, X } from 'lucide-react';
import { setSetting, setState, toast, uid, useStore, type Meeting } from '../store';
import { openSettings } from '../nav';
import { Confirm, Tabs } from '../components/ui';
import { NotetakerIcon } from '../components/icons';

const dayKey = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const time = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const weekday = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' });

export default function Notetaker() {
  const meetings = useStore((s) => s.meetings);
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<'past' | 'shared' | 'folders'>('past');
  const [sel, setSel] = useState<string | null>(meetings[0]?.id ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [rec, setRec] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState<null | { q: string; hits: Meeting[] }>(null);
  const [del, setDel] = useState<string | null>(null);

  useEffect(() => {
    if (rec === null) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [rec]);

  const list = useMemo(
    () =>
      meetings
        .filter((m) => (tab === 'shared' ? m.shared : !m.shared))
        .filter((m) => !q || (m.title + m.overview).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.ts - a.ts),
    [meetings, tab, q],
  );
  const groups = useMemo(() => {
    const g = new Map<string, Meeting[]>();
    list.forEach((m) => g.set(dayKey(m.ts), [...(g.get(dayKey(m.ts)) ?? []), m]));
    return [...g.entries()];
  }, [list]);
  const current = meetings.find((m) => m.id === sel) ?? null;

  const toggleRec = () => {
    if (rec === null) {
      setRec(Date.now());
      setTick(0);
      toast('Notetaker started');
      return;
    }
    const mins = Math.max(1, Math.round((Date.now() - rec) / 60000));
    const m: Meeting = { id: uid(), title: 'Untitled meeting', ts: rec, minutes: mins, people: 1, overview: 'Recorded locally. Add your own notes under My thoughts.' };
    setState((s) => ({ meetings: [m, ...s.meetings], checklist: { ...s.checklist, try: true } }));
    setRec(null);
    setSel(m.id);
    toast('Meeting note saved');
  };

  const submitAsk = () => {
    if (!ask.trim()) return;
    const words = ask.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const hits = meetings.filter((m) => words.some((w) => (m.title + ' ' + m.overview).toLowerCase().includes(w)));
    setAnswer({ q: ask, hits });
    setAsk('');
  };

  const openMeeting = meetings.find((m) => m.id === open);
  if (openMeeting) return <MeetingDetail m={openMeeting} onBack={() => setOpen(null)} list={list} setOpen={setOpen} />;

  const elapsed = rec !== null ? Math.floor((Date.now() - rec) / 1000) + tick * 0 : 0;

  return (
    <main className="page nt-page">
      <div className="nt-col">
        <header className="title-row nt-title">
          <h1>Notetaker</h1>
          <div className="row-gap">
            <button className="icon-btn lg" data-tip="Open Notetaker settings" aria-label="Open Notetaker settings" onClick={() => openSettings('notetaker')}>
              <Settings size={20} />
            </button>
            <button className={`btn ${rec !== null ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleRec}>
              <NotetakerIcon size={18} />
              {rec !== null ? `Stop · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'Start Notetaker'}
            </button>
          </div>
        </header>
        <div className="nt-scroll">
          <div className="nt-content">
            {!settings.notetakerAutoPromptDismissed && !settings.autoStartNotetaker && (
              <div className="notice">
                <span className="notice-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="3.2" />
                  </svg>
                </span>
                <div className="notice-text">
                  <b>Want Notetaker to start automatically?</b>
                  <span className="muted">Notetaker will switch on as soon as a meeting starts</span>
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
              <div className="today-empty">
                <CalendarDays size={40} strokeWidth={1.4} />
                <div className="today-empty-title">{settings.connected_gcal || settings.connected_outlook ? 'No more meetings today' : 'No meetings found'}</div>
                {!(settings.connected_gcal || settings.connected_outlook) && (
                  <button className="btn btn-primary" onClick={() => openSettings('connectors')}>
                    Connect calendar
                  </button>
                )}
              </div>
            </section>
            <div>
              <Tabs
                tabs={[
                  { id: 'past', label: 'Past notes' },
                  { id: 'shared', label: 'Shared with me' },
                  { id: 'folders', label: 'Folders' },
                ]}
                value={tab}
                onChange={setTab}
                utils={
                  searching ? (
                    <div className="search-field">
                      <Search size={14} className="muted" />
                      <input autoFocus placeholder="Search personal or shared notes..." value={q} onChange={(e) => setQ(e.target.value)} />
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
              {tab === 'folders' ? (
                <div className="nt-folders">
                  {['Product', 'Personal'].map((f) => (
                    <div key={f} className="nt-row">
                      <span className="nt-icon">
                        <Folder size={18} />
                      </span>
                      <div className="nt-row-text">
                        <span className="nt-row-title">{f}</span>
                        <span className="muted small">{f === 'Product' ? '3 notes' : 'No notes in this folder yet'}</span>
                      </div>
                    </div>
                  ))}
                  <button className="nt-row" onClick={() => toast('Folders are kept locally in this build')}>
                    <span className="nt-icon">
                      <FolderPlus size={18} />
                    </span>
                    <span className="nt-row-title">Create folder</span>
                  </button>
                </div>
              ) : groups.length === 0 ? (
                <div className="empty">{q ? `No notes found for "${q}"` : 'No meeting notes'}</div>
              ) : (
                groups.map(([day, ms]) => (
                  <div key={day} className="nt-day">
                    <div className="caps nt-day-label">{day}</div>
                    {ms.map((m) => (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        className={`nt-row ${sel === m.id ? 'selected' : ''}`}
                        onClick={() => setSel(m.id)}
                        onDoubleClick={() => setOpen(m.id)}
                        onKeyDown={(e) => e.key === 'Enter' && setOpen(m.id)}
                      >
                        <span className="nt-icon">
                          <FileText size={18} strokeWidth={1.6} />
                        </span>
                        <div className="nt-row-text">
                          <span className="nt-row-title">{m.title}</span>
                          <span className="nt-row-meta">{time(m.ts)}</span>
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
        {answer && (
          <div className="ask-answer">
            <button className="icon-btn" style={{ float: 'right' }} aria-label="Close answer" onClick={() => setAnswer(null)}>
              <X size={16} />
            </button>
            <div className="caps muted">You asked</div>
            <p style={{ marginBottom: 8 }}>{answer.q}</p>
            {answer.hits.length ? (
              <>
                <p>
                  Found {answer.hits.length} related note{answer.hits.length > 1 ? 's' : ''}:
                </p>
                <ul>
                  {answer.hits.map((m) => (
                    <li key={m.id}>
                      <button className="link" onClick={() => (setSel(m.id), setAnswer(null))}>
                        {m.title}
                      </button>{' '}
                      <span className="muted">({dayKey(m.ts)})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">Nothing in your notes matches that yet.</p>
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
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about your meetings, or type / for Skills" aria-label="Ask" />
            {ask ? (
              <button className="ask-send" aria-label="Ask">
                <ArrowUp size={16} />
              </button>
            ) : (
              <button type="button" className="ask-pill" onClick={() => toast('No past chats yet')}>
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
                {weekday(current.ts)} • {time(current.ts)}
              </span>
              <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', marginTop: 12 }} onClick={() => setOpen(current.id)}>
                Open note
              </button>
            </div>
            <div className="nt-panel-body">
              <div className="caps muted">Overview</div>
              <p>{current.overview}</p>
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
  const [thoughts, setThoughts] = useState(() => localStorage.getItem(`roy-flow-thoughts-${m.id}`) ?? '');
  const i = list.findIndex((x) => x.id === m.id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
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
      <h2 className="nt-l2-title">{m.title}</h2>
      <div className="muted" style={{ padding: '0 8px 12px' }}>
        {dayKey(m.ts)} · {time(m.ts)} · {m.minutes} min · {m.people} people
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
            <p>{m.overview}</p>
            <div className="caps muted" style={{ marginTop: 16 }}>
              Action items
            </div>
            <ul>
              <li>Share the notes with everyone who attended</li>
              <li>Follow up on open questions before the next sync</li>
            </ul>
          </div>
        )}
        {tab === 'transcript' && (
          <div className="nt-l2-body">
            <p>
              <b>Speaker 1</b> <span className="muted">0:00</span>
            </p>
            <p>Thanks everyone for joining. Let's start with a quick round of updates.</p>
            <p style={{ marginTop: 12 }}>
              <b>Speaker 2</b> <span className="muted">0:14</span>
            </p>
            <p>{m.overview}</p>
          </div>
        )}
        {tab === 'thoughts' && (
          <textarea
            className="nt-thoughts"
            placeholder="Write your own notes..."
            value={thoughts}
            onChange={(e) => {
              setThoughts(e.target.value);
              localStorage.setItem(`roy-flow-thoughts-${m.id}`, e.target.value);
            }}
          />
        )}
      </div>
    </main>
  );
}
