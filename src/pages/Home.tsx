import { useMemo, useState } from 'react';
import { Copy, EllipsisVertical, FileAudio, Flag, Pause, Play, Redo2, RotateCw, Search, Trash2, Undo2, X } from 'lucide-react';
import { applyDictionaryAndSnippets, cleanUp, setState, toast, useStore, type HistoryItem } from '../store';
import { go, setNav } from '../nav';
import { Confirm, Dialog, Hero, MenuButton, PageFrame } from '../components/ui';

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();

export function dayLabel(ts: number) {
  const d = new Date(ts);
  const t = new Date();
  const y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);
}

export default function Home() {
  const user = useStore((s) => s.user);
  const history = useStore((s) => s.history);
  const totals = useStore((s) => s.totals);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const items = [...history]
      .sort((a, b) => b.ts - a.ts)
      .filter((h) => !q || h.text.toLowerCase().includes(q.toLowerCase()));
    const m = new Map<string, HistoryItem[]>();
    for (const h of items) {
      const k = dayLabel(h.ts);
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [history, q]);

  const flat = groups.flatMap(([, items]) => items);
  const onKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex((h) => h.id === selected);
    if (e.key === 'ArrowDown' || e.key === 'j') setSelected(flat[Math.min(flat.length - 1, i + 1)]?.id ?? null);
    else if (e.key === 'ArrowUp' || e.key === 'k') setSelected(flat[Math.max(0, i - 1)]?.id ?? null);
    else if (e.key === 'Escape') setSelected(null);
    else if (e.key === 'Enter' && selected) copyText(flat[i].text);
    else return;
    e.preventDefault();
  };

  return (
    <PageFrame title={`Welcome back, ${user.firstName}`} maxWidth={1046}>
      <div className="home-columns">
        <div className="home-primary">
          <Hero
            palette="cinema"
            title={
              <>
                Make Roy Flow sound like <em>you</em>
              </>
            }
            desc="Give each app its own writing style, from relaxed chats to tidy emails."
            cta={
              <span className="coach">
                <button className="btn btn-lumen" onClick={() => go('style')}>
                  Start now
                </button>
                <span className="coach-dot" aria-hidden />
              </span>
            }
            style={{ minHeight: 183, justifyContent: 'center' }}
          />
          <section className="history" tabIndex={0} onKeyDown={onKey} aria-label="Dictation history">
            {groups.length === 0 && (
              <>
                <div className="history-header">
                  <span className="caps">Today</span>
                  <SearchBox q={q} setQ={setQ} searching={searching} setSearching={setSearching} />
                </div>
                <div className="empty-card">
                  <div className="empty-title">{q ? `No transcripts found for "${q}"` : 'No dictations yet'}</div>
                  {!q && <p className="muted">Click the Flow Bar at the bottom of the window and start talking.</p>}
                </div>
              </>
            )}
            {groups.map(([label, items], gi) => (
              <div key={label}>
                <div className="history-header">
                  <span className="caps">{label}</span>
                  {gi === 0 && <SearchBox q={q} setQ={setQ} searching={searching} setSearching={setSearching} />}
                </div>
                <div className="history-section">
                  {items.map((h) => (
                    <HistoryRow key={h.id} h={h} selected={selected === h.id} onSelect={() => setSelected(h.id)} />
                  ))}
                </div>
              </div>
            ))}
            <div style={{ height: 120 }} />
          </section>
        </div>
        <aside className="home-aside">
          <button className="stats-card" onClick={() => (setNav({ insightsTab: 'usage' }), go('insights'))}>
            <div className="stat">
              <span className="stat-value">{compact(totals.words)}</span>
              <span className="stat-label">total words</span>
            </div>
            <div className="stat">
              <span className="stat-value">{totals.wpm}</span>
              <span className="stat-label">wpm</span>
            </div>
            <div className="stat">
              <span className="stat-value">{totals.streak}</span>
              <span className="stat-label">day streak</span>
            </div>
          </button>
        </aside>
      </div>
    </PageFrame>
  );
}

function SearchBox({ q, setQ, searching, setSearching }: { q: string; setQ: (v: string) => void; searching: boolean; setSearching: (v: boolean) => void }) {
  if (!searching)
    return (
      <button className="icon-btn" aria-label="Search past transcripts" onClick={() => setSearching(true)}>
        <Search size={18} className="muted" />
      </button>
    );
  return (
    <div className="search-field" style={{ textTransform: 'none', letterSpacing: 0 }}>
      <Search size={14} className="muted" />
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search past transcripts" />
      <button aria-label="Clear" onClick={() => (setQ(''), setSearching(false))}>
        <X size={14} className="muted" />
      </button>
    </div>
  );
}

