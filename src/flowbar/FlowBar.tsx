import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, WandSparkles, X } from 'lucide-react';
import { applyDictionaryAndSnippets, cleanUp, getState, setState, uid, useStore, wordCount, type HistoryItem } from '../store';
import { go, setNav } from '../nav';
import { NotetakerIcon, ScratchpadIcon } from '../components/icons';
import { appendToOpenNote, newNote } from '../pages/Scratchpad';
import { runTransform } from '../pages/Transforms';

type BarState = 'resting' | 'ready' | 'recording' | 'processing' | 'polishing';
interface Note {
  text: string;
  action?: { label: string; run: () => void };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;
const SR: AnyRec = (window as AnyRec).SpeechRecognition || (window as AnyRec).webkitSpeechRecognition;

const SAMPLES = [
  'um so remind me to email the landlord about the heating btw it has been cold all week',
  'can you draft a quick note to the team saying the release moved to thursday',
  'add oat milk eggs and coffee to the shopping list',
];

export default function FlowBar() {
  const show = useStore((s) => s.settings.showFlowBar as boolean);
  const scratchInBar = useStore((s) => s.settings.scratchpadInBar as boolean);
  const optIn = useStore((s) => s.settings.transformsOptIn as boolean);
  const [state, setBar] = useState<BarState>('resting');
  const [levels, setLevels] = useState<number[]>(Array(10).fill(0.15));
  const [note, setNote] = useState<Note | null>(null);
  const [interim, setInterim] = useState('');
  const [tip, setTip] = useState<string | null>(null);
  const rec = useRef<AnyRec>(null);
  const transcript = useRef('');
  const srFailed = useRef(false);
  const startedAt = useRef(0);
  const audio = useRef<{ stream?: MediaStream; ctx?: AudioContext; raf?: number }>({});
  const noteTimer = useRef<number>(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const notify = useCallback((n: Note, ms = 4000) => {
    setNote(n);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), ms);
  }, []);

  const stopAudio = () => {
    const a = audio.current;
    if (a.raf) cancelAnimationFrame(a.raf);
    a.stream?.getTracks().forEach((t) => t.stop());
    a.ctx?.close().catch(() => {});
    audio.current = {};
    setLevels(Array(10).fill(0.15));
  };

  const fakeLevels = () => {
    const tick = () => {
      setLevels((l) => l.map((_, i) => 0.25 + Math.abs(Math.sin(Date.now() / 140 + i * 0.9)) * 0.6 * Math.random()));
      audio.current.raf = requestAnimationFrame(tick);
    };
    tick();
  };

