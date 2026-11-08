/* Shortcuts editor (spec: analysis/wispr-flow/UI_PAGES_ADDENDUM_2.md §3), adapted: one row per action, key chips,
   click-to-record with a live chord from the native event tap (fn, modifier-only chords, mouse buttons 3-5; the tap
   stops matching shortcuts while recording, so the keys you press do not trigger anything). A chord is saved as soon
   as a non-modifier key or mouse button goes down, or, for modifier-only chords, when the keys are released.
   Esc cancels, Backspace clears, conflicts and reserved combos are refused, changes apply in the helper at once. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { setState, toast, useStore } from '../store';
import { Dialog } from '../components/ui';
import { native } from '../native/bridge';
import { useAccess } from '../native/AccessBanner';
import {
  allActions,
  bindingsOf,
  chordId,
  chordLabel,
  chordWarning,
  codeToKeyName,
  defaultHotkeyMap,
  isModifier,
  mouseButtonName,
  reservedWarning,
  defaultsFor,
  keyChip,
  MAX_CHORDS,
  normalize,
  validateChord,
  type Chord,
  type HotkeyAction,
} from '../shared/hotkeys';

interface Rec {
  action: string;
  /** chord index being replaced; -1 = adding a new one */
  index: number;
}

export function KeyChips({ chord, small }: { chord: Chord; small?: boolean }) {
  return (
    <span className="sc-chips">
      {normalize(chord).map((k) => (
        <kbd key={k} className={`key ${small ? 'sm' : ''}`}>
          {keyChip(k)}
        </kbd>
      ))}
    </span>
  );
}

