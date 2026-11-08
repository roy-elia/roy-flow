/* The Flow Bar as it runs in its own transparent, click-through panel window (desktop app only).
   Dictation runs in the main process + native helper; this renderer only draws state and forwards clicks. */
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, WandSparkles, X } from 'lucide-react';
import { native } from '../native/bridge';
import { NotetakerIcon, ScratchpadIcon } from '../components/icons';
import type { DictationPhase, FlowBarConfig } from '../shared/ipc';

type Look = 'resting' | 'ready' | 'recording' | 'processing';
interface Note {
  text: string;
  tone?: 'error';
}
const BARS = 10;

export default function NativeFlowBar() {
  const [cfg, setCfg] = useState<FlowBarConfig>({ show: true, dock: 'bottom', scratchpadInBar: true, transformsOptIn: true, shortcutLabel: '⌥ Space', sounds: true });
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [hover, setHover] = useState(false);
  const [interim, setInterim] = useState('');
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0.15));
  const [note, setNote] = useState<Note | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const noteTimer = useRef(0);
  const phaseRef = useRef(phase);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

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
        const prev = phaseRef.current;
        phaseRef.current = s.phase;
        setPhase(s.phase);
        setInterim(s.interim ?? '');
        if (s.phase === 'recording' && prev !== 'recording') {
          setNote(null);
          if (cfgRef.current.sounds) beep(660);
        }
        if (s.phase !== 'recording') setLevels(Array(BARS).fill(0.15));
        if (s.phase === 'error' && s.error) notify({ text: s.error, tone: 'error' });
      }),
      native.on('dictation:level', (v) => {
        // scroll the waveform: newest level enters on the right, with a little per-bar jitter
        setLevels((l) => [...l.slice(1), Math.max(0.15, Math.min(1, v * (0.75 + Math.random() * 0.5)))]);
      }),
      native.on('dictation:result', (r) => {
        if (cfgRef.current.sounds) beep(880);
        const short = r.text.length > 48 ? r.text.slice(0, 48) + '…' : r.text;
        notify(r.pasted ? { text: `Pasted: “${short}”` } : { text: r.reason ?? 'Copied to the clipboard' }, r.pasted ? 3000 : 6000);
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

  const look: Look = phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : hover ? 'ready' : 'resting';
  const side = cfg.dock !== 'bottom';
  const toggle = () => native?.send('dictation:toggle');
  const open = (page: string) => native?.send('hub:open', { page });

  return (
    <div className={`flowbar-host dock-${cfg.dock}`}>
      {note && (
        <div className={`fb-note ${note.tone === 'error' ? 'error' : ''}`} role="status" data-interactive onClick={() => setNote(null)}>
          <span>{note.text}</span>
        </div>
      )}
      {phase === 'recording' && interim && <div className="fb-live">{interim}</div>}
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
        <div className={`fb-pill ${look}`} data-state={look}>
          {look === 'ready' && (
            <button
              className="fb-mic"
              aria-label="Dictate"
              onMouseEnter={() => setTip(`Click or press ${cfg.shortcutLabel} to dictate`)}
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
            <button className="fb-round" aria-label="Cancel" onMouseEnter={() => setTip('Cancel (Esc)')} onMouseLeave={() => setTip(null)} onClick={() => native?.send('dictation:cancel')}>
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
            <button className="fb-round" aria-label="Finish" onMouseEnter={() => setTip('Finish and paste')} onMouseLeave={() => setTip(null)} onClick={toggle}>
              <Square size={9} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
        {look === 'ready' && (
          <div className="fb-pickers">
            <button className="fb-disc" aria-label="Start Notetaker" onMouseEnter={() => setTip('Start Notetaker')} onMouseLeave={() => setTip(null)} onClick={() => open('notetaker')}>
              <NotetakerIcon size={14} />
            </button>
            {cfg.scratchpadInBar && (
              <button className="fb-disc" aria-label="Scratchpad" onMouseEnter={() => setTip('Scratchpad')} onMouseLeave={() => setTip(null)} onClick={() => open('scratchpad')}>
                <ScratchpadIcon size={14} />
              </button>
            )}
            {cfg.transformsOptIn && (
              <button className="fb-disc" aria-label="Transforms" onMouseEnter={() => setTip('Transforms')} onMouseLeave={() => setTip(null)} onClick={() => open('transforms')}>
                <WandSparkles size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => ctx.close();
  } catch {
    /* no audio */
  }
}
