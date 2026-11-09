import type { DictWord, HistoryItem, Meeting, Snippet, Transform } from './shared/types';

const now = Date.now();
const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const daysAgo = (n: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

/* Default settings and transforms for a fresh install, plus optional demo data
   (Settings › Data and Privacy › Load demo data). Real installs start empty. */

export function defaultSettings(): Record<string, string | boolean> {
  return {
      launchAtLogin: false,
      showFlowBar: true,
      showInDock: false,
      sounds: true,
      muteWhileDictating: false,
      suggestions: true,
      announcements: true,
      milestones: true,
      autoAddDictionary: true,
      creatorMode: false,
      notifyBefore: '1 min',
      showNextMeeting: true,
      autoStartNotetaker: false,
      maxRecording: '2 hours',
      stopWhenCallEnds: true,
      hideInCapture: false,
      liveTranscript: true,
      language: 'English',
      microphone: 'Built-in mic (recommended)',
      flowBarDock: 'Bottom',
      transformsOptIn: true,
      autoApply: false,
      autoApplyTransform: 'Polish',
      scratchpadInBar: true,
      scratchpadOpen: 'Resume last note',
      contextAwareness: true,
      codeAware: true,
      localStorage: 'Store normally',
      connected_gcal: false,
      connected_outlook: false,
      notetakerAutoPromptDismissed: false,
      autoCleanup: 'Medium',
      aiCleanup: false,
      migrated13: true,
      engine: 'whisper',
      unloadModel: 'After 15 min',
      autoLearn: true,
      focusMode: false,
      focusApps: '',
      offerNewMic: true,
    };
}

export function defaultTransforms(): Transform[] {
  return [
      {
        id: 't1',
        name: 'Polish',
        description: 'Improve clarity and conciseness',
        prompt: 'Rewrite the text so it is clearer and more concise while keeping my voice.',
        keys: [],
        builtin: true,
      },
      {
        id: 't2',
        name: 'Prompt Engineer',
        description: '**Title** (1 concise line)...',
        prompt: '**Title** (1 concise line)\n**Goal** what the model should do\n**Context** relevant details\n**Output** the format I want back',
        keys: [],
        builtin: true,
      },
    ];
}

/** ids the pre-1.1 build seeded into localStorage; dropped when migrating */
export const LEGACY_DEMO_IDS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'm1', 'm2', 'm3', 'm4', 'm5', 'd1', 'd2', 'd3', 'd4', 'd5', 's1', 's2', 's3']);

export function demoData(): { history: HistoryItem[]; dictionary: DictWord[]; snippets: Snippet[]; meetings: Meeting[] } {
  const history: HistoryItem[] = [
      { id: 'h1', ts: today(21, 43), text: 'Remind me to send the slides tonight.', status: 'dismissed' },
      {
        id: 'h2',
        ts: today(21, 27),
        original:
          'so um I want you to write up a checklist for the garden project covering like the soil the seeds watering and the tools',
        text:
          'I want you to write up a checklist for the garden project, covering everything we need before spring, including:\n- soil\n- seeds\n- watering schedule\n- raised beds\n- tools\n- compost',
        status: 'ok',
        app: 'Notes',
      },
      { id: 'h3', ts: today(21, 18), text: 'The', status: 'ok' },
      { id: 'h4', ts: today(21, 17), text: 'Okay let me try that again.', status: 'dismissed' },
      {
        id: 'h5',
        ts: today(20, 52),
        original: 'hey can we move our call to thursday afternoon works better for me',
        text: 'Hey, can we move our call to Thursday afternoon? That works better for me.',
        status: 'ok',
        app: 'Messages',
      },
      {
        id: 'h6',
        ts: daysAgo(1, 16, 4),
        text: 'Thanks for the update. I reviewed the draft and left a few comments on the second section; overall it reads really well.',
        status: 'ok',
        app: 'Mail',
      },
      {
        id: 'h7',
        ts: daysAgo(1, 11, 40),
        text: 'Summarize this article in three bullet points and suggest a title.',
        status: 'ok',
        app: 'Chat',
      },
      {
        id: 'h8',
        ts: daysAgo(3, 9, 15),
        text: 'Pick up oat milk, coffee beans, and batteries on the way home.',
        status: 'ok',
        app: 'Reminders',
      },
    ];
  const dictionary: DictWord[] = [
      { id: 'd1', word: 'Jordan Lee', scope: 'personal', created: now - 5e8 },
      { id: 'd2', word: 'Jordan', scope: 'personal', created: now - 4e8 },
      { id: 'd3', word: 'Roy Flow', scope: 'personal', created: now - 3e8 },
      { id: 'd4', word: 'by the way', misspelling: 'btw', scope: 'personal', created: now - 2e8 },
      { id: 'd5', word: 'jordan@example.com', scope: 'personal', created: now - 1e8 },
    ];
  const snippets: Snippet[] = [
      {
        id: 's1',
        trigger: 'my portfolio link',
        expansion: 'Here is my portfolio: https://example.com/jordan',
        scope: 'personal',
        created: now - 3e8,
      },
      { id: 's2', trigger: 'my email address', expansion: 'jordan@example.com', scope: 'personal', created: now - 2e8 },
      {
        id: 's3',
        trigger: 'tidy thoughts prompt',
        expansion:
          'Turn these loose notes into a short, well-ordered summary without adding anything new. Keep my wording where possible and use bullet points for lists.',
        scope: 'personal',
        created: now - 1e8,
      },
    ];
  const meetings: Meeting[] = [
      {
        id: 'm1',
        title: 'Quarterly Roadmap Sync',
        ts: daysAgo(2, 9, 18),
        minutes: 42,
        people: 5,
        overview:
          'The team agreed to trim the onboarding section to about fifteen minutes and move the analytics demo to the start. Two new templates will ship in the first release, with the rest following next month.',
      },
      {
        id: 'm2',
        title: 'Design Critique: Onboarding',
        ts: daysAgo(5, 9, 18),
        minutes: 30,
        people: 4,
        overview:
          'Reviewed the three onboarding variants. Variant B tested best; copy on step two needs to be shorter and the progress bar should show the remaining steps.',
      },
      {
        id: 'm3',
        title: 'Community Website Workshop',
        ts: daysAgo(12, 12, 0),
        minutes: 55,
        people: 3,
        overview: 'Sketched the new site map, picked a type pairing, and split the content audit between three volunteers.',
      },
      {
        id: 'm4',
        title: 'Model Benchmark Review',
        ts: daysAgo(41, 14, 30),
        minutes: 25,
        people: 6,
        overview: 'Compared latency and accuracy across four candidate models. Follow-up: rerun the long-form set with the new prompts.',
      },
      {
        id: 'm5',
        title: 'Weekly Planning',
        ts: daysAgo(3, 10, 0),
        minutes: 20,
        people: 2,
        shared: true,
        overview: 'Shared by a teammate. Priorities for the week: finish the billing page, triage support inbox, and prep the demo.',
      },
    ];
  return {
    history: history.map((h) => ({ ...h, id: `demo-${h.id}`, words: h.text.split(/\s+/).length, durationMs: h.text.split(/\s+/).length * 450 })),
    dictionary: dictionary.map((d) => ({ ...d, id: `demo-${d.id}` })),
    snippets: snippets.map((x) => ({ ...x, id: `demo-${x.id}` })),
    meetings: meetings.map((m) => ({ ...m, id: `demo-${m.id}`, demo: true, actionItems: ['Share the notes with everyone who attended'] })),
  };
}