/** current label of an action's first shortcut, for tooltips and hints ("" if none) */
export function useShortcutLabel(action: string): string {
  const map = useStore((s) => s.hotkeys);
  return chordLabel(bindingsOf(map, action)[0]);
}

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const transforms = useStore((s) => s.transforms);
  const map = useStore((s) => s.hotkeys);
  const actions = useMemo(() => allActions(transforms), [transforms]);
  const access = useAccess();
  const [rec, setRec] = useState<Rec | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const peak = useRef<string[]>([]);
  const liveRef = useRef<string[]>([]);
  const recRef = useRef<Rec | null>(null);
  recRef.current = rec;
  const useNativeKeys = !!native && access?.tap !== 'off' && access !== null;

  const save = (actionId: string, chords: Chord[]) => setState((s) => ({ hotkeys: { ...s.hotkeys, [actionId]: chords } }));

  const stop = () => {
    setRec(null);
    setLive([]);
    peak.current = [];
    liveRef.current = [];
  };

  const commit = (r: Rec, keys: string[]) => {
    const action = actions.find((a) => a.id === r.action)!;
    const chord = normalize(keys);
    const cur = bindingsOf(map, action.id);
    stop();
    if (chordId(chord) === 'esc' && action.id !== 'cancel') return; // Esc cancels recording
    if (chordId(chord) === 'backspace' || chordId(chord) === 'delete') {
      if (r.index >= 0) {
        if (action.required && cur.length === 1) return toast(`${action.label} needs at least one shortcut`, { tone: 'error' });
        save(action.id, cur.filter((_, i) => i !== r.index));
        toast(`${action.label} shortcut cleared`);
      }
      return;
    }
    const others = { ...map, [action.id]: cur.filter((_, i) => i !== r.index) };
    const err = validateChord(action, chord, others, actions);
    if (err) {
      // as in Wispr Flow: recording ends, the previous value stays, the reason is shown
      setErrors((e) => ({ ...e, [action.id]: err }));
      toast(err, { tone: 'error' });
      return;
    }
    setErrors((e) => ({ ...e, [action.id]: '' }));
    const next = r.index >= 0 ? cur.map((c, i) => (i === r.index ? chord : c)) : [...cur, chord];
    save(action.id, next);
    const warn = chordWarning(action.id, chord, { ...map, [action.id]: next }) ?? reservedWarning(chord);
    toast(warn ? `Shortcut saved. ${warn}` : 'Shortcut saved', warn ? { tone: 'error' } : {});
  };

  // live chord: from the native event tap (fn, modifier-only, mouse buttons) or, without it, from this window's events
  useEffect(() => {
    if (!rec) return;
    let done = false;
    const finish = (keys: string[]) => {
      const r = recRef.current;
      if (!r || done) return;
      done = true;
      commit(r, keys);
    };
    const onKeys = (down: string[]) => {
      if (done) return;
      liveRef.current = down;
      setLive(down);
      if (down.length >= peak.current.length) peak.current = down;
      // a key or mouse button completes the chord right away (at most one per chord)
      if (down.some((k) => !isModifier(k))) return finish(down);
      // modifier-only chords (fn, ⌃⌥) are saved when everything is released
      if (!down.length && peak.current.length) finish(peak.current);
    };
    // mouse buttons pressed on the field (the tap also reports them; this covers the no-tap fallback)
    const mouse = (e: MouseEvent) => {
      const name = mouseButtonName(e.button);
      if (!name) return;
      e.preventDefault();
      e.stopPropagation();
      onKeys(normalize([...liveRef.current.filter(isModifier), name]));
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('mousedown', mouse, true);
    window.addEventListener('contextmenu', noMenu, true);
    const cleanupMouse = () => {
      window.removeEventListener('mousedown', mouse, true);
      window.removeEventListener('contextmenu', noMenu, true);
    };
    if (useNativeKeys) {
      native!.send('hotkeys:record', true);
      const off = native!.on('hotkeys:keys', onKeys);
      return () => {
        off();
        cleanupMouse();
        native!.send('hotkeys:record', false);
      };
    }
    const held = new Set<string>();
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const k = codeToKeyName(e.code);
      if (!k) return;
      held.add(k);
      onKeys(normalize([...held]));
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = codeToKeyName(e.code);
      if (k) held.delete(k);
      // macOS swallows keyup of keys pressed with ⌘: treat any key-up with no modifiers left as release
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) held.clear();
      onKeys(normalize([...held]));
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      cleanupMouse();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, useNativeKeys]);

  const resetRow = (a: HotkeyAction) => {
    if (rec) return toast('Finish recording your shortcut first', { tone: 'error' });
    const def = defaultsFor(a.id);
    const err = def.map((c) => validateChord(a, c, { ...map, [a.id]: [] }, actions)).find(Boolean);
    if (err) return setErrors((e) => ({ ...e, [a.id]: `Default is in use: ${err}` }));
    save(a.id, structuredClone(def));
    setErrors((e) => ({ ...e, [a.id]: '' }));
  };
  const resetAll = () => {
    if (rec) return toast('Finish recording your shortcut first', { tone: 'error' });
    setState({ hotkeys: defaultHotkeyMap(transforms) });
    setErrors({});
    toast('Reset to default');
  };

  const fnUsed = Object.values(map).some((cs) => cs.some((c) => c.includes('fn')));

  return (
    <Dialog title="Shortcuts" subtitle="Choose your preferred shortcuts for using Roy Flow. Click a shortcut, then press the new keys." onClose={() => (rec ? stop() : onClose())}
      width={720}
      actions={
        <div className="sc-footer">
          <button className="btn btn-ghost" onClick={resetAll}>
            <RotateCcw size={16} /> Reset all to default
          </button>
          <button className="btn btn-primary" onClick={() => (rec ? stop() : onClose())}>
            Done
          </button>
        </div>
      }
    >
      {native && access && access.tap === 'off' && (
        <div className="sc-note error">
          Shortcuts need <b>Input Monitoring</b> or <b>Accessibility</b> permission to work in other apps, and fn needs one of them.{' '}
          <button className="link" onClick={() => native!.invoke('access:check', { prompt: false, listen: true })}>
            Open System Settings
          </button>
        </div>
      )}
      {native && fnUsed && (
        <div className="sc-note">
          Using fn? Set <b>System Settings › Keyboard › Press 🌐 key to</b> “Do Nothing” so macOS does not also open emoji or dictation.{' '}
          <button className="link" onClick={() => native!.invoke('access:open', { pane: 'keyboard' })}>
            Keyboard settings
          </button>
        </div>
      )}
      <div className="sc-list" data-testid="shortcuts-list">
        {actions.map((a) => {
          const chords = bindingsOf(map, a.id);
          const isDefault = JSON.stringify(chords.map(chordId)) === JSON.stringify(defaultsFor(a.id).map(chordId));
          const adding = rec?.action === a.id && rec.index === -1;
          const slots: (Chord | null)[] = [...chords, ...(adding || !chords.length ? [null] : [])];
          return (
            <div className="sc-row" key={a.id}>
              <div className="sc-label">
                <div className="sc-title">
                  {a.label}
                  {a.hold && <span className="badge">Hold</span>}
                  {a.when === 'recording' && <span className="badge">While dictating</span>}
                  {a.when === 'changes' && <span className="badge">After a Transform</span>}
                </div>
                <div className="sc-desc">{a.desc}</div>
                {errors[a.id] && <div className="sc-error">{errors[a.id]}</div>}
              </div>
              <div className="sc-fields">
                {slots.map((c, i) => {
                  const idx = c ? i : -1;
                  const recording = rec?.action === a.id && rec.index === idx;
                  return (
                    <div key={i} className="sc-field-row">
                      <button
                        className={`sc-input ${recording ? 'recording' : ''}`}
                        disabled={!!rec && !recording}
                        aria-label={`${a.label} shortcut`}
                        onClick={() => (recording ? stop() : setRec({ action: a.id, index: idx }))}
                      >
                        {recording ? (
                          live.length ? (
                            <KeyChips chord={live} small />
                          ) : (
                            <span className="sc-placeholder">Press keys or a mouse button… (Esc cancels, ⌫ clears)</span>
                          )
                        ) : c ? (
                          <KeyChips chord={c} small />
                        ) : (
                          <span className="sc-placeholder">Click to add a shortcut</span>
                        )}
                        {!recording && c && <Pencil size={14} className="sc-edit" />}
                      </button>
                      {recording ? (
                        <button className="icon-btn" data-tip="Cancel" aria-label="Cancel recording" onClick={stop}>
                          <X size={16} />
                        </button>
                      ) : c && !(a.required && chords.length === 1) ? (
                        <button className="icon-btn" data-tip="Remove shortcut" aria-label="Remove shortcut" disabled={!!rec} onClick={() => save(a.id, chords.filter((_, j) => j !== i))}>
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <span className="sc-spacer" />
                      )}
                    </div>
                  );
                })}
                <div className="sc-row-tools">
                  {chords.length > 0 && chords.length < MAX_CHORDS && !adding && (
                    <button className="btn btn-ghost btn-sm" disabled={!!rec} onClick={() => setRec({ action: a.id, index: -1 })}>
                      <Plus size={14} /> Add
                    </button>
                  )}
                  {!isDefault && (
                    <button className="btn btn-ghost btn-sm" disabled={!!rec} onClick={() => resetRow(a)} data-tip="Reset to default">
                      <RotateCcw size={14} /> Default
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
