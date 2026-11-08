import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, EllipsisVertical, FileAudio, Flag, Pause, Pencil, Play, Redo2, RotateCw, Search, Trash2, Undo2, X } from 'lucide-react';
import { applyDictionaryAndSnippets, cleanUp, getState, setState, toast, uid, useStats, useStore, type HistoryItem } from '../store';
import { correctedWords, wordCount } from '../shared/textPipeline';
import { native } from '../native/bridge';
import { useShortcutLabel } from '../settings/ShortcutsEditor';
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
  const totals = useStats();
  const ptt = useShortcutLabel('ptt');
  const hands = useShortcutLabel('handsfree');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const items = [...history]
      .sort((a, b) => b.ts - a.ts)
      .filter((h) => !q || (q.toLowerCase() === 'flagged' ? !!h.flagged : `${h.text} ${h.flagNote ?? ''}`.toLowerCase().includes(q.toLowerCase())));
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
    <PageFrame title={user.firstName ? `Welcome back, ${user.firstName}` : 'Welcome back'} maxWidth={1046}>
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
                  {!q && (
                    <p className="muted">
                      {ptt ? `Hold ${ptt} and speak in any app` : 'Click the Flow Bar at the bottom of the screen and start talking'}
                      {hands ? `, or press ${hands} for hands-free` : ''}. Your dictations show up here.
                    </p>
                  )}
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

let currentAudio: HTMLAudioElement | null = null;

