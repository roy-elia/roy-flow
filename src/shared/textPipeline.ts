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

/** a phrase as a whole-word regex that also works for phrases starting or ending in symbols (C++, .NET, e-mail) */
function phraseRe(phrase: string, suffix = ''): RegExp {
  const body = escapeRe(phrase.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])${suffix}`, 'giu');
}

/** dictionary replacements (fix misspellings and casing); returns the text and how many words changed */
export function applyDictionary(text: string, dictionary: PipelineWord[]): { text: string; count: number } {
  let out = text;
  let count = 0;
  // longest first, so "Roy Flow" wins over "Roy"
  const words = [...dictionary].filter((w) => (w.misspelling || w.word)?.trim()).sort((x, y) => (y.misspelling || y.word).length - (x.misspelling || x.word).length);
  for (const w of words) {
    out = out.replace(phraseRe(w.misspelling || w.word), (m) => {
      if (m !== w.word) count++;
      return w.word;
    });
  }
  return { text: out, count };
}

export interface SnippetVars {
  name?: string;
  first?: string;
  last?: string;
  email?: string;
}

/** fill {name} {first} {last} {email} {date} {time} placeholders in a snippet expansion */
export function fillSnippet(expansion: string, vars: SnippetVars = {}, now = new Date()): string {
  const v: Record<string, string> = {
    name: vars.name ?? [vars.first, vars.last].filter(Boolean).join(' '),
    first: vars.first ?? '',
    last: vars.last ?? '',
    email: vars.email ?? '',
    date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
  return expansion.replace(/\{(name|first|last|email|date|time)\}/gi, (m, k: string) => v[k.toLowerCase()] || m);
}

/** spoken snippet triggers -> expansions. A trigger said as its own sentence also takes its full stop with it. */
export function applySnippets(text: string, snippets: PipelineSnippet[], vars?: SnippetVars): { text: string; count: number } {
  let out = text;
  let count = 0;
  const list = [...snippets].filter((s) => s.trigger?.trim()).sort((x, y) => y.trigger.length - x.trigger.length);
  for (const sn of list) {
    out = out.replace(phraseRe(sn.trigger, '[.!?]?'), () => {
      count++;
      return fillSnippet(sn.expansion, vars);
    });
  }
  return { text: out, count };
}

/** dictionary replacements, then snippet expansion */
export function applyDictionaryAndSnippets(text: string, dictionary: PipelineWord[], snippets: PipelineSnippet[], vars?: SnippetVars): string {
  return applySnippets(applyDictionary(text, dictionary).text, snippets, vars).text;
}

/* ------------------------------------------------------------------ rule-based clean-up (no API key, or the API failed) */

/** sounds that are never words */
const HESITATIONS = /(?<![\p{L}'])(?:u+m+|u+h+m*|e+r+m+|e+r+|a+h+|h+m+|m+h*m+)(?![\p{L}'])[,.]?\s*/giu;
/** discourse fillers, only when set off by commas (so "do you know him" and "I like it" survive) */
const COMMA_FILLERS = /(^|[,.!?]\s*|\s)(?:you know|i mean|like|basically|so yeah)\s*,\s*/giu;
const TRAILING_FILLERS = /,?\s+(?:you know|i guess|or something)\s*([.!?]?)\s*$/iu;
/** "the the", "I I": a repeated word is a stutter (kept: words that legitimately repeat) */
const STUTTER = /(?<![\p{L}\p{N}])([\p{L}']+)(?:\s+\1)+(?![\p{L}\p{N}])/giu;
const KEEP_REPEATS = new Set(['that', 'had', 'is', 'very', 'really', 'no', 'bye', 'so', 'ha', 'go']);
/** "new line" / "new paragraph" said while dictating */
const SPOKEN_BREAKS = /[,.]?\s*\b(new paragraph|new line|next line)\b[,.]?\s*/giu;

function capitaliseSentences(t: string): string {
  return t
    .replace(/^(\s*)(\p{Ll})/u, (_m, sp: string, c: string) => sp + c.toUpperCase())
    .replace(/([.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/(?<![\p{L}'])i(?=$|[\s,.!?;:']|'(?:m|ll|d|ve|s)\b)/gu, 'I');
}

/** rule-based clean-up used when no Claude key is set (or the call fails). level: Light | Medium | High */
export function cleanUp(text: string, level = 'Medium'): string {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(HESITATIONS, '');
  t = t.replace(COMMA_FILLERS, (_m, lead: string) => (lead.includes(',') ? ' ' : lead));
  t = t.replace(TRAILING_FILLERS, '$1');
  t = t.replace(STUTTER, (m, w: string) => (KEEP_REPEATS.has(w.toLowerCase()) ? m : w));
  t = t.replace(SPOKEN_BREAKS, (_m, cmd: string) => (cmd.toLowerCase() === 'new paragraph' ? '\n\n' : '\n'));
  t = t
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?=[^\s\d])/g, '$1 ')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/^[,.\s]+/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
  if (!t || level === 'Light') return t;
  if (level === 'High') t = t.replace(/(?<![\p{L}])(?:basically|actually|literally|kind of|sort of|just)\s+/giu, '').replace(/\s+([,.!?])/g, '$1');
  t = capitaliseSentences(t);
  // full stop at the end of every paragraph that does not end in punctuation
  t = t
    .split('\n')
    .map((line) => (line.trim() && !/[.!?…:;,)"'”’]$/.test(line.trim()) ? line.trimEnd() + '.' : line))
    .join('\n');
  return t;
}

/** Style page choices applied without AI: formal | casual | very | excited */
export function styleText(t: string, style: string) {
  if (style === 'casual') return t.replace(/\.$/, ''); // caps, less punctuation: no final full stop
  if (style === 'very') return t.replace(/\.$/, '').replace(/,(?=\s)/g, '').toLowerCase(); // no caps, less punctuation
  if (style === 'excited') return t.replace(/\.(?=\s|$)/g, '!');
  return t;
}

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** the rule-based pass applied to a final transcript (no AI) */
export function processTranscript(raw: string, dictionary: PipelineWord[], snippets: PipelineSnippet[], level = 'Medium', vars?: SnippetVars) {
  return applySnippets(cleanUp(applyDictionary(raw, dictionary).text, level), snippets, vars).text;
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