function copyText(t: string) {
  navigator.clipboard?.writeText(t).then(
    () => toast('Transcript copied'),
    () => toast("Couldn't copy transcript. Try again.", { tone: 'error' }),
  );
}

function HistoryRow({ h, selected, onSelect }: { h: HistoryItem; selected: boolean; onSelect: () => void }) {
  const [dialog, setDialog] = useState<null | 'delete' | 'report'>(null);
  const [playing, setPlaying] = useState(false);
  const update = (patch: Partial<HistoryItem>) => setState((s) => ({ history: s.history.map((x) => (x.id === h.id ? { ...x, ...patch } : x)) }));

  if (h.status === 'dismissed')
    return (
      <div className={`row hrow ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="h-time">{fmtTime(h.ts)}</div>
        <div className="h-text muted">
          This transcription was dismissed.{' '}
          <button className="link" onClick={() => (update({ status: 'ok' }), toast('Transcript recovered'))}>
            Recover
          </button>
        </div>
      </div>
    );

  const play = () => {
    const synth = window.speechSynthesis;
    if (!synth) return toast('Audio playback is unavailable in this browser', { tone: 'error' });
    if (playing) {
      synth.cancel();
      setPlaying(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(h.text);
    u.onend = () => setPlaying(false);
    setPlaying(true);
    synth.speak(u);
  };

  const aiEdited = h.original !== undefined;
  const undone = aiEdited && h.text === h.original;

  return (
    <div className={`row hrow ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="h-time">{fmtTime(h.ts)}</div>
      <div className="h-text">{h.text}</div>
      <div className="row-actions">
        <button className="icon-btn lg" data-tip={playing ? 'Pause audio' : 'Play audio'} aria-label="Play audio" onClick={play}>
          {playing ? <Pause size={20} strokeWidth={1.8} /> : <Play size={20} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn lg" data-tip="Copy transcript" aria-label="Copy transcript" onClick={() => copyText(h.text)}>
          <Copy size={20} strokeWidth={1.8} />
        </button>
        <button className={`icon-btn lg ${h.flagged ? 'active' : ''}`} data-tip="Send feedback" aria-label="Send feedback" onClick={() => setDialog('report')}>
          <Flag size={20} strokeWidth={1.8} />
        </button>
        <MenuButton
          large
          className="icon-btn lg"
          tip="More options"
          trigger={<EllipsisVertical size={20} strokeWidth={1.8} />}
          items={[
            {
              label: undone ? 'Redo AI edit' : 'Undo AI edit',
              icon: undone ? <Redo2 size={18} /> : <Undo2 size={18} />,
              run: () => {
                if (!aiEdited) {
                  update({ original: h.text, text: h.text });
                  return toast('No AI edit to undo on this transcript');
                }
                update({ text: undone ? cleanUp(applyDictionaryAndSnippets(h.original!)) : h.original! });
              },
            },
            {
              label: 'Retry transcript',
              icon: <RotateCw size={18} />,
              run: () => {
                update({ text: cleanUp(applyDictionaryAndSnippets(h.original ?? h.text)) });
                toast('Transcript retried');
              },
            },
            { label: 'Delete transcript', icon: <Trash2 size={18} />, danger: true, run: () => setDialog('delete') },
            {
              label: 'Extract audio',
              icon: <FileAudio size={18} />,
              run: () => {
                const blob = new Blob([h.text], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `transcript-${h.id}.txt`;
                a.click();
                toast('Audio is not stored locally, so the transcript was saved instead');
              },
            },
          ]}
        />
      </div>
      {dialog === 'delete' && (
        <Confirm
          title="Are you sure you want to delete this transcript?"
          subtitle="Once deleted it cannot be recovered"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setState((s) => ({ history: s.history.filter((x) => x.id !== h.id) }));
            toast('Transcript deleted');
          }}
        />
      )}
      {dialog === 'report' && <ReportDialog onClose={() => setDialog(null)} onSend={() => update({ flagged: true })} />}
    </div>
  );
}

function ReportDialog({ onClose, onSend }: { onClose: () => void; onSend: () => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      title="Report to improve the model"
      subtitle="Thanks for flagging this. Tell us what you expected so the transcript can get better."
      onClose={onClose}
      actions={
        <button
          className="btn btn-primary"
          onClick={() => {
            onSend();
            onClose();
            toast('Report saved locally');
          }}
        >
          Send feedback
        </button>
      }
    >
      <textarea className="field" style={{ width: 460 }} placeholder="Describe what you expected instead" value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}
