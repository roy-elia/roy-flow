import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpDown, Pencil, RefreshCw, Star, Trash2, Users } from 'lucide-react';
import { setState, toast, uid, useStore, type DictWord, type Scope, type Snippet } from '../store';
import { Confirm, Dialog, Hero, MenuButton, PageFrame, SearchToggle, Switch, Tabs } from '../components/ui';

type TabId = 'all' | 'personal' | 'team';
type Sort = 'Newest first' | 'Oldest first' | 'Alphabetical (A-Z)' | 'Starred first';

function useListChrome(placeholder: string, sorts: Sort[]) {
  const [tab, setTab] = useState<TabId>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('Newest first');
  const [spin, setSpin] = useState(false);
  const tabs = (
    <Tabs
      tabs={[
        { id: 'all', label: 'All' },
        { id: 'personal', label: 'Personal' },
        { id: 'team', label: 'Shared with team' },
      ]}
      value={tab}
      onChange={setTab}
      utils={
        <>
          <SearchToggle value={q} onChange={setQ} placeholder={placeholder} />
          <MenuButton
            tip="Sort"
            trigger={<ArrowUpDown size={18} className="muted" />}
            items={sorts.map((s) => ({ label: s === sort ? `✓  ${s}` : s, run: () => setSort(s) }))}
          />
          <button
            className="icon-btn"
            data-tip="Sync"
            aria-label="Sync"
            onClick={() => {
              setSpin(true);
              window.setTimeout(() => setSpin(false), 700);
            }}
          >
            <RefreshCw size={18} className={`muted ${spin ? 'spin' : ''}`} />
          </button>
        </>
      }
    />
  );
  return { tab, q, sort, tabs };
}

