import { useMemo, useState, type ReactNode } from 'react';
import { Bot, ChevronLeft, ChevronRight, Clock, Code, File, Infinity as InfinityIcon, Mail, MessageCircle, MessageSquareText, Monitor, Share, TrendingUp } from 'lucide-react';
import { itemWords, setState, toast, useStats, useStore, type AppCategory, type HistoryItem } from '../store';
import { native } from '../native/bridge';
import { setNav, useNav } from '../nav';
import { Info, PageFrame, Tabs } from '../components/ui';

export default function Insights() {
  const tab = useNav((n) => n.insightsTab);
  return (
    <PageFrame
      title="Insights"
      maxWidth={1046}
      cta={<ShareRing color={tab === 'usage' ? 'var(--fathom)' : 'var(--chord-600)'} />}
      tabs={
        <Tabs
          tabs={[
            { id: 'usage', label: 'Your usage' },
            { id: 'voice', label: 'Your voice' },
          ]}
          value={tab}
          onChange={(t) => setNav({ insightsTab: t })}
        />
      }
    >
      {tab === 'usage' ? <Usage /> : <Voice />}
    </PageFrame>
  );
}

function ShareRing({ color }: { color: string }) {
  const stats = useStats();
  return (
    <button
      className="share-ring"
      aria-label="Share"
      onClick={() => {
        navigator.clipboard?.writeText(`My Roy Flow stats: ${stats.words.toLocaleString('en-US')} words dictated at ${stats.wpm} wpm, ${stats.streak} day streak.`);
        toast('Share text copied');
      }}
    >
      <svg viewBox="0 0 72 72" width="72" height="72">
        <defs>
          <path id="ring" d="M36,36 m-26,0 a26,26 0 1,1 52,0 a26,26 0 1,1 -52,0" />
        </defs>
        <circle cx="36" cy="36" r="35" fill="var(--background)" />
        <text fill={color} fontSize="9" fontWeight="700" letterSpacing="2.2">
          <textPath href="#ring">SHARE · SHARE · SHARE ·</textPath>
        </text>
      </svg>
      <Share size={20} className="share-icon" />
    </button>
  );
}

function Gauge({ pct }: { pct: number }) {
  // semicircle 156 x 86 (vke)
  const r = 64;
  const len = Math.PI * r;
  return (
    <svg width="156" height="86" viewBox="0 0 156 86" className="gauge">
      <path d={`M14 78 A${r} ${r} 0 0 1 142 78`} fill="none" stroke="var(--sand-600)" strokeWidth="16" strokeLinecap="round" />
      <path
        d={`M14 78 A${r} ${r} 0 0 1 142 78`}
        fill="none"
        stroke="var(--fathom-900)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={`${len * pct} ${len}`}
        style={{ transition: 'stroke-dasharray .6s' }}
      />
    </svg>
  );
}

const CAT_META: { id: AppCategory; icon: ReactNode; one: string; many: string }[] = [
  { id: 'ai', icon: <Bot size={20} />, one: 'AI prompt', many: 'AI prompts' },
  { id: 'code', icon: <Code size={20} />, one: 'coding task', many: 'coding tasks' },
  { id: 'document', icon: <File size={20} />, one: 'document', many: 'documents' },
  { id: 'email', icon: <Mail size={20} />, one: 'email', many: 'emails' },
  { id: 'work', icon: <MessageSquareText size={20} />, one: 'work message', many: 'work messages' },
  { id: 'personal', icon: <MessageCircle size={20} />, one: 'personal message', many: 'personal messages' },
  { id: 'other', icon: <InfinityIcon size={20} />, one: 'other task', many: 'other tasks' },
];

const monthWords = (h: HistoryItem[], monthOffset: number, uptoDay?: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getTime();
  const end = uptoDay ? new Date(now.getFullYear(), now.getMonth() + monthOffset, uptoDay + 1).getTime() : new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1).getTime();
  return h.filter((x) => x.ts >= start && x.ts < end).reduce((n, x) => n + itemWords(x), 0);
};

