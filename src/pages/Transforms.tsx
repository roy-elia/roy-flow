import { useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { cleanUp, setSetting, setState, toast, uid, useStore, type Transform } from '../store';
import { seedState } from '../seed';
import { Confirm, Dialog, Dropdown, Hero, Info, Keys, PageFrame, Switch } from '../components/ui';

export function runTransform(t: Transform, text: string) {
  const base = cleanUp(text);
  if (t.name === 'Polish')
    return base
      .replace(/\b(really|very|just|basically|actually|kind of|sort of)\s+/gi, '')
      .replace(/\bin order to\b/gi, 'to')
      .replace(/\s+/g, ' ');
  if (t.name === 'Prompt Engineer') return `**Title** ${base.split(/[.!?]/)[0]}\n**Goal** ${base}\n**Context** Add any background the model needs.\n**Output** A concise answer in bullet points.`;
  return `${base}`;
}

const COMBOS = [
  ['cmd', 'opt'],
  ['ctrl', 'opt'],
  ['cmd', 'shift'],
  ['ctrl', 'shift'],
  ['opt', 'shift'],
];

export default function Transforms() {
  const transforms = useStore((s) => s.transforms);
  const optIn = useStore((s) => s.settings.transformsOptIn as boolean);
  const autoApply = useStore((s) => s.settings.autoApply as boolean);
  const autoT = useStore((s) => s.settings.autoApplyTransform as string);
  const [editor, setEditor] = useState<null | { edit?: Transform }>(null);
  const [reset, setReset] = useState(false);
  const [tryIt, setTryIt] = useState(false);

  return (
    <PageFrame
      title={
        <>
          Transforms <span className="badge badge-dark">Beta</span>
        </>
      }
      cta={
        <div className="row-gap" style={{ gap: 12 }}>
          <span className="row-gap" style={{ gap: 8 }}>
            Opt in <Info tip="Turn Transforms on to rewrite selected text with a shortcut." />
          </span>
          <Switch on={optIn} onChange={(v) => setSetting('transformsOptIn', v)} label="Opt in" />
          <button className="chip-row" onClick={() => toast('Hold ⌥ Opt + O after a Transform to compare versions')}>
            <kbd className="key">⌥ Opt</kbd>
            <kbd className="key">o</kbd> to view changes
          </button>
        </div>
      }
    >
      <div className={`tf-body ${optIn ? '' : 'settings-disabled'}`}>
        <Hero
          palette="ocean"
          title="Transforms work wherever you write"
          desc={
            <>
              Run a Transform to rewrite, tidy up or restructure
              <br />
              text right after you dictate.
            </>
          }
          cta={
            <>
              <button className="btn btn-lumen" onClick={() => setTryIt(true)}>
                Try it out
              </button>
              <button className="btn" style={{ color: 'var(--lumen-text)' }} onClick={() => toast('Select text anywhere, then press a Transform shortcut')}>
                How it works
              </button>
            </>
          }
        >
          <div className="app-orbs" aria-hidden>
            {['A', 'N', 'M', 'S', 'C', 'G', 'L'].map((l, i) => (
              <span key={l} className={`orb o${i}`}>
                {l}
              </span>
            ))}
          </div>
        </Hero>
        <div className="tf-row">
          <div>
            <div className="tf-row-title">Auto Apply After Dictation</div>
            <div className="small">Run a transform on everything you dictate, automatically.</div>
          </div>
          <div className="row-gap" style={{ gap: 12 }}>
            <Info tip={autoApply ? 'Chosen transform runs after each dictation' : 'Turn on Auto Apply to choose a transform.'} />
            <Dropdown value={autoT} options={transforms.map((t) => t.name)} disabled={!autoApply} onChange={(v) => setSetting('autoApplyTransform', v)} width={300} />
            <Switch on={autoApply} onChange={(v) => setSetting('autoApply', v)} label="Auto apply" />
          </div>
        </div>
        <div className="tf-about">
          <h2 className="serif" style={{ fontSize: 28, lineHeight: '32px' }}>
            My Transforms
          </h2>
          <div className="row-gap" style={{ gap: 16 }}>
            <button className="btn btn-ghost" onClick={() => setReset(true)}>
              <RotateCcw size={18} /> Reset to defaults
            </button>
            {transforms.length < 9 && (
              <button className="btn btn-primary" onClick={() => setEditor({})}>
                Create New
              </button>
            )}
          </div>
        </div>
        <div className="tf-cards">
          {transforms.map((t) => (
            <button key={t.id} className="tf-card" onClick={() => setEditor({ edit: t })}>
              <Keys keys={t.keys} />
              <div className="tf-title">{t.name}</div>
              <div className="muted ellipsis">{t.description}</div>
            </button>
          ))}
          <button className="tf-card" onClick={() => setEditor({})}>
            <span className="plus-circle">
              <Plus size={12} />
            </span>
            <div className="tf-title">Create your own</div>
            <div className="muted">Upload your own prompt</div>
          </button>
        </div>
        <div style={{ height: 120 }} />
      </div>
      {editor && <TransformEditor edit={editor.edit} onClose={() => setEditor(null)} />}
      {tryIt && <TryIt onClose={() => setTryIt(false)} />}
      {reset && (
        <Confirm
          title="Are you sure you want to reset?"
          subtitle="Built-in transforms go back to their defaults, and every custom transform is removed."
          confirm="Yes"
          onClose={() => setReset(false)}
          onConfirm={() => {
            setState({ transforms: seedState().transforms });
            toast('Settings reset');
          }}
        />
      )}
    </PageFrame>
  );
}

function TryIt({ onClose }: { onClose: () => void }) {
  const transforms = useStore((s) => s.transforms);
  const [name, setName] = useState(transforms[0]?.name ?? 'Polish');
  const [text, setText] = useState('so um basically I really think we should actually move the meeting to friday in order to give everyone more time');
  const t = transforms.find((x) => x.name === name)!;
  return (
    <Dialog title="Try a Transform" subtitle="Type or paste some text, pick a Transform and see the result." onClose={onClose} width={560}>
      <Dropdown value={name} options={transforms.map((x) => x.name)} onChange={setName} align="left" />
      <textarea className="field" style={{ minHeight: 100 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="caps muted">Result</div>
      <div className="tf-result">{t ? runTransform(t, text) : ''}</div>
    </Dialog>
  );
}

function TransformEditor({ edit, onClose }: { edit?: Transform; onClose: () => void }) {
  const transforms = useStore((s) => s.transforms);
  const [name, setName] = useState(edit?.name ?? '');
  const [keys, setKeys] = useState(edit?.keys.join('+') ?? '');
  const [prompt, setPrompt] = useState(edit?.prompt ?? '');
  const [del, setDel] = useState(false);
  const conflict = transforms.find((t) => t.id !== edit?.id && t.keys.join('+') === keys);
  const save = () => {
    if (!name.trim()) return toast('Give your Transform a name', { tone: 'error' });
    const t: Transform = {
      id: edit?.id ?? uid(),
      name: name.trim(),
      prompt,
      description: edit?.builtin ? edit.description : prompt.split(/\s+/).slice(0, 7).join(' ') + (prompt ? '...' : ''),
      keys: keys ? keys.split('+') : [],
      builtin: edit?.builtin,
    };
    setState((s) => ({ transforms: edit ? s.transforms.map((x) => (x.id === edit.id ? t : x)) : [...s.transforms, t] }));
    toast('Saved');
    onClose();
  };
  const sample = 'so basically I think the report is good but it is kind of long';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tf-editor" role="dialog" aria-modal="true">
        <div className="tf-left">
          <h2 className="dialog-title">{edit ? edit.name : 'Create your own'}</h2>
          <p className="muted">Name it, give it a shortcut, and describe how it should change your text.</p>
          <div className="tf-example">
            <div className="caps muted">Before</div>
            <p>{sample}</p>
            <div className="caps muted" style={{ marginTop: 12 }}>
              After
            </div>
            <p>{runTransform({ id: '', name: edit?.name ?? 'Polish', description: '', prompt, keys: [] }, sample)}</p>
          </div>
        </div>
        <div className="tf-right">
          <div className="tf-reset-row">
            <span className="muted small">{edit ? 'Editing' : 'New transform'}</span>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className="tf-scroll">
            <label className="tf-field">
              <span className="field-label">Name</span>
              <input className="field" placeholder="Boss Mode" value={name} onChange={(e) => setName(e.target.value)} disabled={edit?.builtin} />
            </label>
            <div className="tf-field">
              <span className="field-label">Choose a keyboard shortcut</span>
              <Dropdown
                value={keys}
                align="left"
                options={[{ value: '', label: 'No shortcut' }, ...COMBOS.map((c) => ({ value: c.join('+'), label: <Keys keys={c} small /> }))]}
                onChange={setKeys}
              />
              {conflict && <span className="small" style={{ color: 'var(--destructive)' }}>Already used by {conflict.name}</span>}
            </div>
            <label className="tf-field">
              <span className="field-label">Prompt</span>
              <textarea className="field" placeholder="How do you want this Transform to change your text?" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>
          </div>
          <div className="dialog-actions" style={{ justifyContent: 'space-between' }}>
            {edit && !edit.builtin ? (
              <button className="btn btn-ghost" style={{ color: 'var(--destructive)' }} onClick={() => setDel(true)}>
                <Trash2 size={16} /> Delete
              </button>
            ) : (
              <span />
            )}
            <div className="row-gap" style={{ gap: 12 }}>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!!conflict}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
      {del && edit && (
        <Confirm
          title={`Delete ${edit.name}?`}
          onClose={() => setDel(false)}
          onConfirm={() => {
            setState((s) => ({ transforms: s.transforms.filter((t) => t.id !== edit.id) }));
            onClose();
          }}
        />
      )}
    </div>
  );
}
