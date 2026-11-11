/* The meeting note, laid out like Wispr Flow's Notetaker (1.6): a serif title, Today / folder chips, the
   My thoughts · Transcript · ✦ Summary tabs, transcript bubbles with a language banner, the "N MIN READ"
   summary, and Resume + Ask at the bottom. LiveNoteApp is the same note in the narrow always-on-top panel
   that is open while Notetaker records. */
import { matchSkills } from '../shared/skills';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  Languages,
  Lightbulb,
  Link,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { setState, toast, uid, useStore, type Meeting } from '../store';
import { openSettings } from '../nav';
import { native } from '../native/bridge';
import type { MeetingStatus } from '../shared/ipc';
import type { TranscriptSegment } from '../shared/types';

export const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const wallTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
const isEnglish = (l?: string) => !l || /^(english|en)$/i.test(l);
const langName = (l?: string) => (l ? l[0].toUpperCase() + l.slice(1) : '');
const dayChip = (ts: number) => {
  const d = new Date(ts);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function transcriptText(segs: TranscriptSegment[], english = false) {
  return segs.map((s) => `[${clock(s.t)}] ${english && s.tr ? s.tr : s.text}`).join('\n');
}

/** the note as Markdown (Share / copy link) */
export function noteMarkdown(m: Meeting) {
  const out = [`# ${m.title}`, '', `${new Date(m.ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · ${m.minutes} min`, ''];
  if (m.overview) out.push(m.overview, '');
  for (const s of m.sections ?? []) {
    out.push(`## ${s.heading}`);
    for (const b of s.bullets) {
      out.push(`- ${b.text}`);
      for (const x of b.sub ?? []) out.push(`  - ${x}`);
    }
    out.push('');
  }
  if (m.actionItems?.length) out.push('## Action items', ...m.actionItems.map((a) => `- [ ] ${a}`), '');
  if (m.thoughts?.trim()) out.push('## My thoughts', m.thoughts.trim(), '');
  if (m.transcript?.length) out.push('## Transcript', transcriptText(m.transcript, !!m.translated));
  return out.join('\n');
}

const copy = async (text: string, what = 'Copied') => {
  await navigator.clipboard.writeText(text);
  toast(what);
};

/* ------------------------------------------------------------------ transcript */
export function TranscriptCard({
  segs,
  duration,
  live,
  pending = 0,
  partial,
  language,
  translated,
  onTranslate,
  startedAt,
  interim = [],
}: {
  segs: TranscriptSegment[];
  duration: number;
  live?: boolean;
  pending?: number;
  partial?: string;
  language?: string;
  translated?: boolean;
  onTranslate?: (on: boolean) => void;
  startedAt?: number;
  /** words being said now / waiting for Whisper (greyed) */
  interim?: { who: 'you' | 'them'; text: string; t: number }[];
}) {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [hint, setHint] = useState(() => localStorage.getItem('rf.nt.tidyHint') !== 'off');
  const [langOff, setLangOff] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (q ? segs.filter((s) => (s.text + ' ' + (s.tr ?? '')).toLowerCase().includes(q.toLowerCase())) : segs), [segs, q]);

  useEffect(() => {
    if (atBottom && live) body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [segs.length, pending, partial, interim, atBottom, live]);

  const foreign = !!language && !isEnglish(language);
  let banner: React.ReactNode = null;
  if (foreign && translated)
    banner = (
      <div className="tc-banner lang">
        <span>Showing English translation</span>
        <button className="link" onClick={() => onTranslate?.(false)}>
          Show original
        </button>
      </div>
    );
  else if (foreign && !langOff)
    banner = (
      <div className="tc-banner lang">
        <span>{langName(language)} detected</span>
        <span style={{ flex: 1 }} />
        {onTranslate && (
          <button className="link strong" onClick={() => onTranslate(true)}>
            Translate to English
          </button>
        )}
        <button className="icon-btn xs" aria-label="Dismiss" onClick={() => setLangOff(true)}>
          <X size={14} />
        </button>
      </div>
    );
  else if (hint && live)
    banner = (
      <div className="tc-banner">
        <span>After the meeting, Roy Flow will tidy the transcript and write your notes</span>
        <button
          className="icon-btn xs"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem('rf.nt.tidyHint', 'off');
            setHint(false);
          }}
        >
          <X size={14} />
        </button>
      </div>
    );

  // a "You" / "Them" label (with the time) above each run of speech: a new run when the speaker changes or after a 20 s gap
  const rows: React.ReactNode[] = [];
  const whoOf = (w?: string) => (w === 'them' ? 'them' : 'you');
  const label = (w: string) => (w === 'them' ? 'Them' : 'You');
  let lastWho = '';
  let lastT = -1e9;
  shown.forEach((s, i) => {
    const w = whoOf(s.who);
    // imported transcripts carry speaker names; recorded ones are You / Them
    const key = s.speaker ?? w;
    if (key !== lastWho || s.t - lastT > 20) {
      const at = s.at ?? (startedAt ? startedAt + s.t * 1000 : undefined);
      rows.push(
        <div key={`h${i}`} className={`tc-who ${w}`}>
          {s.speaker ?? label(w)} {!live && at ? <span>{wallTime(at)}</span> : null}
        </div>,
      );
    }
    lastWho = key;
    lastT = s.t;
    rows.push(
      <div key={i} className={`tc-bubble ${w}`} title={clock(s.t)}>
        {translated && s.tr ? s.tr : s.text}
      </div>,
    );
  });
  // live words: greyed until Whisper's text replaces them
  [...interim].sort((a, b) => a.t - b.t).forEach((x, i) => {
    if (x.who !== lastWho) rows.push(<div key={`ih${i}`} className={`tc-who ${x.who}`}>{label(x.who)}</div>);
    lastWho = x.who;
    rows.push(
      <div key={`i${i}`} className={`tc-bubble interim ${x.who}`}>
        {x.text || (
          <span className="tc-dots" aria-label="Transcribing">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>,
    );
  });

  return (
    <div className="tc-card">
      <div className="tc-head">
        <Clock size={15} />
        <span className="tc-time">{clock(duration)}</span>
        <span style={{ flex: 1 }} />
        {searching ? (
          <input autoFocus className="tc-search" placeholder="Search transcript" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} />
        ) : (
          <button className="icon-btn xs" data-tip="Search" aria-label="Search transcript" onClick={() => setSearching(true)}>
            <Search size={15} />
          </button>
        )}
        {foreign && onTranslate && (
          <button className={`icon-btn xs ${translated ? 'on' : ''}`} data-tip={translated ? 'Show original' : 'Translate to English'} aria-label="Translate" onClick={() => onTranslate(!translated)}>
            <Languages size={15} />
          </button>
        )}
        <button className="icon-btn xs" data-tip="Copy transcript" aria-label="Copy transcript" disabled={!segs.length} onClick={() => copy(transcriptText(segs, translated), 'Transcript copied')}>
          <Copy size={15} />
        </button>
      </div>
      {banner}
      <div
        className="tc-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {rows}
        {!interim.length && (pending > 0 || partial) && (
          <>
            {!shown.length && <div className="tc-who">You</div>}
            <div className="tc-bubble interim">{partial || <span className="tc-dots" aria-label="Transcribing">
                <i />
                <i />
                <i />
              </span>}</div>
          </>
        )}
        {!shown.length && !pending && !partial && !interim.length && <div className="tc-empty">{q ? 'No matches.' : live ? 'Listening…' : 'No transcript was recorded.'}</div>}
      </div>
      {!atBottom && (
        <button className="tc-down" aria-label="Scroll to the latest" onClick={() => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' })}>
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ summary */
function readMinutes(m: Meeting) {
  const words = [m.overview, ...(m.sections ?? []).flatMap((s) => [s.heading, ...s.bullets.flatMap((b) => [b.text, ...(b.sub ?? [])])]), ...(m.actionItems ?? [])].join(' ').split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

export function SummaryCard({ m, onGenerate }: { m: Meeting; onGenerate: () => void }) {
  if (m.summaryStatus === 'pending')
    return (
      <div className="sm-progress">
        <b>{m.step === 1 ? 'Finishing the transcript…' : 'Writing your notes…'}</b>
        <span>Step {m.step === 1 ? 1 : 2} of 2</span>
        <i className="sm-bar" />
      </div>
    );
  if (m.summaryStatus === 'nokey')
    return (
      <div className="sm-empty">
        <p>
          Summaries are written by Claude. Add your Anthropic API key in{' '}
          <button className="link" onClick={() => openSettings('account')}>
            Settings › Account
          </button>
          , then generate the summary.
        </p>
      </div>
    );
  if (m.summaryStatus === 'error')
    return (
      <div className="sm-empty">
        <p style={{ color: 'var(--destructive)' }}>{m.summaryError ?? 'The summary failed.'}</p>
        <button className="btn btn-outline btn-sm" onClick={onGenerate}>
          Try again
        </button>
      </div>
    );
  const has = !!(m.overview || m.sections?.length || m.actionItems?.length);
  if (!has) return <div className="sm-empty">{m.transcript?.length ? <p>No summary yet.</p> : <p>Nothing was transcribed in this recording, so there is nothing to summarise.</p>}</div>;
  const nextSteps = !!m.actionItems?.length && !(m.sections ?? []).some((s) => /next steps|action/i.test(s.heading));
  return (
    <div className="sm">
      <div className="sm-head">
        <Lightbulb size={15} />
        <span>{readMinutes(m)} MIN READ</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn xs" data-tip="Copy notes" aria-label="Copy notes" onClick={() => copy(noteMarkdown({ ...m, transcript: [] }), 'Notes copied')}>
          <Copy size={15} />
        </button>
      </div>
      {m.overview && <p className="sm-tldr">{m.overview}</p>}
      {(m.sections ?? []).map((s, i) => (
        <section key={i}>
          <h4>{s.heading}</h4>
          <ul>
            {s.bullets.map((b, k) => (
              <li key={k}>
                {b.text}
                {!!b.sub?.length && (
                  <ul>
                    {b.sub.map((x, j) => (
                      <li key={j}>{x}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {nextSteps && (
        <section>
          <h4>Action items</h4>
          <ul className="sm-todo">
            {m.actionItems!.map((a, k) => (
              <li key={k}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="sm-rate">
        <button className={`icon-btn xs ${m.rating === 'up' ? 'on' : ''}`} aria-label="Good summary" onClick={() => patchMeeting(m.id, { rating: m.rating === 'up' ? undefined : 'up' })}>
          <ThumbsUp size={15} />
        </button>
        <button className={`icon-btn xs ${m.rating === 'down' ? 'on' : ''}`} aria-label="Bad summary" onClick={() => patchMeeting(m.id, { rating: m.rating === 'down' ? undefined : 'down' })}>
          <ThumbsDown size={15} />
        </button>
      </div>
    </div>
  );
}

const patchMeeting = (id: string, p: Partial<Meeting>) => setState((s) => ({ meetings: s.meetings.map((x) => (x.id === id ? { ...x, ...p } : x)) }));

/** ask Claude about one note (streamed through ai:ask) */
function useAsk(context: () => string) {
  const [answer, setAnswer] = useState<{ q: string; text: string; busy: boolean } | null>(null);
  const ask = async (q: string, label = q) => {
    if (!native) return toast('Ask runs in the desktop app', { tone: 'error' });
    const id = uid();
    setAnswer({ q: label, text: '', busy: true });
    let text = '';
    const off = native.on('ai:chunk', ({ id: rid, delta }) => {
      if (rid !== id) return;
      text += delta;
      setAnswer({ q: label, text, busy: true });
    });
    const r = await native.invoke('ai:ask', { id, messages: [{ role: 'user', content: `${context()}\n\n${q}` }] });
    off();
    if (!r.ok && !text) setAnswer({ q: label, text: r.error ?? 'Claude could not answer.', busy: false });
    else setAnswer({ q: label, text, busy: false });
  };
  return { answer, ask, clear: () => setAnswer(null) };
}

function AnswerCard({ a, onClose }: { a: { q: string; text: string; busy: boolean }; onClose: () => void }) {
  return (
    <div className="nn-answer">
      <div className="nn-answer-q">
        <span>{a.q}</span>
        <button className="icon-btn xs" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="nn-answer-a">{a.text || (a.busy ? <span className="muted">Thinking…</span> : null)}</div>
    </div>
  );
}

type Tab = 'thoughts' | 'transcript' | 'summary';
function NoteTabs({ tab, setTab, live }: { tab: Tab; setTab: (t: Tab) => void; live?: boolean }) {
  return (
    <div className="nn-tabs" role="tablist">
      <button role="tab" className={tab === 'thoughts' ? 'active' : ''} onClick={() => setTab('thoughts')}>
        My thoughts
      </button>
      <button role="tab" className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>
        {live && (
          <span className="nn-live" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
        Transcript
      </button>
      <button role="tab" className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
        <Sparkles size={13} /> Summary
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ the saved note (hub) */
/** Settings › Account switches (default on) */
function useAiOn() {
  const s = useStore((x) => x.settings);
  return { translate: s.aiUseTranslate !== false, ask: s.aiUseAsk !== false };
}

export function MeetingDetail({ m, onBack, list, setOpen, onDelete, recording }: { m: Meeting; onBack: () => void; list: Meeting[]; setOpen: (id: string) => void; onDelete: () => void; recording: boolean }) {
  const [tab, setTab] = useState<Tab>(m.summaryStatus === 'done' && !m.overview && !m.sections?.length ? 'transcript' : 'summary');
  const [thoughts, setThoughts] = useState(m.thoughts ?? '');
  const [folder, setFolder] = useState(m.folder ?? '');
  const [editFolder, setEditFolder] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [ready, setReady] = useState(false);
  const prevStatus = useRef(m.summaryStatus);
  const i = list.findIndex((x) => x.id === m.id);
  const { answer, ask, clear } = useAsk(() => `Answer about this meeting note only.\n\n${noteMarkdown(m)}`);

  useEffect(() => {
    setThoughts(m.thoughts ?? '');
    setFolder(m.folder ?? '');
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);
  // "Your notes are ready" when the summary lands while the note is open
  useEffect(() => {
    if (prevStatus.current === 'pending' && m.summaryStatus === 'done' && (m.overview || m.sections?.length)) {
      setTab('summary');
      setReady(true);
      const t = window.setTimeout(() => setReady(false), 6000);
      prevStatus.current = m.summaryStatus;
      return () => window.clearTimeout(t);
    }
    prevStatus.current = m.summaryStatus;
  }, [m.summaryStatus, m.overview, m.sections]);
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

  const generate = async () => {
    if (!native) return;
    setTab('summary');
    const r = await native.invoke('meeting:summarize', { id: m.id });
    if (!r.ok) toast(r.error ?? 'Could not summarise', { tone: 'error' });
  };
  const translate = async (on: boolean) => {
    if (!native) return;
    const r = await native.invoke('meeting:translate', { on, id: m.id });
    if (!r.ok) toast(r.error ?? 'Could not translate', { tone: 'error' });
  };
  const resume = async () => {
    if (!native) return;
    const r = await native.invoke('meeting:start', { resumeId: m.id });
    if (!r.ok) toast(r.error ?? 'Could not resume', { tone: 'error' });
  };
  const on = useAiOn();
  const hasSummary = !!(m.overview || m.sections?.length);
  const showGenerate = !hasSummary && !!m.transcript?.length && m.summaryStatus !== 'pending';

  return (
    <main className="page nn-page">
      <div className="nn-top">
        <button className="icon-btn nn-round" data-tip="Back (Esc)" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ flex: 1 }} />
        <div className="nn-menu-wrap">
          <button className="icon-btn" aria-label="More" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="nn-menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => (setMenu(false), copy(noteMarkdown(m), 'Note copied as Markdown'))}>
                <Copy size={14} /> Copy as Markdown
              </button>
              {!!m.transcript?.length && (
                <button onClick={() => (setMenu(false), generate())}>
                  <Sparkles size={14} /> {hasSummary ? 'Regenerate summary' : 'Generate summary'}
                </button>
              )}
              <button className="danger" onClick={() => (setMenu(false), onDelete())}>
                <Trash2 size={14} /> Delete note
              </button>
            </div>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => copy(noteMarkdown(m), 'Note copied — paste it anywhere to share')}>
          Share
        </button>
        <button className="icon-btn" data-tip="Copy link" aria-label="Copy link" onClick={() => copy(`royflow://open/notetaker?meeting=${m.id}`, 'Link copied')}>
          <Link size={16} />
        </button>
        <button className="icon-btn" data-tip="Newer (J)" aria-label="Newer note" disabled={!list[i - 1]} onClick={() => list[i - 1] && setOpen(list[i - 1].id)}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn" data-tip="Older (K)" aria-label="Older note" disabled={!list[i + 1]} onClick={() => list[i + 1] && setOpen(list[i + 1].id)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="nn-doc">
        <input className="nn-title" value={m.title} onChange={(e) => patchMeeting(m.id, { title: e.target.value })} aria-label="Note title" />
        <div className="nn-chips">
          <span className="nn-chip" title={new Date(m.ts).toLocaleString()}>
            {dayChip(m.ts)}
          </span>
          {editFolder ? (
            <input
              autoFocus
              className="nn-chip nn-chip-input"
              placeholder="Folder name"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onBlur={() => (patchMeeting(m.id, { folder: folder.trim() || undefined }), setEditFolder(false))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className="nn-chip" onClick={() => setEditFolder(true)}>
              <Folder size={13} /> {m.folder || 'Add folder'}
            </button>
          )}
        </div>
        <NoteTabs tab={tab} setTab={setTab} />
        <div className="nn-body">
          {tab === 'thoughts' && (
            <textarea
              className="nn-thoughts"
              placeholder="Write your notes here. Roy Flow adds them to the summary."
              value={thoughts}
              onChange={(e) => {
                setThoughts(e.target.value);
                patchMeeting(m.id, { thoughts: e.target.value });
              }}
            />
          )}
          {tab === 'transcript' && (
            <TranscriptCard segs={m.transcript ?? []} duration={m.durationSec ?? m.minutes * 60} language={m.language} translated={m.translated} onTranslate={on.translate ? translate : undefined} startedAt={m.ts} />
          )}
          {tab === 'summary' && <SummaryCard m={m} onGenerate={generate} />}
        </div>
      </div>
      <div className="nn-foot">
        {ready && (
          <div className="nn-ready">
            <span className="nn-ready-bar">
              <Check size={15} /> Your notes are ready
            </span>
            <span className="nn-ready-pill">🎉 That was {m.minutes} min. Here's the short version.</span>
          </div>
        )}
        {showGenerate && !ready && (
          <button className="nn-generate" onClick={generate}>
            <Plus size={15} /> Generate summary
          </button>
        )}
        {answer && <AnswerCard a={answer} onClose={clear} />}
        <div className="nn-bar">
          <button className="nn-resume" onClick={resume} disabled={recording} data-tip={recording ? 'Notetaker is already recording' : 'Keep recording into this note'}>
            <span className="nn-resume-dot" /> Resume
          </button>
          <form
            className="nn-ask"
            onSubmit={(e) => {
              e.preventDefault();
              const skill = matchSkills(q)[0];
              if (skill) void ask(skill.prompt, skill.label);
              else if (q.trim()) void ask(q.trim());
              setQ('');
            }}
          >
            {matchSkills(q).length > 0 && (
              <div className="nn-skills" role="listbox" aria-label="Skills">
                {matchSkills(q).map((sk) => (
                  <button
                    type="button"
                    key={sk.id}
                    className="nn-skill"
                    onClick={() => {
                      void ask(sk.prompt, sk.label);
                      setQ('');
                    }}
                  >
                    <b>/{sk.label}</b>
                    <span>{sk.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={on.ask ? 'Ask anything, or type / for skills' : 'Questions are turned off in Settings › Account'} disabled={!on.ask} aria-label="Ask about this note" />
            {q && (
              <button className="ask-send" aria-label="Ask">
                <ArrowUp size={15} />
              </button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ the live panel window */
const EMPTY: MeetingStatus = { recording: false, startedAt: 0, title: '', partial: '', segments: [] };

export function LiveNoteApp() {
  const theme = useStore((s) => s.theme);
  const [st, setSt] = useState<MeetingStatus>(EMPTY);
  const [tab, setTab] = useState<Tab>('transcript');
  const [, tick] = useState(0);
  const [thoughts, setThoughts] = useState('');
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ q: string; text: string; busy: boolean } | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!native) return;
    const off = native.on('meeting:status', (s) => {
      setSt(s);
      if (!loaded.current && s.id) {
        loaded.current = true;
        setThoughts(s.thoughts ?? '');
        setTitle(s.title);
      }
    });
    void native.invoke('meeting:live', { show: true });
    return off;
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const on = useAiOn();
  const finishing = st.stage === 'finishing';
  const elapsed = (st.offset ?? 0) + (st.startedAt ? Math.floor((Date.now() - st.startedAt) / 1000) : 0);
  const sendThoughts = (p: { text?: string; title?: string }) => native?.invoke('meeting:thoughts', p);
  const catchUp = async (question?: string) => {
    if (!native) return;
    const label = question || 'What did I miss?';
    setAnswer({ q: label, text: '', busy: true });
    const r = await native.invoke('meeting:catchup', { question });
    setAnswer({ q: label, text: r.ok ? (r.text ?? '') : (r.error ?? 'Claude could not answer.'), busy: false });
  };
  const translate = async (on: boolean) => {
    const r = await native?.invoke('meeting:translate', { on });
    if (r && !r.ok) toast(r.error ?? 'Could not translate', { tone: 'error' });
  };

  return (
    <div className="ln-window">
      <div className="ln-top">
        <span style={{ flex: 1 }} />
        {st.id && (
          <button className="icon-btn" data-tip="Open in Roy Flow" aria-label="Open in Roy Flow" onClick={() => st.id && native?.invoke('meeting:open', { id: st.id })}>
            <ArrowUpRight size={17} />
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => copy(transcriptText(st.segments, st.translate), 'Transcript copied — paste it anywhere to share')}>
          Share
        </button>
      </div>
      <div className="ln-doc">
        <input
          className="nn-title ln-title"
          value={title}
          placeholder="New note"
          onChange={(e) => {
            setTitle(e.target.value);
            void sendThoughts({ title: e.target.value });
          }}
          aria-label="Note title"
        />
        <div className="nn-chips">
          <span className="nn-chip">Today</span>
          {st.engine === 'apple' && <span className="nn-chip muted">Apple Speech</span>}
          {st.systemAudio === 'on' && <span className="nn-chip" title="Your mic is You; your Mac's sound (the call) is Them">You + Them</span>}
          {st.systemAudio === 'error' && (
            <span className="nn-chip muted" title="Roy Flow can't hear your Mac's sound, so only your mic is transcribed. Allow audio capture for Roy Flow in System Settings › Privacy & Security.">
              Mic only
            </span>
          )}
        </div>
        <NoteTabs tab={tab} setTab={setTab} live={st.recording} />
        <div className="nn-body">
          {tab === 'thoughts' && (
            <textarea
              className="nn-thoughts"
              placeholder="Write your notes here. Roy Flow adds them to the summary at the end."
              value={thoughts}
              onChange={(e) => {
                setThoughts(e.target.value);
                void sendThoughts({ text: e.target.value });
              }}
            />
          )}
          {tab === 'transcript' && (
            <TranscriptCard
              live
              segs={st.segments}
              duration={elapsed}
              pending={st.pending}
              partial={st.partial}
              language={st.language}
              translated={st.translate}
              onTranslate={on.translate ? translate : undefined}
              startedAt={st.startedAt}
              interim={st.interim}
            />
          )}
          {tab === 'summary' && (
            <div className="sm-empty">
              <p>Your summary appears here when you stop Notetaker.</p>
            </div>
          )}
        </div>
      </div>
      <div className="ln-foot">
        {answer && <AnswerCard a={answer} onClose={() => setAnswer(null)} />}
        {st.error && <p className="ln-error">{st.error}</p>}
        <p className="ln-consent">Always get consent when transcribing others.</p>
        <div className="nn-bar">
          {finishing ? (
            <span className="nn-resume">
              <Loader2 size={15} className="spin" /> Finishing up…
            </span>
          ) : (
            <button className="nn-resume ln-stop" onClick={() => native?.invoke('meeting:stop')} disabled={!st.recording}>
              <span className="ln-stop-sq" /> Stop
            </button>
          )}
          <form
            className="nn-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) void catchUp(q.trim());
              setQ('');
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={on.ask ? 'Ask anything' : 'Questions are off'} disabled={!on.ask} aria-label="Ask about this meeting" />
            {q ? (
              <button className="ask-send" aria-label="Ask">
                <ArrowUp size={15} />
              </button>
            ) : (
              <button type="button" className="ask-pill" onClick={() => catchUp()} disabled={!st.segments.length || !on.ask}>
                What did I miss?
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
