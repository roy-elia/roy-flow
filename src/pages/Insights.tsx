import { useMemo, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, File, Infinity as InfinityIcon, Mail, MessageCircle, MessageSquareText, Monitor, Share, TrendingUp } from 'lucide-react';
import { toast, useStore } from '../store';
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
  return (
    <button
      className="share-ring"
      aria-label="Share"
      onClick={() => {
        navigator.clipboard?.writeText('My Roy Flow insights: 27,900 words dictated at 120 wpm.');
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

const CATS = [
  { icon: <Bot size={20} />, pct: 93, label: '376 AI prompts' },
  { icon: <InfinityIcon size={20} />, pct: 7, label: '46 other tasks' },
  { icon: <File size={20} />, pct: 0, label: '1 documents' },
  { icon: <Mail size={20} />, pct: 0, label: '0 emails' },
  { icon: <MessageSquareText size={20} />, pct: 0, label: '0 work messages' },
  { icon: <MessageCircle size={20} />, pct: 0, label: '0 personal messages' },
];

function Usage() {
  const totals = useStore((s) => s.totals);
  const dict = useStore((s) => s.dictionary.length);
  return (
    <div className="ins-grid">
      <div className="tile">
        <div className="tile-value">{totals.wpm}</div>
        <div className="tile-sub caps">
          Words per minute <Info tip="Compared to global typing speeds" />
        </div>
        <div className="gauge-wrap">
          <Gauge pct={0.96} />
          <div className="gauge-label">
            <span className="muted">Top</span>
            <b>0.8%</b>
          </div>
        </div>
      </div>
      <div className="tile">
        <div className="tile-value">1,655</div>
        <div className="tile-sub caps">Fixes made by Flow</div>
        <div className="tile-rule" />
        <div className="fix-row">
          <span>842 words corrected</span>
          <Info tip='Filler words like "um" and other small corrections' />
        </div>
        <div className="fix-row">
          <span>{813 + dict - 5} dictionary fixes</span>
          <Info tip="Corrections from your snippets and dictionary" />
        </div>
      </div>
      <div className="tile span2">
        <div className="tile-head">
          <div className="tile-value">{totals.words.toLocaleString()}</div>
          <span className="badge badge-success" data-tip="Compared to 3,950 words this time last month">
            <TrendingUp size={14} style={{ marginRight: 4 }} />
            606% this month
          </span>
        </div>
        <div className="tile-sub caps">Total words dictated</div>
        <div className="tile-rule" />
        <div className="tile-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="row-gap" style={{ gap: 6 }}>
              <Monitor size={16} /> Desktop
            </div>
            <div>{totals.words.toLocaleString()} words</div>
          </div>
          <button className="btn btn-outline" onClick={() => toast('A mobile version is not part of this build')}>
            Download on mobile
          </button>
        </div>
      </div>
      <div className="tile span2 tall">
        <div className="tile-head">
          <div className="tile-big">Desktop usage</div>
          <div className="caps">Total apps used | 17</div>
        </div>
        <div className="bars">
          {CATS.map((c, i) => (
            <div className="bar-row" key={c.label}>
              <span className="bar-icon">{c.icon}</span>
              <span className={`bar b${Math.min(i, 2)}`} style={{ width: `${Math.max(c.pct * 0.62, 7)}%` }}>
                {c.pct}%
              </span>
              <span className="caps bar-label">{c.label}</span>
            </div>
          ))}
        </div>
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
  const cols = 18;
  const { grid, months } = useMemo(() => {
    const end = new Date();
    end.setDate(end.getDate() - offset * 7 * 4);
    const start = new Date(end);
    start.setDate(end.getDate() - end.getDay() - (cols - 1) * 7);
    const grid: { date: Date; lvl: number; future: boolean; streak: boolean }[][] = [];
    const months: { col: number; label: string }[] = [];
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(start);
        d.setDate(start.getDate() + c * 7 + r);
        const seed = Math.sin(d.getTime() / 8.64e7) * 10000;
        const rnd = seed - Math.floor(seed);
        const lvl = rnd > 0.9 ? 4 : rnd > 0.82 ? 3 : rnd > 0.72 ? 2 : rnd > 0.62 ? 1 : 0;
        const today = new Date();
        const diff = Math.round((today.getTime() - d.getTime()) / 8.64e7);
        col.push({ date: d, lvl: diff < 2 && diff >= 0 ? 3 : lvl, future: d > today, streak: offset === 0 && diff >= 0 && diff < 2 });
        if (r === 0 && d.getDate() <= 7) months.push({ col: c, label: d.toLocaleDateString('en-US', { month: 'short' }) });
      }
      grid.push(col);
    }
    return { grid, months };
  }, [offset]);
  return (
    <>
      <div className="tile-head">
        <div className="tile-big">2 day streak</div>
        <div className="caps">Longest streak | 6 days</div>
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
                    data-tip={`${cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${cell.lvl * 380} words`}
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

function Voice() {
  return (
    <div className="voice">
      <div className="voice-progress">
        <div className="vp-track">
          <div style={{ width: '64%' }} />
        </div>
        <div className="vp-labels">
          <span>Created Nov 8, 2026</span>
          <span className="muted row-gap" style={{ gap: 6 }}>
            Next update in 10,000 more words <Info tip="Unlock this with your next milestone." />
          </span>
        </div>
      </div>
      <div className="voice-hero">
        <div>
          <h2 className="serif voice-title">Thorough Tinkerer</h2>
          <div className="caps">Voice profile</div>
          <p className="voice-desc">
            You talk things through in detail, breaking big projects into lists and checking every step before moving on. Your dictations read like a careful plan
            that someone else could pick up and follow.
          </p>
        </div>
        <VoiceArt />
      </div>
      <div className="voice-grid">
        <div className="voice-col">
          {[
            ['“Let me think about that”', 'Catchphrase'],
            ['“the”', 'Most used word'],
            ['“tomorrow”', 'Most corrected word'],
          ].map(([v, l]) => (
            <div className="voice-card" key={l}>
              <div className="serif blurred">{v}</div>
              <div className="caps">{l}</div>
            </div>
          ))}
        </div>
        <div className="voice-card peak">
          <span className="app-tile">AI</span>
          <div className="serif voice-peak">Sunday at 11pm</div>
          <div className="caps">Your peak time &amp; place</div>
          <p className="voice-desc">Late Sunday evenings are when you plan the week ahead, mostly talking to your AI assistant to sort ideas into next steps.</p>
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
