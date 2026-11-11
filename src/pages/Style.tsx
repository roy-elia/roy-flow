import { useState } from 'react';
import { getNav, setNav } from '../nav';
import { setSetting, setState, useStore } from '../store';
import { Hero, PageFrame, Tabs } from '../components/ui';

type TabId = 'personal' | 'work' | 'email' | 'other' | 'cleanup';
const OPTIONS = [
  { id: 'formal', title: 'Formal.', sub: 'Caps + Punctuation' },
  { id: 'casual', title: 'Casual', sub: 'Caps + Less punctuation' },
  { id: 'very', title: 'very casual', sub: 'No Caps + Less punctuation' },
  { id: 'excited', title: 'Excited!', sub: 'More exclamations' },
];
const BANNER: Record<Exclude<TabId, 'cleanup'>, string> = {
  personal: 'This style applies in personal messengers',
  work: 'This style applies in workplace messengers',
  email: 'This style applies in all major email apps',
  other: 'This style applies in all other apps',
};
const SAMPLE = {
  personal: ['Are you free for lunch tomorrow? Let’s do 12 if that works for you.', 'Sounds good, see you there.'],
  work: ['Hey, the new build is ready for review. Could you take a look before the 3 pm sync?', 'On it, thanks.'],
  email: ['Hi Sam,', 'Thanks for sending the proposal over. I had a read and it looks great. Could we find 30 minutes next week to go through the budget?', 'Best,', 'Jordan'],
  other: ['Ideas for the weekend: visit the farmers market, finish the bookshelf, and call grandma.'],
};

export function styleText(t: string, style: string) {
  if (style === 'formal') return t;
  if (style === 'casual') return t.replace(/[.](?=\s|$)/g, '').replace(/,/g, '');
  if (style === 'very') return t.replace(/[.](?=\s|$)/g, '').replace(/,/g, '').toLowerCase();
  if (style === 'excited') return t.replace(/\.(?=\s|$)/g, '!');
  return t;
}

export default function Style() {
  const [tab, setTab] = useState<TabId>(() => {
    const t = getNav().styleTab as TabId | undefined;
    if (t) setNav({ styleTab: undefined });
    return t ?? 'personal';
  });
  const styles = useStore((s) => s.styles);
  const level = useStore((s) => s.settings.autoCleanup as string);
  const opts = tab === 'personal' ? OPTIONS : OPTIONS.filter((o) => o.id !== 'very');
  return (
    <PageFrame
      title="Style"
      tabs={
        <Tabs
          style={{ marginBottom: 0 }}
          tabs={[
            { id: 'personal', label: 'Personal messages' },
            { id: 'work', label: 'Work messages' },
            { id: 'email', label: 'Email' },
            { id: 'other', label: 'Other' },
            {
              id: 'cleanup',
              label: (
                <>
                  Auto cleanup <span className="badge badge-dark">Beta</span>
                </>
              ),
            },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      <div style={{ paddingTop: 24 }}>
        {tab === 'cleanup' ? (
          <>
            <Hero
              palette="paper"
              titleSize="md"
              title="Auto Cleanup tidies every dictation"
              desc="Pick how much polishing happens automatically, in every app. Your original words are always kept: use “Undo AI edit” from the ⋮ menu on any dictation on Home."
            />
            <div className="cleanup-cards">
              {[
                { id: 'None', d: 'Pastes exactly what you said (only dictionary words are fixed).', ex: 'so um I think we should move the launch to friday' },
                { id: 'Light', d: 'Removes filler words and fixes obvious slips.', ex: 'so I think we should move the launch to friday' },
                { id: 'Medium', d: 'Adds punctuation, casing and paragraph breaks.', ex: 'So I think we should move the launch to Friday.' },
                { id: 'High', d: 'Rewrites rambling sentences so they read cleanly.', ex: 'Let’s move the launch to Friday.' },
              ].map((c) => (
                <button key={c.id} className={`cleanup-card ${level === c.id ? 'selected' : ''}`} onClick={() => setSetting('autoCleanup', c.id)}>
                  <div className="serif" style={{ fontSize: 28, lineHeight: '28px' }}>
                    {c.id}
                  </div>
                  <p className="muted">{c.d}</p>
                  <div className="cleanup-ex">“{c.ex}”</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <Hero palette="paper" titleSize="md" title={BANNER[tab]} desc="Styles change punctuation and tone only. Words you say are never added or removed." />
            <div className="style-cards">
              {opts.map((o) => {
                const active = styles[tab] === o.id;
                return (
                  <button
                    key={o.id}
                    className={`style-card ${active ? 'selected' : ''}`}
                    aria-pressed={active}
                    onClick={() => setState((s) => ({ styles: { ...s.styles, [tab]: o.id } }))}
                  >
                    <div className="style-card-head">
                      <div className="style-title">{o.title}</div>
                      <div className="style-sub">{o.sub}</div>
                    </div>
                    <Preview tab={tab} style={o.id} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </PageFrame>
  );
}

function Preview({ tab, style }: { tab: Exclude<TabId, 'cleanup'>; style: string }) {
  const lines = SAMPLE[tab].map((l) => styleText(l, style));
  if (tab === 'personal')
    return (
      <div className="pv pv-chat">
        <div className="bubble me">{lines[0]}</div>
        <div className="bubble them">{lines[1]}</div>
      </div>
    );
  if (tab === 'work')
    return (
      <div className="pv pv-work">
        <div className="pv-msg">
          <span className="avatar">J</span>
          <div>
            <b>Jordan</b> <span className="muted small">10:24</span>
            <p>{lines[0]}</p>
          </div>
        </div>
        <div className="pv-msg">
          <span className="avatar b">S</span>
          <div>
            <b>Sam</b> <span className="muted small">10:25</span>
            <p>{lines[1]}</p>
          </div>
        </div>
      </div>
    );
  if (tab === 'email')
    return (
      <div className="pv pv-email">
        <div className="muted small">To: sam@example.com</div>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
          Proposal
        </div>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    );
  return (
    <div className="pv pv-email">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}