function sortItems<T extends { created: number; starred?: boolean }>(items: T[], sort: Sort, key: (t: T) => string) {
  const out = [...items];
  if (sort === 'Newest first') out.sort((a, b) => b.created - a.created);
  if (sort === 'Oldest first') out.sort((a, b) => a.created - b.created);
  if (sort === 'Alphabetical (A-Z)') out.sort((a, b) => key(a).localeCompare(key(b)));
  if (sort === 'Starred first') out.sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.created - a.created);
  return out;
}

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/* ================================================================== Dictionary */
export function Dictionary() {
  const words = useStore((s) => s.dictionary);
  const heroHidden = useStore((s) => s.dismissed.dictionaryHero);
  const { tab, q, sort, tabs } = useListChrome('Search your vocabulary', ['Starred first', 'Newest first', 'Oldest first', 'Alphabetical (A-Z)']);
  const [modal, setModal] = useState<null | { edit?: DictWord; preset?: string }>(null);
  const [del, setDel] = useState<DictWord | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const list = useMemo(
    () =>
      sortItems(
        words.filter((w) => (tab === 'all' || w.scope === tab) && (!q || `${w.misspelling ?? ''} ${w.word}`.toLowerCase().includes(q.toLowerCase()))),
        sort,
        (w) => w.word,
      ),
    [words, tab, q, sort],
  );

  const importFile = async (f: File) => {
    const text = await f.text();
    const items: DictWord[] = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [a, b] = l.split(/\s*(?:,|->|→)\s*/);
        return b ? { id: uid(), misspelling: a, word: b, scope: 'personal', created: Date.now() } : { id: uid(), word: a, scope: 'personal', created: Date.now() };
      });
    if (!items.length) return toast('No dictionary items found in file', { tone: 'error' });
    setState((s) => ({ dictionary: [...items, ...s.dictionary] }));
    toast(`${items.length} words imported`);
  };

  return (
    <PageFrame
      title="Dictionary"
      cta={
        <div className="row-gap" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => file.current?.click()}>
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setModal({})}>
            Add new
          </button>
          <input ref={file} type="file" accept=".txt,.csv" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      }
      tabs={tabs}
    >
      <div className="list-body">
        {!heroHidden && (
          <Hero
            palette="amber"
            title={
              <>
                Roy Flow spells it the way <em>you</em> do.
              </>
            }
            desc={
              <>
                Fix a word once or add it here yourself, and your <b>names, team jargon and unusual spellings</b> come out right in every dictation and meeting note.
              </>
            }
            wide
            onClose={() => setState((s) => ({ dismissed: { ...s.dismissed, dictionaryHero: true } }))}
            cta={
              <>
                <button className="btn btn-lumen btn-lg-chip" onClick={() => setModal({})}>
                  Add new word
                </button>
                {['Priya', 'Mateo', 'Kubernetes', 'Figma'].map((w) => (
                  <button key={w} className="btn btn-frost btn-lg-chip" onClick={() => setModal({ preset: w })}>
                    {w}
                  </button>
                ))}
              </>
            }
          />
        )}
        {list.length > 0 ? (
          <div className="table">
            {list.map((w) => (
              <div className="row" key={w.id}>
                <p className="list-text">
                  {w.misspelling ? (
                    <>
                      {highlight(w.misspelling, q)} <ArrowRight size={14} className="inline-arrow" /> {highlight(w.word, q)}
                    </>
                  ) : (
                    highlight(w.word, q)
                  )}
                  {w.scope === 'team' && (
                    <span data-tip="Shared with team" className="muted" style={{ marginLeft: 8 }}>
                      <Users size={14} />
                    </span>
                  )}
                </p>
                <div className="row-actions">
                  <button
                    className="icon-btn"
                    data-tip={w.scope === 'team' ? 'Make personal' : 'Share with team'}
                    onClick={() => setState((s) => ({ dictionary: s.dictionary.map((x) => (x.id === w.id ? { ...x, scope: x.scope === 'team' ? 'personal' : 'team' } : x)) }))}
                  >
                    <Users size={16} />
                  </button>
                  <button className="icon-btn" data-tip="Edit" onClick={() => setModal({ edit: w })}>
                    <Pencil size={16} />
                  </button>
                  <button className="icon-btn" data-tip="Delete" onClick={() => setDel(w)}>
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    data-tip={w.starred ? 'Unstar' : 'Star'}
                    onClick={() => setState((s) => ({ dictionary: s.dictionary.map((x) => (x.id === w.id ? { ...x, starred: !x.starred } : x)) }))}
                  >
                    <Star size={16} fill={w.starred ? '#e8a800' : 'none'} color={w.starred ? '#e8a800' : 'currentColor'} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          (q || tab !== 'all') && (
            <div className="empty-container">
              <b>No results found</b>
              <span className="muted">{q ? 'No words found matching your search' : 'No words here yet'}</span>
            </div>
          )
        )}
      </div>
      {modal && <WordModal edit={modal.edit} preset={modal.preset} onClose={() => setModal(null)} />}
      {del && (
        <Confirm
          title="Delete from personal vocabulary?"
          subtitle={`'${del.misspelling ? `${del.misspelling} → ${del.word}` : del.word}' will be deleted permanently.`}
          onClose={() => setDel(null)}
          onConfirm={() => {
            setState((s) => ({ dictionary: s.dictionary.filter((x) => x.id !== del.id) }));
            toast(`"${del.word}" deleted`);
          }}
        />
      )}
    </PageFrame>
  );
}

function WordModal({ edit, preset, onClose }: { edit?: DictWord; preset?: string; onClose: () => void }) {
  const [replace, setReplace] = useState(!!edit?.misspelling);
  const [mis, setMis] = useState(edit?.misspelling ?? '');
  const [word, setWord] = useState(edit?.word ?? preset ?? '');
  const [team, setTeam] = useState(edit?.scope === 'team');
  const save = () => {
    if (!word.trim() || (replace && !mis.trim())) return;
    const item: DictWord = {
      id: edit?.id ?? uid(),
      word: word.trim(),
      misspelling: replace ? mis.trim() : undefined,
      scope: team ? 'team' : 'personal',
      created: edit?.created ?? Date.now(),
      starred: edit?.starred,
    };
    setState((s) => ({ dictionary: edit ? s.dictionary.map((x) => (x.id === edit.id ? item : x)) : [item, ...s.dictionary] }));
    toast(edit ? `Updated "${item.word}"` : replace ? `"${item.word}" added as a replacement for "${item.misspelling}"` : `"${item.word}" added successfully`);
    onClose();
  };
  return (
    <Dialog
      title={edit ? 'Edit word' : 'Add to vocabulary'}
      onClose={onClose}
      width={520}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!word.trim() || (replace && !mis.trim())}>
            {edit ? 'Save' : 'Add word'}
          </button>
        </>
      }
    >
      <div className="field-label">
        <span>Correct a misspelling</span>
        <Switch on={replace} onChange={setReplace} label="Correct a misspelling" />
      </div>
      <label className="check-label">
        <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} /> Share with team
      </label>
      <div className="row-gap" style={{ gap: 12 }}>
        {replace && (
          <>
            <input className="field" autoFocus placeholder="Misspelling" value={mis} onChange={(e) => setMis(e.target.value)} />
            <ArrowRight size={18} className="muted" style={{ flexShrink: 0 }} />
          </>
        )}
        <input
          className="field"
          autoFocus={!replace}
          placeholder={replace ? 'Correct spelling' : 'Add a new word'}
          value={word}
          maxLength={120}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
    </Dialog>
  );
}

