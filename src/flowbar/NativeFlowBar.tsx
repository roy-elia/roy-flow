/* The Flow Bar as it runs in its own transparent, click-through panel window (desktop app only).
   Dictation runs in the main process + native helper; this renderer only draws state and forwards clicks. */
import { type CSSProperties, useEffect, useRef, useState } from 'react';
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
  const [handsFree, setHandsFree] = useState(false);
  const leaveTimer = useRef(0);
  /** pointer over the bar: opens at once, closes after a short grace period (crossing gaps between buttons) */
  const setPointerOver = (over: boolean) => {
    window.clearTimeout(leaveTimer.current);
    if (over) setHover(true);
    else
      leaveTimer.current = window.setTimeout(() => {
        setHover(false);
        setTip(null);
      }, 250);
  };
  const drag = useRef<{ x: number; y: number; moving: boolean } | null>(null);
  const dragged = useRef(false);
  /** Wispr's waveform: the level is smoothed every frame (v = .85v + .15·target) into --audio-scale on the wave */
  const waveRef = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const [note, setNote] = useState<Note | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [changes, setChanges] = useState<TransformChange | null>(null);
  const noteTimer = useRef(0);
  const lastPhase = useRef<DictationPhase>('idle');

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
        if (s.phase === 'recording') setHandsFree(!!s.handsFree);
        setKindLabel(s.kind === 'transform' ? (s.label ?? 'Transform') : '');
        // only when a recording begins (status repeats with every live partial; notes such as "1 minute left" stay)
        if (s.phase === 'recording' && lastPhase.current !== 'recording') {
          setNote(null);
          setChanges(null);
        }
        lastPhase.current = s.phase;
        if (s.phase !== 'recording') {
          target.current = 0;
        }
        if (s.phase === 'error' && s.error) notify({ text: s.error, tone: 'error' }, 5000);
      }),
      native.on('dictation:level', (v) => {
        target.current = Math.max(0, Math.min(1, v));
      }),
      native.on('dictation:result', (r) => {
        // like Wispr: a successful paste needs no message; only problems are shown
        if (r.note) notify({ text: r.note, tone: 'error' }, 6000);
        else if (!r.pasted) notify({ text: r.reason ?? 'Copied to the clipboard' }, 6000);
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
      // hover follows where the pointer really is (enter/leave events also fire when the window switches
      // between click-through and interactive, which collapsed the bar under a resting pointer)
      setPointerOver(!!el?.closest('.fb-hot'));
    };
    const move = (e: MouseEvent) => check(e.clientX, e.clientY);
    const leave = (e: MouseEvent) => {
      // the pointer really left the window (not a click-through switch): no element under it any more
      if (e.relatedTarget === null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
        setPointerOver(false);
        if (inside) {
          inside = false;
          native!.send('flowbar:interactive', false);
        }
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseover', move);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseover', move);
      document.removeEventListener('mouseleave', leave);
    };
  }, []);

  // grow the panel window only while there is more than the pill to draw
  const expanded = !!(changes || note || (phase === 'recording' && cfg.creatorMode) || (phase === 'processing' && kindLabel));
  useEffect(() => {
    native?.send('flowbar:expand', expanded);
  }, [expanded]);

  // smooth the mic level every frame while the waveform is on screen (no React re-render per frame)
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'processing') return;
    let v = 0;
    let raf = 0;
    const tick = () => {
      v = 0.85 * v + 0.15 * (phase === 'recording' ? target.current : 0);
      waveRef.current?.style.setProperty('--audio-scale', String(Math.max(1, 5 * v)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const look: Look = phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : hover ? 'ready' : 'resting';
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
      {phase === 'recording' && cfg.creatorMode && <div className="fb-tip">Dictating with Roy Flow</div>}
      {phase === 'processing' && kindLabel && <div className="fb-tip">Running {kindLabel}…</div>}
      {tip && (look === 'ready' || look === 'recording') && <div className="fb-tip">{tip}</div>}
      <div
        className="fb-hot"
        data-interactive
        onMouseEnter={() => setPointerOver(true)}
        onPointerDown={(e) => {
          // drag to move (Wispr): only from the bar itself, with the left button
          if (e.button !== 0 || phase !== 'idle') return;
          drag.current = { x: e.screenX, y: e.screenY, moving: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.moving || Math.hypot(e.screenX - d.x, e.screenY - d.y) < 5) return;
          d.moving = true;
          setTip(null);
          native?.send('flowbar:drag', 'start');
        }}
        onPointerUp={() => {
          if (drag.current?.moving) native?.send('flowbar:drag', 'end');
          dragged.current = !!drag.current?.moving;
          drag.current = null;
        }}
        onClickCapture={(e) => {
          // the click that ends a drag must not start a dictation
          if (dragged.current) {
            e.stopPropagation();
            dragged.current = false;
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          native?.send('flowbar:menu');
        }}
      >
        <div className={`fb-pill ${look} ${look === 'recording' && handsFree ? 'handsfree' : ''} ${cfg.meeting && look === 'resting' ? 'meeting' : ''}`} data-state={look}>
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
          {(look === 'recording' || look === 'processing') && (
            <div ref={waveRef} className={`fb-wave ${look === 'recording' ? 'live' : ''}`} aria-hidden>
              {Array.from({ length: BARS }, (_, i) => {
                // Wispr's shape: tallest in the middle; the wave animation runs outwards from the centre
                const d = Math.abs((BARS - 1) / 2 - i);
                const style = { '--bar-height-scale': Math.max(0, 1 - (d * d) / 48), animationDelay: `${0.1 * (i < BARS / 2 ? i : i - BARS)}s` } as CSSProperties;
                return <span key={i} style={style} />;
              })}
            </div>
          )}
          {look === 'processing' && (
            <span className="fb-spinner" aria-label="Processing">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ transform: `rotate(${45 * i}deg) translate(0, -6px)`, animationDelay: `${-0.1375 * (7 - i)}s` }} />
              ))}
            </span>
          )}
          {look === 'recording' && handsFree && (
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
