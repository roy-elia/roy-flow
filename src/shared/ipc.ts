/* IPC contract between the Electron main process, the preload bridge and the renderers.
   Type-only plus the channel allow-lists, so it can be bundled into main, preload and the web build. */
import type { ChatMessage, HistoryItem, Meeting, TranscriptSegment, VoiceProfile } from './types';

export type DockEdge = 'bottom' | 'left' | 'right';
export type DictationPhase = 'idle' | 'starting' | 'recording' | 'processing' | 'error';

export interface DictationStatus {
  phase: DictationPhase;
  interim?: string;
  error?: string;
  /** what is running: a dictation, or a Transform on selected text */
  kind?: 'dictation' | 'transform';
  label?: string;
  /** a line under the pill while processing a dictation (e.g. "Loading speech model…") */
  detail?: string;
}

export interface DictationResult {
  item: HistoryItem;
  pasted: boolean;
  /** why it was not pasted (e.g. accessibility permission missing) */
  reason?: string;
  /** set when the AI step failed and rules were used instead */
  note?: string;
}

export interface NavRequest {
  page?: string;
  settings?: string;
  modal?: 'help' | 'referral' | 'shortcuts' | null;
  /** open this meeting on the Notetaker page */
  meeting?: string;
  /** open the "Add" dialog on the Dictionary / Snippets page */
  add?: boolean;
}

export interface FlowBarConfig {
  show: boolean;
  dock: DockEdge;
  scratchpadInBar: boolean;
  transformsOptIn: boolean;
  /** "⌥ Space" etc. for tooltips */
  labels: { ptt: string; handsfree: string; cancel: string; notetaker: string; scratchpad: string; viewChanges: string };
  meeting: boolean;
  creatorMode: boolean;
}

export interface AccessStatus {
  accessibility: boolean;
  inputMonitoring: boolean;
  /** event tap: active = can capture and swallow keys, listen = observe only, off = not running */
  tap: 'active' | 'listen' | 'off';
  helper: boolean;
}

export interface TransformChange {
  name: string;
  before: string;
  after: string;
}

export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  calendar: string;
  location: string;
  attendees: number;
}
export interface CalendarState {
  status: 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unavailable';
  events: CalEvent[];
}

export interface MeetingStatus {
  recording: boolean;
  startedAt: number;
  title: string;
  partial: string;
  segments: TranscriptSegment[];
  error?: string;
}

export interface McpInfo {
  url: string;
  command: string;
  args: string[];
  claudeConfig: string;
  claudeInstalled: boolean;
  added: boolean;
  running: boolean;
}

/** the local Whisper engine (Settings › General › Speech engine) */
export interface WhisperStatus {
  model: 'missing' | 'downloading' | 'ready';
  /** Core ML encoder present (Neural Engine); without it whisper-server uses Metal only */
  coreml: boolean;
  /** whisper-server shipped in the app */
  binary: boolean;
  /** preparing = first start, compiling the Core ML encoder for this Mac (minutes); starting = loading (seconds) */
  server: 'stopped' | 'preparing' | 'starting' | 'running' | 'error';
  download?: { phase: 'model' | 'coreml'; done: number; total: number };
  error?: string;
  modelsDir: string;
}

export const SPEECH_ENGINES = { whisper: 'Whisper (on this Mac)', apple: 'Apple Speech' } as const;
export type SpeechEngine = keyof typeof SPEECH_ENGINES;
/** memory saver: unload the Whisper model after this long without a dictation */
export const UNLOAD_OPTIONS: Record<string, number> = { 'After 5 min': 5, 'After 15 min': 15, 'After 60 min': 60, 'Keep loaded': 0 };

export type StoreMutation =
  | { collection: 'history' | 'meetings'; op: 'add'; item: HistoryItem | Meeting }
  | { collection: 'history' | 'meetings'; op: 'patch'; id: string; patch: Partial<HistoryItem> & Partial<Meeting> };

/** renderer -> main (fire and forget) */
export interface SendChannels {
  'store:patch': Record<string, unknown>;
  'dictation:toggle': void;
  'dictation:cancel': void;
  'flowbar:interactive': boolean;
  'flowbar:ready': void;
  'hub:open': NavRequest;
  'hotkeys:record': boolean;
  'scratchpad:open': void;
  'scratchpad:close': void;
  'meeting:toggle': void;
  /** a button on a Flow Bar notice (e.g. Undo after Esc) */
  'flowbar:action': string;
  /** the Flow Bar has more than the pill to show (notes, live text, tips, diff): grow the panel window */
  'flowbar:expand': boolean;
}