/* ================================================================== Snippets */
export function Snippets() {
  const snippets = useStore((s) => s.snippets);
  const heroHidden = useStore((s) => s.dismissed.snippetsHero);
  const { tab, q, sort, tabs } = useListChrome('Search your snippets', ['Newest first', 'Oldest first', 'Alphabetical (A-Z)']);
  const [modal, setModal] = useState<null | { edit?: Snippet; preset?: { trigger: string; expansion: string } }>(null);
  const [del, setDel] = useState<Snippet | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const list = useMemo(
    () =>
      sortItems(
        snippets.filter((s) => (tab === 'all' || s.scope === tab) && (!q || `${s.trigger} ${s.expansion}`.toLowerCase().includes(q.toLowerCase()))),
        sort,
        (s) => s.trigger,
      ),
    [snippets, tab, q, sort],
  );
  const EX = [
    { trigger: 'my calendar link', expansion: 'https://example.com/book-a-call' },
    { trigger: 'shorten prompt', expansion: 'Make this shorter and clearer...' },
    { trigger: 'follow up email', expansion: 'Hi, just checking in on the note I sent...' },
  ];

  return (
    <PageFrame
      title="Snippets"
      cta={
        <div className="row-gap" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => file.current?.click()}>
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setModal({})}>
            Add new
          </button>
          <input
            ref={file}
            type="file"
            accept=".txt,.csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const items: Snippet[] = (await f.text())
                .split(/\r?\n/)
                .map((l) => l.split(/\s*(?:,|->|→)\s*/))
                .filter((p) => p.length >= 2 && p[0])
                .map(([t, ...rest]) => ({ id: uid(), trigger: t.trim(), expansion: rest.join(', ').trim(), scope: 'personal' as Scope, created: Date.now() }));
              if (!items.length) return toast('No snippets found in file', { tone: 'error' });
              setState((s) => ({ snippets: [...items, ...s.snippets] }));
              toast(`${items.length} snippets imported`);
            }}
          />
        </div>
      }
      tabs={tabs}
    >
      <div className="list-body">
        {!heroHidden && (
          <Hero
            palette="night"
            title={
              <>
                Words <em>you</em> never need to type twice.
              </>
            }
            desc="Keep the text you reach for all the time, like a link, a sign-off or a prompt, and say a short cue to paste it in."
            onClose={() => setState((s) => ({ dismissed: { ...s.dismissed, snippetsHero: true } }))}
          >
            <div className="snip-examples">
              {EX.map((e) => (
                <button key={e.trigger} className="snip-ex" onClick={() => setModal({ preset: e })}>
                  <span className="btn btn-frost btn-lg-chip">
                    <i>“{e.trigger}”</i>
                  </span>
                  <ArrowRight size={14} />
                  <span className="btn btn-frost btn-lg-chip">{e.expansion}</span>
                </button>
              ))}
            </div>
            <div className="hero-cta">
              <button className="btn btn-lumen btn-lg-chip" onClick={() => setModal({})}>
                Add new snippet
              </button>
            </div>
          </Hero>
        )}
        {list.length > 0 ? (
          <div className="table">
            {list.map((s) => (
              <div className="row" key={s.id}>
                <p className="list-text ellipsis">
                  {highlight(s.trigger, q)} <ArrowRight size={14} className="inline-arrow" /> {highlight(s.expansion, q)}
                </p>
                <div className="row-actions">
                  <button
                    className="icon-btn"
                    data-tip={s.scope === 'team' ? 'Make personal' : 'Share with team'}
                    onClick={() => setState((st) => ({ snippets: st.snippets.map((x) => (x.id === s.id ? { ...x, scope: x.scope === 'team' ? 'personal' : 'team' } : x)) }))}
                  >
                    <Users size={16} />
                  </button>
                  <button className="icon-btn" data-tip="Edit" onClick={() => setModal({ edit: s })}>
                    <Pencil size={16} />
                  </button>
                  <button className="icon-btn" data-tip="Delete" onClick={() => setDel(s)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          (q || tab !== 'all') && (
            <div className="empty-container">
              <b>No results found</b>
              <span className="muted">{q ? 'No snippets found matching your search' : 'No snippets here yet'}</span>
            </div>
          )
        )}
      </div>
      {modal && <SnippetModal edit={modal.edit} preset={modal.preset} onClose={() => setModal(null)} />}
      {del && (
        <Confirm
          title="Delete this snippet?"
          subtitle={`'${del.trigger}' will be deleted permanently.`}
          onClose={() => setDel(null)}
          onConfirm={() => {
            setState((s) => ({ snippets: s.snippets.filter((x) => x.id !== del.id) }));
            toast(`"${del.trigger}" deleted`);
          }}
        />
      )}
    </PageFrame>
  );
}

const MAX = 4000;
function SnippetModal({ edit, preset, onClose }: { edit?: Snippet; preset?: { trigger: string; expansion: string }; onClose: () => void }) {
  const [trigger, setTrigger] = useState(edit?.trigger ?? preset?.trigger ?? '');
  const [exp, setExp] = useState(edit?.expansion ?? preset?.expansion ?? '');
  const [team, setTeam] = useState(edit?.scope === 'team');
  const ok = trigger.trim() && exp.trim() && exp.length <= MAX;
  const save = () => {
    if (!ok) return toast('Please enter a snippet and its expansion', { tone: 'error' });
    const item: Snippet = { id: edit?.id ?? uid(), trigger: trigger.trim(), expansion: exp.trim(), scope: team ? 'team' : 'personal', created: edit?.created ?? Date.now() };
    setState((s) => ({ snippets: edit ? s.snippets.map((x) => (x.id === edit.id ? item : x)) : [item, ...s.snippets] }));
    toast(edit ? `Updated "${item.trigger}"` : `"${item.trigger}" added successfully`);
    onClose();
  };
  return (
    <Dialog
      title={edit ? 'Edit snippet' : 'Add snippet'}
      onClose={onClose}
      width={640}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={save}>
            {edit ? 'Save' : 'Add snippet'}
          </button>
        </>
      }
    >
      <label className="check-label">
        <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} /> Share with team
      </label>
      <input className="field" autoFocus placeholder="Snippet" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
      <textarea
        className="field"
        rows={10}
        placeholder="Expansion"
        value={exp}
        onChange={(e) => setExp(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && save()}
      />
      <div className="counter" style={{ color: exp.length > MAX ? 'var(--destructive)' : undefined }}>
        {exp.length}/{MAX}
      </div>
    </Dialog>
  );
}
