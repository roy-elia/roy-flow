/* The Flow Bar as it runs in its own transparent, click-through panel window (desktop app only).
   Dictation runs in the main process + native helper; this renderer only draws state and forwards clicks. */
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, WandSparkles, X } from 'lucide-react';
import { native } from '../native/bridge';
import { NotetakerIcon, ScratchpadIcon } from '../components/icons';
import { diffWords } from '../shared/textPipeline';
import type { DictationPhase, FlowBarConfig, TransformChange } from '../shared/ipc';

type Look = 'resting' | 'ready' | 'recording' | 'processing';
interface Note {
  text: string;
  tone?: 'error';
  action?: { id: string; label: string };
}
const BARS = 10;
const withKey = (text: string, key: string) => (key ? `${text} (${key})` : text);

export default function NativeFlowBar() {
  const [cfg, setCfg] = useState<FlowBarConfig>({
    show: true,
    dock: 'bottom',
    scratchpadInBar: true,
    transformsOptIn: true,
    labels: { ptt: 'fn', handsfree: '⌥ Space', cancel: 'Esc', notetaker: '⌥M', scratchpad: '', viewChanges: '⌥O' },
    meeting: false,
    creatorMode: false,
  });
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [kindLabel, setKindLabel] = useState('');
  const [hover, setHover] = useState(false);
  const [interim, setInterim] = useState('');
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0.15));
  const [note, setNote] = useState<Note | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [changes, setChanges] = useState<TransformChange | null>(null);
  const noteTimer = useRef(0);
  const [mic, setMic] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const lastPhase = useRef<DictationPhase>('idle');
  const micTimer = useRef(0);

  const notify = (n: Note, ms = 4000) => {
    setNote(n);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), ms);
  };

  useEffect(() => {
    if (!native) return;
    document.documentElement.dataset.dock = cfg.dock;
  }, [cfg.dock]);

  useEffect(() => {
    if (!native) return;
    const offs = [
      native.on('flowbar:config', setCfg),
      native.on('dictation:status', (s) => {
        setPhase(s.phase);
        setInterim(s.interim ?? '');
        setKindLabel(s.kind === 'transform' ? (s.label ?? 'Transform') : '');
        setDetail(s.phase === 'processing' ? (s.detail ?? '') : '');
        // only when a recording begins (status repeats with every live partial; notes such as "1 minute left" stay)
        if (s.phase === 'recording' && lastPhase.current !== 'recording') {
          setNote(null);
          setChanges(null);
        }
        lastPhase.current = s.phase;
        if (s.phase !== 'recording') {
          setLevels(Array(BARS).fill(0.15));
          setMic(null);
        }
        if (s.phase === 'error' && s.error) notify({ text: s.error, tone: 'error' }, 5000);
      }),
      native.on('dictation:level', (v) => {
        // scroll the waveform: newest level enters on the right, with a little per-bar jitter
        setLevels((l) => [...l.slice(1), Math.max(0.15, Math.min(1, v * (0.75 + Math.random() * 0.5)))]);
      }),
      native.on('dictation:result', (r) => {
        const t = r.item.text;
        const short = t.length > 48 ? t.slice(0, 48) + '…' : t;
        if (r.note) notify({ text: r.note, tone: 'error' }, 6000);
        else notify(r.pasted ? { text: `Pasted: “${short}”` } : { text: r.reason ?? 'Copied to the clipboard' }, r.pasted ? 3000 : 6000);
      }),
      native.on('flowbar:mic', (label) => {
        // like Wispr's "Using {mic}": only on a new session or device, and only briefly
        setMic(label);
        window.clearTimeout(micTimer.current);
        micTimer.current = window.setTimeout(() => setMic(null), 1500);
      }),
      native.on('flowbar:note', (n) => notify(n, n.action ? 6000 : n.tone === 'error' ? 6000 : 4000)),
      native.on('flowbar:changes', (c) => {
        setNote(null);
        setChanges(c);
      }),
    ];
    native.send('flowbar:ready');
    return () => offs.forEach((o) => o());
  }, []);

  // click-through everywhere except over interactive parts: toggle ignoreMouseEvents from hover
  useEffect(() => {
    if (!native) return;
    let inside = false;
    const check = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const now = !!el?.closest('[data-interactive]');
      if (now !== inside) {
        inside = now;
        native!.send('flowbar:interactive', now);
      }
    };
    const move = (e: MouseEvent) => check(e.clientX, e.clientY);
    const leave = () => {
      if (inside) {
        inside = false;
        native!.send('flowbar:interactive', false);
      }
    };
    window.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', leave);
    };
  }, []);

  // grow the panel window only while there is more than the pill to draw
  // (the short mic label fits the small bottom panel; side docks need the wider one)
  const expanded = !!(changes || note || tip || (phase === 'recording' && (interim || cfg.creatorMode || (mic && cfg.dock !== 'bottom'))) || (phase === 'processing' && (kindLabel || detail)));
  useEffect(() => {
    native?.send('flowbar:expand', expanded);
  }, [expanded]);

  const look: Look = phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : hover ? 'ready' : 'resting';
  const side = cfg.dock !== 'bottom';
  const toggle = () => native?.send('dictation:toggle');
  const L = cfg.labels;

  return (
    <div className={`flowbar-host dock-${cfg.dock}`}>
      {changes && (
        <div className="fb-changes" data-interactive role="dialog" aria-label="Transform changes">
          <div className="fb-changes-head">
            <b>{changes.name}</b>
            <span className="fb-changes-legend">
              <span className="del">removed</span> <span className="add">added</span>
            </span>
            <button className="fb-round" aria-label="Close" onClick={() => setChanges(null)}>
              <X size={12} strokeWidth={3} />
            </button>
          </div>
          <div className="fb-changes-body">
            {diffWords(changes.before, changes.after).map((d, i) => (
              <span key={i} className={d.type}>
                {d.text}
              </span>
            ))}
          </div>
        </div>
      )}
      {note && !changes && (
        <div className={`fb-note ${note.tone === 'error' ? 'error' : ''}`} role="status" data-interactive onClick={() => setNote(null)}>
          <span>{note.text}</span>
          {note.action && (
            <button
              className="fb-note-action"
              onClick={(e) => {
                e.stopPropagation();
                native?.send('flowbar:action', note.action!.id);
                setNote(null);
              }}
            >
              {note.action.label}
            </button>
          )}
        </div>
      )}
      {phase === 'recording' && mic && !note && (
        <div className="fb-mic-label" role="status">
          {mic}
        </div>
      )}
      {phase === 'recording' && interim && <div className="fb-live">{interim}</div>}
      {phase === 'recording' && cfg.creatorMode && !interim && <div className="fb-tip">Dictating with Roy Flow</div>}
      {phase === 'processing' && kindLabel && <div className="fb-tip">Running {kindLabel}…</div>}
      {phase === 'processing' && !kindLabel && detail && <div className="fb-tip">{detail}</div>}
      {tip && (look === 'ready' || look === 'recording') && <div className="fb-tip">{tip}</div>}
      <div
        className="fb-hot"
        data-interactive
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setTip(null);
        }}
      >
        <div className={`fb-pill ${look} ${cfg.meeting && look === 'resting' ? 'meeting' : ''}`} data-state={look}>
          {look === 'ready' && (
            <button
              className="fb-mic"
              aria-label="Dictate"
              onMouseEnter={() =>
                setTip(L.ptt ? `Click, or hold ${L.ptt} to dictate${L.handsfree ? ` · ${L.handsfree} hands-free` : ''}` : L.handsfree ? `Click or press ${L.handsfree} to dictate` : 'Click to dictate')
              }
              onMouseLeave={() => setTip(null)}
              onClick={() => {
                setTip(null);
                toggle();
              }}
            >
              <Mic size={16} />
            </button>
          )}
          {look === 'recording' && (
            <button className="fb-round" aria-label="Cancel" onMouseEnter={() => setTip(withKey('Cancel', L.cancel))} onMouseLeave={() => setTip(null)} onClick={() => native?.send('dictation:cancel')}>
              <X size={12} strokeWidth={3} />
            </button>
          )}
          {(look === 'recording' || look === 'processing') && (
            <div className="fb-wave" aria-hidden>
              {levels.slice(look === 'processing' ? 4 : 0).map((l, i) => (
                <span key={i} style={side ? { width: `${Math.round(l * 16) + 2}px` } : { height: `${Math.round(l * 16) + 2}px` }} />
              ))}
            </div>
          )}
          {look === 'processing' && <span className="fb-spinner" aria-label="Processing" />}
          {look === 'recording' && (
            <button className="fb-round" aria-label="Finish" onMouseEnter={() => setTip(withKey('Finish and paste', L.handsfree))} onMouseLeave={() => setTip(null)} onClick={toggle}>
              <Square size={9} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
        {look === 'ready' && (
          <div className="fb-pickers">
            <button
              className={`fb-disc ${cfg.meeting ? 'live' : ''}`}
              aria-label={cfg.meeting ? 'Stop Notetaker' : 'Start Notetaker'}
              onMouseEnter={() => setTip(withKey(cfg.meeting ? 'Stop Notetaker' : 'Start Notetaker', L.notetaker))}
              onMouseLeave={() => setTip(null)}
              onClick={() => native?.send('meeting:toggle')}
            >
              <NotetakerIcon size={14} />
            </button>
            {cfg.scratchpadInBar && (
              <button className="fb-disc" aria-label="Scratchpad" onMouseEnter={() => setTip(withKey('Scratchpad', L.scratchpad))} onMouseLeave={() => setTip(null)} onClick={() => native?.send('scratchpad:open')}>
                <ScratchpadIcon size={14} />
              </button>
            )}
            {cfg.transformsOptIn && (
              <button className="fb-disc" aria-label="Transforms" onMouseEnter={() => setTip('Transforms: select text, then press a Transform shortcut')} onMouseLeave={() => setTip(null)} onClick={() => native?.send('hub:open', { page: 'transforms' })}>
                <WandSparkles size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