/** renderer -> main (request/response) */
export interface InvokeChannels {
  'store:load': { args: void; result: { data: Record<string, unknown> | null } };
  'store:export': { args: void; result: { ok: boolean; path?: string } };
  'store:reset': { args: void; result: void };
  'access:check': { args: { prompt: boolean; listen?: boolean }; result: AccessStatus };
  'access:open': { args: { pane: 'accessibility' | 'input' | 'calendar' | 'microphone' | 'keyboard' }; result: void };
  'hotkeys:apply': { args: void; result: { tap: AccessStatus['tap']; failed: string[] } };
  'devices:get': { args: void; result: string[] };
  'app:info': { args: void; result: { version: string; packaged: boolean; fullName: string; dataDir: string } };
  'ai:status': { args: void; result: { hasKey: boolean; encryption: boolean; hint?: string } };
  'ai:setKey': { args: { key: string }; result: { ok: boolean; error?: string } };
  'ai:clearKey': { args: void; result: void };
  'ai:test': { args: void; result: { ok: boolean; error?: string; model?: string; ms?: number } };
  'ai:cleanup': { args: { id: string }; result: { ok: boolean; error?: string } };
  'ai:transform': { args: { text: string; prompt: string; name: string }; result: { ok: boolean; text?: string; error?: string } };
  'ai:ask': { args: { id: string; messages: ChatMessage[] }; result: { ok: boolean; error?: string } };
  'ai:voice': { args: void; result: { ok: boolean; profile?: VoiceProfile; error?: string } };
  'meeting:summarize': { args: { id: string }; result: { ok: boolean; error?: string } };
  'meeting:start': { args: { title?: string }; result: { ok: boolean; error?: string } };
  'meeting:stop': { args: void; result: void };
  'audio:get': { args: { file: string }; result: Uint8Array | null };
  'audio:extract': { args: { file: string; name: string }; result: { ok: boolean; path?: string } };
  'calendar:get': { args: { request: boolean }; result: CalendarState };
  'mcp:info': { args: void; result: McpInfo };
  'mcp:addClaude': { args: void; result: { ok: boolean; cancelled?: boolean; error?: string } };
  'notify:test': { args: void; result: void };
  'whisper:status': { args: void; result: WhisperStatus };
  'whisper:download': { args: void; result: { ok: boolean; error?: string } };
  /** names of the apps in /Applications, /System/Applications and ~/Applications (Focus Mode picker) */
  'apps:installed': { args: void; result: string[] };
}

/** main -> renderer */
export interface EventChannels {
  nav: NavRequest;
  'dictation:status': DictationStatus;
  'dictation:level': number;
  'dictation:result': DictationResult;
  'store:changed': Record<string, unknown>;
  'store:mutate': StoreMutation;
  'flowbar:config': FlowBarConfig;
  'flowbar:changes': TransformChange;
  /** short input-device name, shown briefly over the pill when recording starts */
  'flowbar:mic': string;
  'flowbar:note': { text: string; tone?: 'error'; action?: { id: string; label: string } };
  'access:changed': AccessStatus;
  'hotkeys:keys': string[];
  'meeting:status': MeetingStatus;
  'calendar:changed': CalendarState;
  'ai:chunk': { id: string; delta: string };
  'ai:done': { id: string; error?: string };
  toast: { text: string; tone?: 'success' | 'error' };
  'whisper:status': WhisperStatus;
}

export const SEND_CHANNELS: (keyof SendChannels)[] = ['store:patch', 'dictation:toggle', 'dictation:cancel', 'flowbar:interactive', 'flowbar:ready', 'hub:open', 'hotkeys:record', 'scratchpad:open', 'scratchpad:close', 'meeting:toggle', 'flowbar:action', 'flowbar:expand'];
export const INVOKE_CHANNELS: (keyof InvokeChannels)[] = [
  'store:load', 'store:export', 'store:reset', 'access:check', 'access:open', 'hotkeys:apply', 'devices:get', 'app:info',
  'ai:status', 'ai:setKey', 'ai:clearKey', 'ai:test', 'ai:cleanup', 'ai:transform', 'ai:ask', 'ai:voice',
  'meeting:summarize', 'meeting:start', 'meeting:stop', 'audio:get', 'audio:extract', 'calendar:get', 'mcp:info', 'mcp:addClaude', 'notify:test',
  'whisper:status', 'whisper:download', 'apps:installed',
];
export const EVENT_CHANNELS: (keyof EventChannels)[] = [
  'nav', 'dictation:status', 'dictation:level', 'dictation:result', 'store:changed', 'store:mutate', 'flowbar:config', 'flowbar:changes', 'flowbar:mic',
  'flowbar:note', 'access:changed', 'hotkeys:keys', 'meeting:status', 'calendar:changed', 'ai:chunk', 'ai:done', 'toast', 'whisper:status',
];

export interface RoyFlowBridge {
  isElectron: true;
  platform: string;
  send<K extends keyof SendChannels>(channel: K, ...payload: SendChannels[K] extends void ? [] : [SendChannels[K]]): void;
  invoke<K extends keyof InvokeChannels>(channel: K, ...args: InvokeChannels[K]['args'] extends void ? [] : [InvokeChannels[K]['args']]): Promise<InvokeChannels[K]['result']>;
  on<K extends keyof EventChannels>(channel: K, cb: (payload: EventChannels[K]) => void): () => void;
}

/** language label (as stored in settings) -> speech locale */
export const LANGUAGE_LOCALES: Record<string, string> = {
  English: 'en-US',
  French: 'fr-FR',
  Spanish: 'es-ES',
  German: 'de-DE',
  Portuguese: 'pt-BR',
  Italian: 'it-IT',
  Japanese: 'ja-JP',
};
export const LANGUAGES = Object.keys(LANGUAGE_LOCALES);
export const DEFAULT_MIC = 'Built-in mic (recommended)';

export const MODELS = { smart: 'claude-sonnet-5-5', quick: 'claude-haiku-5-5' } as const;
