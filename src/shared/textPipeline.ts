/* Text pipeline shared by the web store and the Electron main process (no DOM, no React). */

export interface PipelineWord {
  word: string;
  misspelling?: string;
}
export interface PipelineSnippet {
  trigger: string;
  expansion: string;
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** dictionary replacements (fix misspellings and casing), then snippet expansion */
export function applyDictionaryAndSnippets(text: string, dictionary: PipelineWord[], snippets: PipelineSnippet[]): string {
  let out = text;
  for (const w of dictionary) {
    const from = w.misspelling || w.word;
    if (!from) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'gi'), w.word);
  }
  for (const sn of snippets) {
    if (!sn.trigger) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(sn.trigger)}\\b`, 'gi'), sn.expansion);
  }
  return out;
}

/** a light "AI clean-up": drop filler words, capitalise, end with punctuation */
export function cleanUp(text: string): string {
  let t = text.replace(/\b(um+|uh+|erm|you know|like,)\s*/gi, '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** the full pass applied to a final transcript */
export function processTranscript(raw: string, dictionary: PipelineWord[], snippets: PipelineSnippet[]) {
  return cleanUp(applyDictionaryAndSnippets(raw, dictionary, snippets));
}