function HistoryRow({ h, selected, onSelect }: { h: HistoryItem; selected: boolean; onSelect: () => void }) {
  const [dialog, setDialog] = useState<null | 'delete' | 'report'>(null);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(h.text);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const update = (patch: Partial<HistoryItem>) => setState((s) => ({ history: s.history.map((x) => (x.id === h.id ? { ...x, ...patch } : x)) }));
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

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

  const play = async () => {
    if (playing) {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      setPlaying(false);
      return;
    }
    if (native) {
      if (!h.audio) return toast('No audio was kept for this dictation', { tone: 'error' });
      const bytes = await native.invoke('audio:get', { file: h.audio });
      if (!bytes) return toast('The audio for this dictation was removed to save space', { tone: 'error' });
      currentAudio?.pause();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
      const a = new Audio(url);
      audioRef.current = a;
      currentAudio = a;
      a.onended = a.onpause = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      setPlaying(true);
      a.play().catch(() => setPlaying(false));
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) return toast('Audio playback is unavailable in this browser', { tone: 'error' });
    synth.cancel();
    const u = new SpeechSynthesisUtterance(h.text);
    u.onend = () => setPlaying(false);
    setPlaying(true);
    synth.speak(u);
  };

  const hasRaw = h.original !== undefined && h.original !== (h.cleaned ?? h.text);
  const undone = h.original !== undefined && h.cleaned !== undefined && h.text === h.original;

  const saveEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === h.text) return;
    update({ text: next, cleaned: undefined, words: wordCount(next) });
    if (!getState().settings.autoAddDictionary) return toast('Transcript updated');
    const known = new Set(getState().dictionary.map((d) => d.word.toLowerCase()));
    const add = correctedWords(h.text, next).filter((w) => !known.has(w.word.toLowerCase()));
    if (!add.length) return toast('Transcript updated');
    setState((s) => ({ dictionary: [...add.map((w) => ({ id: uid(), word: w.word, misspelling: w.misspelling, scope: 'personal' as const, created: Date.now(), auto: true })), ...s.dictionary] }));
    toast(`Added ${add.map((w) => `“${w.word}”`).join(', ')} to your dictionary`);
  };

  const retry = async () => {
    if (native) {
      setBusy(true);
      const r = await native.invoke('ai:cleanup', { id: h.id });
      setBusy(false);
      if (!r.ok) return toast(r.error ?? 'Retry failed', { tone: 'error' });
      return toast(r.error ?? 'Transcript retried', r.error ? { tone: 'error' } : {});
    }
    update({ text: cleanUp(applyDictionaryAndSnippets(h.original ?? h.text)) });
    toast('Transcript retried');
  };

  return (
    <div className={`row hrow ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="h-time">{fmtTime(h.ts)}</div>
      {editing ? (
        <div className="h-text h-edit" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="field"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
              if (e.key === 'Escape') (setEditing(false), setDraft(h.text));
              e.stopPropagation();
            }}
          />
          <div className="row-gap" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => (setEditing(false), setDraft(h.text))}>
              Cancel
            </button>
            <span className="small muted">⌘↩ to save</span>
          </div>
        </div>
      ) : (
        <div className={`h-text ${busy ? 'muted' : ''}`} onDoubleClick={() => (setDraft(h.text), setEditing(true))}>
          {busy ? 'Retrying…' : h.text}
          {h.app && <span className="h-app small muted"> · {h.app}</span>}
        </div>
      )}
      <div className="row-actions">
        <button className="icon-btn lg" data-tip={playing ? 'Pause audio' : 'Play audio'} aria-label="Play audio" onClick={play}>
          {playing ? <Pause size={20} strokeWidth={1.8} /> : <Play size={20} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn lg" data-tip="Copy transcript" aria-label="Copy transcript" onClick={() => copyText(h.text)}>
          <Copy size={20} strokeWidth={1.8} />
        </button>
        <button className={`icon-btn lg ${h.flagged ? 'active' : ''}`} data-tip={h.flagged ? (h.flagNote ? `Flagged: ${h.flagNote.slice(0, 60)} (click to unflag)` : 'Flagged (click to unflag)') : 'Flag this transcript'} aria-label="Flag transcript" onClick={() => (h.flagged ? (update({ flagged: false, flagNote: undefined }), toast('Flag removed')) : setDialog('report'))}>
          <Flag size={20} strokeWidth={1.8} />
        </button>
        <MenuButton
          large
          className="icon-btn lg"
          tip="More options"
          trigger={<EllipsisVertical size={20} strokeWidth={1.8} />}
          items={[
            { label: 'Edit transcript', icon: <Pencil size={18} />, run: () => (setDraft(h.text), setEditing(true)) },
            {
              label: undone ? 'Redo AI edit' : 'Undo AI edit',
              icon: undone ? <Redo2 size={18} /> : <Undo2 size={18} />,
              run: () => {
                if (undone) return update({ text: h.cleaned!, cleaned: undefined });
                if (!hasRaw) return toast('No AI edit to undo on this transcript');
                update({ cleaned: h.text, text: h.original! });
              },
            },
            { label: 'Retry transcript', icon: <RotateCw size={18} />, run: () => void retry() },
            { label: 'Delete transcript', icon: <Trash2 size={18} />, danger: true, run: () => setDialog('delete') },
            {
              label: 'Extract audio',
              icon: <FileAudio size={18} />,
              run: async () => {
                if (!native) return toast('Audio is only kept by the desktop app', { tone: 'error' });
                if (!h.audio) return toast('No audio was kept for this dictation', { tone: 'error' });
                const r = await native.invoke('audio:extract', { file: h.audio, name: `Roy Flow ${new Date(h.ts).toISOString().slice(0, 16).replace(':', '-')}` });
                if (r.ok) toast(`Saved ${r.path}`);
              },
            },
          ]}
        />
      </div>
      {dialog === 'delete' && (
        <Confirm
          title="Are you sure you want to delete this transcript?"
          subtitle="The transcript and its audio are deleted from this Mac and cannot be recovered"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setState((s) => ({ history: s.history.filter((x) => x.id !== h.id) }));
            toast('Transcript deleted');
          }}
        />
      )}
      {dialog === 'report' && <ReportDialog onClose={() => setDialog(null)} onSend={(note) => update({ flagged: true, flagNote: note.trim() || undefined })} />}
    </div>
  );
}

function ReportDialog({ onClose, onSend }: { onClose: () => void; onSend: (note: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      title="Flag this transcript"
      subtitle="The flag and your note are saved with the transcript. Search Home for “flagged” to list them. If a word keeps coming out wrong, add it to your dictionary."
      onClose={onClose}
      actions={
        <button
          className="btn btn-primary"
          onClick={() => {
            onSend(text);
            onClose();
            toast('Transcript flagged');
          }}
        >
          Flag
        </button>
      }
    >
      <textarea className="field" style={{ width: 460 }} placeholder="Optional note: what did you expect?" value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}
