/* Persisted data model, shared by the renderer store and the Electron main process (no DOM, no React). */
import type { HotkeyMap } from './hotkeys';

export type Scope = 'personal' | 'team';
export type AppCategory = 'ai' | 'code' | 'document' | 'email' | 'work' | 'personal' | 'other';

export interface HistoryItem {
  id: string;
  ts: number;
  text: string;
  /** text as cleaned up, kept while "Undo AI edit" shows the raw transcript */
  cleaned?: string;
  /** raw transcript before clean-up (for Undo AI edit / Retry) */
  original?: string;
  status: 'ok' | 'dismissed';
  flagged?: boolean;
  /** the note written when flagging */
  flagNote?: string;
  app?: string;
  bundleId?: string;
  category?: AppCategory;
  words?: number;
  durationMs?: number;
  /** words changed by clean-up (filler words, punctuation, AI) */
  fixes?: number;
  /** dictionary + snippet replacements applied */
  dictFixes?: number;
  /** file name of the recorded WAV in the app data audio folder */
  audio?: string;
  /** cleanup engine used */
  engine?: 'claude' | 'rules';
  /** speech-to-text engine that produced the transcript */
  speech?: 'whisper' | 'apple';
}
export interface DictWord {
  id: string;
  word: string;
  misspelling?: string;
  scope: Scope;
  starred?: boolean;
  created: number;
  auto?: boolean;
}
export interface Snippet {
  id: string;
  trigger: string;
  expansion: string;
  scope: Scope;
  created: number;
}
export interface Note {
  id: string;
  title: string;
  html: string;
  updated: number;
  pinned?: boolean;
}
export interface TranscriptSegment {
  /** seconds from the start of the recording */
  t: number;
  text: string;
  /** English translation ("Translate to English") */
  tr?: string;
  /** wall-clock time the words were spoken (ms) */
  at?: number;
  /** seconds of audio this line covers */
  d?: number;
  /** "them": heard from the Mac's sound (the other side of a call); otherwise the mic ("You") */
  who?: 'them';
}
export interface SummaryBullet {
  text: string;
  sub?: string[];
}
export interface SummarySection {
  heading: string;
  bullets: SummaryBullet[];
}
export interface Meeting {
  id: string;
  title: string;
  ts: number;
  minutes: number;
  people: number;
  overview: string;
  actionItems?: string[];
  transcript?: TranscriptSegment[];
  durationSec?: number;
  summaryStatus?: 'pending' | 'done' | 'error' | 'nokey';
  summaryError?: string;
  thoughts?: string;
  shared?: boolean;
  folder?: string;
  demo?: boolean;
  /** headed sections of the summary (overview holds the one-paragraph short version) */
  sections?: SummarySection[];
  /** language Whisper detected, e.g. "french" */
  language?: string;
  /** show the English translation of the transcript */
  translated?: boolean;
  rating?: 'up' | 'down';
  /** summary progress shown in the note: 1 finishing the transcript, 2 writing the summary */
  step?: 1 | 2;
}
export interface Transform {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** legacy; shortcuts now live in State.hotkeys under `transform:<id>` */
  keys: string[];
  builtin?: boolean;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface Chat {
  id: string;
  title: string;
  updated: number;
  messages: ChatMessage[];
}
export interface VoiceProfile {
  name: string;
  description: string;
  catchphrase: string;
  peakDescription: string;
  createdAt: number;
  wordsAt: number;
}

export interface State {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  user: { firstName: string; lastName: string; email: string };
  history: HistoryItem[];
  dictionary: DictWord[];
  snippets: Snippet[];
  notes: Note[];
  meetings: Meeting[];
  transforms: Transform[];
  chats: Chat[];
  hotkeys: HotkeyMap;
  voiceProfile: VoiceProfile | null;
  dismissed: Record<string, boolean>;
  checklist: Record<string, boolean>;
  settings: Record<string, string | boolean>;
  styles: Record<string, string>;
  /** notification bookkeeping (milestones already announced) */
  announced: Record<string, boolean>;
  /** @deprecated computed from history now; kept so old exports load */
  totals?: { words: number; wpm: number; streak: number };
}

/** bundle id -> category, for Style and Insights */
const CATEGORY_RULES: [RegExp, AppCategory][] = [
  [/^(com\.apple\.MobileSMS|net\.whatsapp\.WhatsApp|ru\.keepcoder\.Telegram|org\.whispersystems\.signal-desktop|com\.facebook\.archon|com\.hnc\.Discord|jp\.naver\.line\.mac|com\.tdesktop\.Telegram)/i, 'personal'],
  [/^(com\.tinyspeck\.slackmacgap|com\.microsoft\.teams2?|us\.zoom\.xos|com\.webex\.meetingmanager|com\.linear|com\.atlassian)/i, 'work'],
  [/^(com\.apple\.mail|com\.microsoft\.Outlook|com\.readdle\.smartemail-Mac|com\.superhuman\.electron|com\.google\.Gmail|it\.bloop\.airmail2|com\.mimestream\.Mimestream|com\.canarymail\.mac)/i, 'email'],
  [/^(com\.openai\.chat|com\.anthropic\.claudefordesktop|ai\.perplexity|com\.google\.GeminiMacOS)/i, 'ai'],
  [/^(com\.microsoft\.VSCode|com\.todesktop\.230313mzl4w4u92|com\.apple\.dt\.Xcode|com\.jetbrains|dev\.zed\.Zed|com\.exafunction\.windsurf|com\.googlecode\.iterm2|com\.apple\.Terminal|dev\.warp)/i, 'code'],
  [/^(com\.apple\.iWork\.Pages|com\.microsoft\.Word|notion\.id|com\.apple\.Notes|md\.obsidian|com\.apple\.TextEdit|com\.ulyssesapp|net\.shinyfrog\.bear|com\.royelia\.royflow)/i, 'document'],
];
export function categoryFor(bundleId?: string): AppCategory {
  if (!bundleId) return 'other';
  for (const [re, c] of CATEGORY_RULES) if (re.test(bundleId)) return c;
  return 'other';
}
/** Style page tab for an app category */
export function styleKeyFor(c: AppCategory): 'personal' | 'work' | 'email' | 'other' {
  return c === 'personal' ? 'personal' : c === 'work' ? 'work' : c === 'email' ? 'email' : 'other';
}
