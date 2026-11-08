/* IPC contract between the Electron main process, the preload bridge and the renderers.
   Type-only plus the channel allow-lists, so it can be bundled into main, preload and the web build. */

export type DockEdge = 'bottom' | 'left' | 'right';
export type DictationPhase = 'idle' | 'starting' | 'recording' | 'processing' | 'error';

/** the slice of the hub store that main needs (menus, pipeline, Flow Bar) */
export interface StateSnapshot {
  settings: Record<string, string | boolean>;
  dictionary: { word: string; misspelling?: string }[];
  snippets: { trigger: string; expansion: string }[];
  lastTranscript: string;
  totalWords: number;
  dictionaryCount: number;
  snippetCount: number;
  pastNotes: { id: string; title: string; ts: number }[];
  theme: 'light' | 'dark';
}

export interface DictationStatus {
  phase: DictationPhase;
  interim?: string;
  error?: string;
}

export interface DictationResult {
  text: string;
  original: string;
  words: number;
  durationMs: number;
  pasted: boolean;
  /** why it was not pasted (e.g. accessibility permission missing) */
  reason?: string;
}

export interface NavRequest {
  page?: string;
  settings?: string;
  modal?: 'help' | 'referral' | null;
}

export interface FlowBarConfig {
  show: boolean;
  dock: DockEdge;
  scratchpadInBar: boolean;
  transformsOptIn: boolean;
  shortcutLabel: string;
  sounds: boolean;
}

export interface AccessStatus {
  accessibility: boolean;
  helper: boolean;
}

/** renderer -> main (fire and forget) */
export interface SendChannels {
  'state:sync': StateSnapshot;
  'dictation:toggle': void;
  'dictation:cancel': void;
  'flowbar:interactive': boolean;
  'flowbar:ready': void;
  'hub:open': NavRequest;
  'devices:list': string[];
}

/** renderer -> main (request/response) */
export interface InvokeChannels {
  'access:check': { args: { prompt: boolean }; result: AccessStatus };
  'shortcut:set': { args: { accelerator: string }; result: { ok: boolean; error?: string } };
  'app:info': { args: void; result: { version: string; packaged: boolean } };
}

/** main -> renderer */
export interface EventChannels {
  nav: NavRequest;
  'dictation:status': DictationStatus;
  'dictation:level': number;
  'dictation:result': DictationResult;
  'devices:request': void;
  'settings:patch': { key: string; value: string | boolean };
  'flowbar:config': FlowBarConfig;
  'access:changed': AccessStatus;
}

export const SEND_CHANNELS: (keyof SendChannels)[] = ['state:sync', 'dictation:toggle', 'dictation:cancel', 'flowbar:interactive', 'flowbar:ready', 'hub:open', 'devices:list'];
export const INVOKE_CHANNELS: (keyof InvokeChannels)[] = ['access:check', 'shortcut:set', 'app:info'];
export const EVENT_CHANNELS: (keyof EventChannels)[] = ['nav', 'dictation:status', 'dictation:level', 'dictation:result', 'devices:request', 'settings:patch', 'flowbar:config', 'access:changed'];

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
export const DEFAULT_TOGGLE_SHORTCUT = 'Alt+Space';

/** Electron accelerator -> macOS glyph label, e.g. "Alt+Space" -> "⌥ Space" */
export function acceleratorLabel(acc: string): string {
  const map: Record<string, string> = { Alt: '⌥', Option: '⌥', Control: '⌃', Ctrl: '⌃', Shift: '⇧', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Super: '⌘', Meta: '⌘' };
  const parts = acc.split('+');
  return parts.map((p, i) => (i < parts.length - 1 ? map[p] ?? p : p)).join(' ').replace(/(⌥|⌃|⇧|⌘) (?=[⌥⌃⇧⌘])/g, '$1');
}