  const start = () => {
    if (stateRef.current === 'recording' || stateRef.current === 'processing') return;
    transcript.current = '';
    srFailed.current = !SR;
    setInterim('');
    setNote(null);
    startedAt.current = Date.now();
    setBar('recording');
    if (getState().settings.sounds) beep(660);
    if (SR) {
      try {
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = 'en-US';
        r.onresult = (e: AnyRec) => {
          let fin = '';
          let inter = '';
          for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) fin += t + ' ';
            else inter += t;
          }
          transcript.current = fin;
          setInterim((fin + inter).trim());
        };
        r.onerror = (e: AnyRec) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') srFailed.current = true;
        };
        r.start();
        rec.current = r;
      } catch {
        rec.current = null;
        srFailed.current = true;
      }
    }
    fakeLevels();
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        if (stateRef.current !== 'recording') return stream.getTracks().forEach((t) => t.stop());
        if (audio.current.raf) cancelAnimationFrame(audio.current.raf);
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        audio.current = { stream, ctx };
        const tick = () => {
          an.getByteFrequencyData(buf);
          setLevels(Array.from({ length: 10 }, (_, i) => Math.max(0.15, Math.min(1, buf[i + 2] / 200))));
          audio.current.raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {});
  };

  const finish = async () => {
    if (stateRef.current !== 'recording') return;
    const r = rec.current;
    rec.current = null;
    setBar('processing');
    if (r) {
      await new Promise<void>((res) => {
        r.onend = () => res();
        try {
          r.stop();
        } catch {
          res();
        }
        window.setTimeout(res, 1200);
      });
    }
    stopAudio();
    const heard = (transcript.current || interim).trim();
    // no Web Speech support (or it failed): simulate with a sample sentence
    const raw = heard || (srFailed.current ? SAMPLES[Math.floor(Math.random() * SAMPLES.length)] : '');
    await wait(600);
    if (!raw) {
      setBar('resting');
      notify({ text: 'No speech detected. Audio is silent.' });
      return;
    }
    const s = getState();
    let text = cleanUp(applyDictionaryAndSnippets(raw));
    let used = '';
    if (s.settings.autoApply && s.settings.transformsOptIn) {
      const t = s.transforms.find((x) => x.name === s.settings.autoApplyTransform);
      if (t) {
        setBar('polishing');
        await wait(900);
        text = runTransform(t, text);
        used = t.name;
      }
    }
    const minutes = Math.max((Date.now() - startedAt.current) / 60000, 0.05);
    const words = wordCount(text);
    const item: HistoryItem = { id: uid(), ts: Date.now(), text, original: raw, status: 'ok', app: 'Roy Flow' };
    const intoNote = appendToOpenNote(text);
    setState((st) => ({
      history: [item, ...st.history],
      totals: { ...st.totals, words: st.totals.words + words, wpm: Math.round((st.totals.wpm * 9 + Math.min(220, words / minutes)) / 10) },
    }));
    navigator.clipboard?.writeText(text).catch(() => {});
    if (getState().settings.sounds) beep(880);
    setBar('resting');
    setInterim('');
    notify({
      text: `${used ? `Done with ${used}. ` : ''}${intoNote ? 'Added to your note' : 'Saved to Home and copied'}: “${text.length > 48 ? text.slice(0, 48) + '…' : text}”`,
      action: intoNote ? undefined : { label: 'View', run: () => go('home') },
    });
  };

  const cancel = () => {
    if (stateRef.current !== 'recording') return;
    try {
      rec.current?.abort();
    } catch {
      /* ignore */
    }
    rec.current = null;
    stopAudio();
    const raw = (transcript.current || interim).trim();
    setBar('resting');
    setInterim('');
    const id = uid();
    if (raw) setState((st) => ({ history: [{ id, ts: Date.now(), text: cleanUp(applyDictionaryAndSnippets(raw)), original: raw, status: 'dismissed' }, ...st.history] }));
    notify({
      text: 'Transcript cancelled',
      action: raw ? { label: 'Undo', run: () => setState((st) => ({ history: st.history.map((h) => (h.id === id ? { ...h, status: 'ok' } : h)) })) } : undefined,
    });
  };

  // keyboard: Opt+Space toggles hands-free dictation, Esc cancels
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        if (stateRef.current === 'recording') finish();
        else start();
      } else if (e.key === 'Escape' && stateRef.current === 'recording') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!show) return null;

  const rest = state === 'resting';
  const recording = state === 'recording';
  return (
    <div className="flowbar-host">
      {note && (
        <div className="fb-note" role="status">
          <span>{note.text}</span>
          {note.action && (
            <button
              onClick={() => {
                note.action!.run();
                setNote(null);
              }}
            >
              {note.action.label}
            </button>
          )}
        </div>
      )}
      {recording && interim && <div className="fb-live">{interim}</div>}
      {tip && (state === 'ready' || recording) && <div className="fb-tip">{tip}</div>}
      <div
        className="fb-hot"
        onMouseEnter={() => rest && setBar('ready')}
        onMouseLeave={() => {
          if (stateRef.current === 'ready') setBar('resting');
          setTip(null);
        }}
      >
        <div className={`fb-pill ${state}`} data-state={state}>
          {state === 'ready' && (
            <button
              className="fb-mic"
              aria-label="Dictate"
              onMouseEnter={() => setTip('Click or press ⌥ Space to dictate')}
              onMouseLeave={() => setTip(null)}
              onClick={() => {
                setTip(null);
                start();
              }}
            >
              <Mic size={16} />
            </button>
          )}
          {recording && (
            <button className="fb-round" aria-label="Cancel" onMouseEnter={() => setTip('Cancel (Esc)')} onMouseLeave={() => setTip(null)} onClick={cancel}>
              <X size={12} strokeWidth={3} />
            </button>
          )}
          {(recording || state === 'processing') && (
            <div className="fb-wave" aria-hidden>
              {levels.slice(0, state === 'processing' ? 6 : 10).map((l, i) => (
                <span key={i} style={{ height: `${Math.round(l * 16) + 2}px` }} />
              ))}
            </div>
          )}
          {state === 'processing' && <span className="fb-spinner" aria-label="Processing" />}
          {state === 'polishing' && (
            <span className="fb-polish">
              <span className="fb-progress" />
              Using Polish
            </span>
          )}
          {recording && (
            <button className="fb-round" aria-label="Finish" onMouseEnter={() => setTip('Finish and paste')} onMouseLeave={() => setTip(null)} onClick={finish}>
              <Square size={9} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
        {state === 'ready' && (
          <div className="fb-pickers">
            <button className="fb-disc" aria-label="Start Notetaker" onMouseEnter={() => setTip('Start Notetaker')} onMouseLeave={() => setTip(null)} onClick={() => go('notetaker')}>
              <NotetakerIcon size={14} />
            </button>
            {scratchInBar && (
              <button
                className="fb-disc"
                aria-label="Scratchpad"
                onMouseEnter={() => setTip('Scratchpad')}
                onMouseLeave={() => setTip(null)}
                onClick={() => setNav({ noteId: getState().notes[0]?.id ?? newNote() })}
              >
                <ScratchpadIcon size={14} />
              </button>
            )}
            {optIn && (
              <button
                className="fb-disc"
                aria-label="Transform"
                onMouseEnter={() => setTip('Transform the last dictation')}
                onMouseLeave={() => setTip(null)}
                onClick={async () => {
                  const s = getState();
                  const last = s.history.find((h) => h.status === 'ok');
                  const t = s.transforms[0];
                  if (!last || !t) return;
                  setBar('polishing');
                  await wait(900);
                  setState((st) => ({ history: st.history.map((h) => (h.id === last.id ? { ...h, original: h.original ?? h.text, text: runTransform(t, h.text) } : h)) }));
                  setBar('resting');
                  notify({ text: `Done. ${t.name} applied to your last dictation`, action: { label: 'See changes', run: () => go('home') } });
                }}
              >
                <WandSparkles size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
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
