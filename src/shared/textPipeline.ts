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

/** dictionary replacements (fix misspellings and casing); returns the text and how many words changed */
export function applyDictionary(text: string, dictionary: PipelineWord[]): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const w of dictionary) {
    const from = w.misspelling || w.word;
    if (!from) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'gi'), (m) => {
      if (m !== w.word) count++;
      return w.word;
    });
  }
  return { text: out, count };
}

export function applySnippets(text: string, snippets: PipelineSnippet[]): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const sn of snippets) {
    if (!sn.trigger) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(sn.trigger)}\\b[.!?]?`, 'gi'), () => {
      count++;
      return sn.expansion;
    });
  }
  return { text: out, count };
}

/** dictionary replacements, then snippet expansion */
export function applyDictionaryAndSnippets(text: string, dictionary: PipelineWord[], snippets: PipelineSnippet[]): string {
  return applySnippets(applyDictionary(text, dictionary).text, snippets).text;
}

const FILLERS = /\b(um+|uh+|erm+|hmm+|you know,?|i mean,?|like,)\s*/gi;

/** rule-based clean-up used when no Claude key is set (or the call fails). level: Light | Medium | High */
export function cleanUp(text: string, level = 'Medium'): string {
  let t = text.replace(FILLERS, '').replace(/\b(\w+) \1\b/gi, '$1').replace(/\s+/g, ' ').trim();
  if (!t || level === 'Light') return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/\bi\b/g, 'I');
  if (!/[.!?…:]$/.test(t)) t += '.';
  if (level === 'High') t = t.replace(/\b(basically|actually|literally|kind of|sort of|just)\s+/gi, '').replace(/\s+([,.!?])/g, '$1');
  return t;
}

/** Style page choices applied without AI: formal | casual | very | excited */
export function styleText(t: string, style: string) {
  if (style === 'casual') return t.replace(/[.](?=\s|$)/g, '').replace(/,/g, '');
  if (style === 'very') return t.replace(/[.](?=\s|$)/g, '').replace(/,/g, '').toLowerCase();
  if (style === 'excited') return t.replace(/\.(?=\s|$)/g, '!');
  return t;
}

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** the rule-based pass applied to a final transcript (no AI) */
export function processTranscript(raw: string, dictionary: PipelineWord[], snippets: PipelineSnippet[], level = 'Medium') {
  return applySnippets(cleanUp(applyDictionary(raw, dictionary).text, level), snippets).text;
}

/* ------------------------------------------------------------------ word diff */
export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };
const tokenize = (s: string) => s.split(/(\s+)/).filter((x) => x.length);

/** word-level LCS diff (tokens keep their whitespace so the result can be rendered inline) */
export function diffWords(a: string, b: string): DiffOp[] {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.length * B.length > 4_000_000) return [{ type: 'del', text: a }, { type: 'add', text: b }];
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) push('same', A[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('add', B[j++]);
  return out;
}

/** count of words that differ between two versions */
export function changedWords(a: string, b: string): number {
  return diffWords(a, b)
    .filter((d) => d.type !== 'same')
    .reduce((n, d) => n + wordCount(d.text), 0);
}

const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
/** word substitutions a user made by hand: candidates for the dictionary (one-to-one replacements only) */
export function correctedWords(before: string, after: string): { word: string; misspelling?: string }[] {
  const ops = diffWords(before, after).filter((d) => d.text.trim() || d.type === 'same');
  const out: { word: string; misspelling?: string }[] = [];
  for (let k = 0; k < ops.length - 1; k++) {
    const del = ops[k];
    const add = ops[k + 1];
    if (del.type !== 'del' || add.type !== 'add') continue;
    const from = del.text.trim().split(/\s+/).map(strip).filter(Boolean);
    const to = add.text.trim().split(/\s+/).map(strip).filter(Boolean);
    if (from.length !== to.length || to.length > 3) continue;
    const word = to.join(' ');
    const mis = from.join(' ');
    if (!word || word.length < 2 || word === mis) continue;
    out.push(word.toLowerCase() === mis.toLowerCase() ? { word } : { word, misspelling: mis });
  }
  return out;
}