function Usage() {
  const stats = useStats();
  const history = useStore((s) => s.history);
  const ok = useMemo(() => history.filter((h) => h.status === 'ok'), [history]);
  const thisMonth = monthWords(ok, 0);
  const lastSame = monthWords(ok, -1, new Date().getDate());
  const delta = lastSame > 0 ? Math.round(((thisMonth - lastSame) / lastSame) * 100) : null;
  const cats = useMemo(() => {
    const total = ok.length || 1;
    return CAT_META.map((c) => {
      const n = ok.filter((h) => (h.category ?? 'other') === c.id).length;
      return { ...c, n, pct: Math.round((n / total) * 100) };
    }).sort((a, b) => b.n - a.n);
  }, [ok]);
  const apps = new Set(ok.map((h) => h.bundleId || h.app).filter(Boolean)).size;
  const speedup = stats.wpm ? stats.wpm / 40 : 0;
  return (
    <div className="ins-grid">
      <div className="tile">
        <div className="tile-value">{stats.wpm || '–'}</div>
        <div className="tile-sub caps">
          Words per minute <Info tip="Words dictated divided by the time you spent speaking" />
        </div>
        <div className="gauge-wrap">
          <Gauge pct={Math.min(1, stats.wpm / 160)} />
          <div className="gauge-label">
            <span className="muted">vs typing</span>
            <b>{speedup ? `${speedup.toFixed(1)}×` : '–'}</b>
          </div>
        </div>
      </div>
      <div className="tile">
        <div className="tile-value">{(stats.fixes + stats.dictFixes).toLocaleString('en-US')}</div>
        <div className="tile-sub caps">Fixes made by Flow</div>
        <div className="tile-rule" />
        <div className="fix-row">
          <span>{stats.fixes.toLocaleString('en-US')} words cleaned up</span>
          <Info tip='Filler words like "um", punctuation and other clean-up changes' />
        </div>
        <div className="fix-row">
          <span>{stats.dictFixes.toLocaleString('en-US')} dictionary fixes</span>
          <Info tip="Corrections from your dictionary and snippets" />
        </div>
      </div>
      <div className="tile span2">
        <div className="tile-head">
          <div className="tile-value">{stats.words.toLocaleString('en-US')}</div>
          {delta !== null ? (
            <span className={`badge ${delta >= 0 ? 'badge-success' : ''}`} data-tip={`Compared to ${lastSame.toLocaleString('en-US')} words by this day last month`}>
              <TrendingUp size={14} style={{ marginRight: 4 }} />
              {delta >= 0 ? '+' : ''}
              {delta}% this month
            </span>
          ) : thisMonth > 0 ? (
            <span className="badge badge-success">{thisMonth.toLocaleString('en-US')} this month</span>
          ) : null}
        </div>
        <div className="tile-sub caps">Total words dictated</div>
        <div className="tile-rule" />
        <div className="tile-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="row-gap" style={{ gap: 6 }}>
              <Monitor size={16} /> Desktop
            </div>
            <div>
              {stats.words.toLocaleString('en-US')} words · {stats.dictations.toLocaleString('en-US')} dictations
            </div>
          </div>
        </div>
      </div>
      <div className="tile span2 tall">
        <div className="tile-head">
          <div className="tile-big">Desktop usage</div>
          <div className="caps">Total apps used | {apps}</div>
        </div>
        {ok.length === 0 ? (
          <p className="muted">Dictate into a few apps and you will see where your words go.</p>
        ) : (
          <div className="bars">
            {cats.slice(0, 6).map((c, i) => (
              <div className="bar-row" key={c.id}>
                <span className="bar-icon">{c.icon}</span>
                <span className={`bar b${Math.min(i, 2)}`} style={{ width: `${Math.max(c.pct * 0.62, 7)}%` }}>
                  {c.pct}%
                </span>
                <span className="caps bar-label">
                  {c.n} {c.n === 1 ? c.one : c.many}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tile span2 tall">
        <Heatmap />
      </div>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function Heatmap() {
  const [offset, setOffset] = useState(0);
  const stats = useStats();
  const history = useStore((s) => s.history);
  const cols = 18;
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) if (h.status === 'ok') m.set(new Date(h.ts).toDateString(), (m.get(new Date(h.ts).toDateString()) ?? 0) + itemWords(h));
    return m;
  }, [history]);
  const { grid, months } = useMemo(() => {
    const today = new Date();
    const end = new Date();
    end.setDate(end.getDate() - offset * 7 * 4);
    const start = new Date(end);
    start.setDate(end.getDate() - end.getDay() - (cols - 1) * 7);
    const streakDays = new Set<string>();
    const d = new Date();
    if (!perDay.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (perDay.has(d.toDateString())) {
      streakDays.add(d.toDateString());
      d.setDate(d.getDate() - 1);
    }
    const grid: { date: Date; lvl: number; words: number; future: boolean; streak: boolean }[][] = [];
    const months: { col: number; label: string }[] = [];
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < 7; r++) {
        const day = new Date(start);
        day.setDate(start.getDate() + c * 7 + r);
        const words = perDay.get(day.toDateString()) ?? 0;
        const lvl = words === 0 ? 0 : words < 100 ? 1 : words < 400 ? 2 : words < 1000 ? 3 : 4;
        col.push({ date: day, lvl, words, future: day > today, streak: streakDays.has(day.toDateString()) });
        if (r === 0 && day.getDate() <= 7) months.push({ col: c, label: day.toLocaleDateString('en-US', { month: 'short' }) });
      }
      grid.push(col);
    }
    return { grid, months };
  }, [offset, perDay]);
  return (
    <>
      <div className="tile-head">
        <div className="tile-big">
          {stats.streak} day streak
        </div>
        <div className="caps">Longest streak | {stats.longestStreak} days</div>
      </div>
      <div className="heat">
        <div className="heat-months">
          <button className="icon-btn" aria-label="Earlier" onClick={() => setOffset(offset + 1)}>
            <ChevronLeft size={18} />
          </button>
          <div className="heat-month-labels">
            {months.map((m) => (
              <span key={m.col} style={{ left: m.col * 24 }}>
                {m.label}
              </span>
            ))}
          </div>
          <button className="icon-btn" aria-label="Later" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="heat-body">
          <div className="heat-days">
            {DAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="heat-cols">
            {grid.map((col, c) => (
              <div className="heat-col" key={c}>
                {col.map((cell) => (
                  <span
                    key={cell.date.toISOString()}
                    className={`cell l${cell.future ? 'f' : cell.lvl} ${cell.streak ? 'streak' : ''}`}
                    data-tip={`${cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${cell.words.toLocaleString('en-US')} words`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="heat-legend">
          <span className="muted">More</span>
          <span className="cell l4" />
          <span className="cell l3" />
          <span className="cell l2" />
          <span className="cell l1" />
          <span className="muted">Less</span>
          <span style={{ flex: 1 }} />
          <span className="cell streak lf big" />
          <span className="muted">Current streak</span>
        </div>
      </div>
    </>
  );
}

const VOICE_UNLOCK = 2000;
const VOICE_STEP = 10000;
const STOP = new Set('the a an and or but to of in on at for with is are was were be been it this that i you we they he she my your our me us so just not do did have has had will would can could as if from by about up out then than there here what when how all some no yes okay ok um uh like'.split(' '));

function Voice() {
  const stats = useStats();
  const profile = useStore((s) => s.voiceProfile);
  const history = useStore((s) => s.history);
  const dictionary = useStore((s) => s.dictionary);
  const [busy, setBusy] = useState(false);
  const local = useMemo(() => {
    const counts = new Map<string, number>();
    const byTime = new Map<string, number>();
    for (const h of history) {
      if (h.status !== 'ok') continue;
      for (const w of h.text.toLowerCase().match(/[\p{L}']+/gu) ?? []) if (!STOP.has(w) && w.length > 2) counts.set(w, (counts.get(w) ?? 0) + 1);
      const d = new Date(h.ts);
      const k = `${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toLowerCase()}`;
      byTime.set(k, (byTime.get(k) ?? 0) + itemWords(h));
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const peak = [...byTime.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const corrected = [...dictionary].filter((d) => d.auto || d.misspelling).sort((a, b) => b.created - a.created)[0]?.word ?? '';
    return { top, peak, corrected };
  }, [history, dictionary]);

  const generate = async () => {
    if (!native) return toast('Voice profiles are generated by the desktop app', { tone: 'error' });
    setBusy(true);
    const r = await native.invoke('ai:voice');
    setBusy(false);
    if (!r.ok || !r.profile) return toast(r.error ?? 'Could not create your voice profile', { tone: 'error' });
    setState({ voiceProfile: r.profile });
    toast('Voice profile updated');
  };

  if (!profile || stats.words < VOICE_UNLOCK) {
    const pct = Math.min(1, stats.words / VOICE_UNLOCK);
    return (
      <div className="voice">
        <div className="voice-progress">
          <div className="vp-track">
            <div style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <div className="vp-labels">
            <span>
              {stats.words.toLocaleString('en-US')} of {VOICE_UNLOCK.toLocaleString('en-US')} words
            </span>
            <span className="muted row-gap" style={{ gap: 6 }}>
              {pct < 1 ? `Your voice profile unlocks in ${(VOICE_UNLOCK - stats.words).toLocaleString('en-US')} more words` : 'Ready to create your voice profile'}
            </span>
          </div>
        </div>
        <div className="voice-hero">
          <div>
            <h2 className="serif voice-title">{pct < 1 ? 'Still listening' : 'Meet your voice'}</h2>
            <div className="caps">Voice profile</div>
            <p className="voice-desc">
              Once you have dictated {VOICE_UNLOCK.toLocaleString('en-US')} words, Claude reads your recent dictations and describes how you talk: your habits, your catchphrase and when you do your best thinking.
            </p>
            {pct >= 1 && (
              <button className="btn btn-primary" disabled={busy} onClick={generate} style={{ marginTop: 16 }}>
                {busy ? 'Creating…' : 'Create my voice profile'}
              </button>
            )}
          </div>
          <VoiceArt />
        </div>
      </div>
    );
  }
  const next = profile.wordsAt + VOICE_STEP;
  return (
    <div className="voice">
      <div className="voice-progress">
        <div className="vp-track">
          <div style={{ width: `${Math.min(100, Math.round(((stats.words - profile.wordsAt) / VOICE_STEP) * 100))}%` }} />
        </div>
        <div className="vp-labels">
          <span>Created {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span className="muted row-gap" style={{ gap: 6 }}>
            {stats.words >= next ? (
              <button className="link" disabled={busy} onClick={generate}>
                {busy ? 'Updating…' : 'Update now'}
              </button>
            ) : (
              <>Next update in {(next - stats.words).toLocaleString('en-US')} more words</>
            )}
          </span>
        </div>
      </div>
      <div className="voice-hero">
        <div>
          <h2 className="serif voice-title">{profile.name}</h2>
          <div className="caps">Voice profile</div>
          <p className="voice-desc">{profile.description}</p>
        </div>
        <VoiceArt />
      </div>
      <div className="voice-grid">
        <div className="voice-col">
          {[
            [profile.catchphrase ? `“${profile.catchphrase}”` : '–', 'Catchphrase'],
            [local.top ? `“${local.top}”` : '–', 'Most used word'],
            [local.corrected ? `“${local.corrected}”` : '–', 'Most recently corrected word'],
          ].map(([v, l]) => (
            <div className="voice-card" key={l}>
              <div className="serif">{v}</div>
              <div className="caps">{l}</div>
            </div>
          ))}
        </div>
        <div className="voice-card peak">
          <span className="app-tile">
            <Clock size={18} />
          </span>
          <div className="serif voice-peak">{local.peak || '–'}</div>
          <div className="caps">Your peak time</div>
          <p className="voice-desc">{profile.peakDescription}</p>
        </div>
      </div>
    </div>
  );
}

function VoiceArt() {
  return (
    <svg width="190" height="190" viewBox="0 0 190 190" aria-hidden className="voice-art">
      <rect x="70" y="20" width="100" height="90" rx="10" fill="var(--fathom-950)" transform="rotate(-6 120 65)" />
      <rect x="92" y="44" width="10" height="44" rx="5" fill="#ff6c4c" />
      <rect x="110" y="58" width="10" height="30" rx="5" fill="#ffa946" />
      <rect x="128" y="36" width="10" height="52" rx="5" fill="var(--lumen-400)" />
      <circle cx="58" cy="78" r="30" fill="#ff6c4c" />
      <path d="M28 180c0-46 22-70 46-70s40 20 40 70z" fill="var(--lumen-400)" stroke="var(--vast-950)" strokeWidth="3" />
      <path d="M92 130c18-10 30-28 34-44" fill="none" stroke="var(--vast-950)" strokeWidth="10" strokeLinecap="round" />
      <path d="M92 130c18-10 30-28 34-44" fill="none" stroke="var(--lumen-400)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
