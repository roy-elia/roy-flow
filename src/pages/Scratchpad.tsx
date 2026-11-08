import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Copy,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Quote,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { getState, setSetting, setState, toast, uid, useStore, type Note } from '../store';
import { getNav, setNav, useNav } from '../nav';
import { Confirm, Hero, Info, PageFrame, SearchToggle, Switch } from '../components/ui';
import { native } from '../native/bridge';
import { useShortcutLabel } from '../settings/ShortcutsEditor';

const strip = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent ?? '';
};

export function newNote(content = ''): string {
  const n: Note = { id: uid(), title: '', html: content, updated: Date.now() };
  setState((s) => ({ notes: [n, ...s.notes] }));
  return n.id;
}

export default function Scratchpad() {
  const notes = useStore((s) => s.notes);
  const inBar = useStore((s) => s.settings.scratchpadInBar as boolean);
  const shortcut = useShortcutLabel('scratchpad');
  const [q, setQ] = useState('');
  const [spin, setSpin] = useState(false);
  const [del, setDel] = useState<Note | null>(null);
  const list = useMemo(
    () =>
      [...notes]
        .filter((n) => !q || (n.title + strip(n.html)).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated),
    [notes, q],
  );
  const open = (id: string) => setNav({ noteId: id });
  return (
    <PageFrame
      title={
        <>
          Scratchpad <span className="badge badge-dark">Beta</span>
        </>
      }
      cta={
        <div className="row-gap" style={{ gap: 12 }}>
          <span className="row-gap" style={{ gap: 8 }}>
            Add to Flow Bar <Info tip="Show a Scratchpad button on the Flow Bar so you can open notes from anywhere." />
          </span>
          <Switch on={inBar} onChange={(v) => setSetting('scratchpadInBar', v)} label="Add to Flow Bar" />
          <button className="chip-row muted-chip" onClick={() => (native ? native.send('scratchpad:open') : open(newNote()))} data-tip="Change the shortcut in Settings › General › Shortcuts">
            {shortcut ? (
              <>
                <kbd className="key">{shortcut}</kbd> to Open
              </>
            ) : (
              <span style={{ padding: '4px 0 4px 12px' }}>Open in its own window</span>
            )}
          </button>
        </div>
      }
    >
      <div className="sp-body">
        <Hero
          palette="amber"
          title="For quick thoughts worth coming back to"
          desc="Jot a to-do list, tidy a message before you send it, or empty your head of an idea. Scratchpad keeps it all in one calm place."
          wide
          cta={
            <button className="btn btn-lumen" onClick={() => open(newNote())}>
              Start new note
            </button>
          }
          style={{ paddingBottom: 48 }}
        >
          <div className="sp-mock" aria-hidden>
            <div className="sp-mock-bar">
              <X size={12} /> <PanelLeft size={12} /> <span>Untitled ×</span> <Plus size={12} />
              <Maximize2 size={12} style={{ marginLeft: 'auto' }} />
            </div>
            <div className="sp-mock-body">
              <SquarePen size={12} />
              <p>Plan for Saturday: groceries in the morning, then repot the plants and call the bike shop about the brakes.</p>
            </div>
          </div>
        </Hero>
        <div className="sp-tabs">
          <span className="sp-tab">Recents</span>
          <div className="tabs-utils">
            <SearchToggle value={q} onChange={setQ} placeholder="Search your notes" />
            <button className="icon-btn" data-tip="New note" aria-label="New note" onClick={() => open(newNote())}>
              <Plus size={20} className="muted" />
            </button>
            <button
              className="icon-btn"
              data-tip="Refresh"
              aria-label="Refresh"
              onClick={() => {
                setSpin(true);
                window.setTimeout(() => setSpin(false), 700);
              }}
            >
              <RefreshCw size={18} className={`muted ${spin ? 'spin' : ''}`} />
            </button>
          </div>
        </div>
        {list.length === 0 ? (
          <div className="empty">No notes found</div>
        ) : (
          <div className="sp-list">
            {list.map((n) => (
              <div key={n.id} className="sp-item" role="button" tabIndex={0} onClick={() => open(n.id)} onKeyDown={(e) => e.key === 'Enter' && open(n.id)}>
                <span className="sp-pin">{n.pinned && <Pin size={14} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sp-title">{n.title || 'Untitled'}</div>
                  <div className="sp-preview" dangerouslySetInnerHTML={{ __html: n.html || '<span>Empty note</span>' }} />
                </div>
                <div className="row-actions" style={{ padding: 0, alignSelf: 'flex-start' }}>
                  <button
                    className="icon-btn"
                    data-tip={n.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setState((s) => ({ notes: s.notes.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x)) }));
                    }}
                  >
                    {n.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </button>
                  <button
                    className="icon-btn"
                    data-tip="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDel(n);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 120 }} />
      </div>
      {del && (
        <Confirm
          title="Are you sure you want to delete this note?"
          onClose={() => setDel(null)}
          onConfirm={() => {
            setState((s) => ({ notes: s.notes.filter((x) => x.id !== del.id) }));
            const nav = getNav();
            if (nav.noteId === del.id) setNav({ noteId: null });
            toast('Note deleted');
          }}
        />
      )}
    </PageFrame>
  );
}

/* ================================================================== editor window */
export function ScratchpadWindow({ standalone }: { standalone?: boolean } = {}) {
  const noteId = useNav((n) => n.noteId);
  const notes = useStore((s) => s.notes);
  const [tabs, setTabs] = useState<string[]>([]);
  const [side, setSide] = useState(standalone && getState().settings.scratchpadOpen === 'Show all notes');
  const [big, setBig] = useState(false);
  const ed = useRef<HTMLDivElement>(null);
  const note = notes.find((n) => n.id === noteId);

  useEffect(() => {
    if (noteId && !tabs.includes(noteId)) setTabs((t) => [...t, noteId]);
  }, [noteId, tabs]);
  useEffect(() => {
    if (ed.current && note && ed.current.innerHTML !== note.html) ed.current.innerHTML = note.html;
    // only when switching notes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  if (!noteId || !note) return null;
  const patch = (p: Partial<Note>) => setState((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? { ...n, ...p, updated: Date.now() } : n)) }));
  const cmd = (c: string, v?: string) => {
    ed.current?.focus();
    document.execCommand(c, false, v);
    patch({ html: ed.current?.innerHTML ?? '' });
  };
  const closeTab = (id: string) => {
    const rest = tabs.filter((t) => t !== id);
    setTabs(rest);
    if (id === noteId) setNav({ noteId: rest[rest.length - 1] ?? null });
  };
  const live = tabs.filter((t) => notes.some((n) => n.id === t));

  return (
    <div className={`sp-window ${big ? 'big' : ''} ${standalone ? 'standalone' : ''}`} role="dialog" aria-label="Scratchpad">
      <div className="sp-win-bar">
        {!standalone && (
          <button className="icon-btn" aria-label="Close Scratchpad" onClick={() => (setTabs([]), setNav({ noteId: null }))}>
            <X size={16} />
          </button>
        )}
        <button className={`icon-btn ${side ? 'active' : ''}`} aria-label="Toggle sidebar" onClick={() => setSide(!side)}>
          <PanelLeft size={16} />
        </button>
        <div className="sp-win-tabs">
          {live.map((id) => {
            const n = notes.find((x) => x.id === id)!;
            return (
              <span key={id} className={`sp-win-tab ${id === noteId ? 'active' : ''}`} onClick={() => setNav({ noteId: id })}>
                {n.title || 'Untitled'}
                <button
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(id);
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          <button className="icon-btn" aria-label="New note" onClick={() => setNav({ noteId: newNote() })}>
            <Plus size={14} />
          </button>
        </div>
        {!standalone && (
          <button className="icon-btn" aria-label={big ? 'Compact' : 'Expand'} onClick={() => setBig(!big)}>
            {big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
      </div>
      <div className="sp-win-main">
        {side && (
          <div className="sp-win-side">
            <button className="menu-item" onClick={() => setNav({ noteId: newNote() })}>
              <SquarePen size={14} /> New note
            </button>
            <div className="menu-item muted" style={{ cursor: 'default' }}>
              <Search size={14} /> {notes.length} notes
            </div>
            {notes.map((n) => (
              <button key={n.id} className={`menu-item ${n.id === noteId ? 'selected' : ''}`} onClick={() => setNav({ noteId: n.id })}>
                <span className="ellipsis">{n.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="sp-win-doc">
          <input className="sp-win-title" placeholder="Untitled" value={note.title} onChange={(e) => patch({ title: e.target.value })} />
          <div
            ref={ed}
            className="sp-editor"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Start typing, or click the Flow Bar to dictate..."
            onInput={() => patch({ html: ed.current?.innerHTML ?? '' })}
          />
          <div className="sp-toolbar">
            <button className="icon-btn" aria-label="Bold" onMouseDown={(e) => (e.preventDefault(), cmd('bold'))}>
              <Bold size={15} />
            </button>
            <button className="icon-btn" aria-label="Italic" onMouseDown={(e) => (e.preventDefault(), cmd('italic'))}>
              <Italic size={15} />
            </button>
            <button className="icon-btn" aria-label="Underline" onMouseDown={(e) => (e.preventDefault(), cmd('underline'))}>
              <Underline size={15} />
            </button>
            <button className="icon-btn" aria-label="Bulleted list" onMouseDown={(e) => (e.preventDefault(), cmd('insertUnorderedList'))}>
              <List size={15} />
            </button>
            <button className="icon-btn" aria-label="Numbered list" onMouseDown={(e) => (e.preventDefault(), cmd('insertOrderedList'))}>
              <ListOrdered size={15} />
            </button>
            <button className="icon-btn" aria-label="Quote" onMouseDown={(e) => (e.preventDefault(), cmd('formatBlock', 'blockquote'))}>
              <Quote size={15} />
            </button>
            <button className="icon-btn" aria-label="Code" onMouseDown={(e) => (e.preventDefault(), cmd('formatBlock', 'pre'))}>
              <Code size={15} />
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="icon-btn"
              aria-label="Copy note"
              onClick={() => {
                navigator.clipboard?.writeText(strip(note.html));
                toast('Note copied');
              }}
            >
              <Copy size={15} />
            </button>
            <span className="muted small">Saved</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** append dictated text to the open note (used by the Flow Bar) */
export function appendToOpenNote(text: string): boolean {
  const id = getNav().noteId;
  if (!id) return false;
  const el = document.querySelector<HTMLDivElement>('.sp-editor');
  if (el) {
    el.innerHTML += (el.innerHTML ? '<br>' : '') + text.replace(/</g, '&lt;');
    setState((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, html: el.innerHTML, updated: Date.now() } : n)) }));
  }
  return true;
}

/** the Scratchpad as its own desktop window (Open Scratchpad shortcut, Flow Bar button) */
export function ScratchpadApp() {
  const theme = useStore((s) => s.theme);
  const noteId = useNav((n) => n.noteId);
  const started = useRef(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const st = getState();
    const recent = [...st.notes].sort((a, b) => b.updated - a.updated)[0];
    const mode = st.settings.scratchpadOpen;
    setNav({ noteId: mode === 'Start a new note' || !recent ? newNote() : recent.id });
    started.current = true;
  }, []);
  // closing the last tab closes the window
  useEffect(() => {
    if (started.current && noteId === null && native) native.send('scratchpad:close');
  }, [noteId]);
  return (
    <div className="sp-standalone">
      <ScratchpadWindow standalone />
    </div>
  );
}
