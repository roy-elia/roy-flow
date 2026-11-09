/* Auto-learn (ported from RoyFlow's dictation/learn.js): after a dictation is pasted, main reads the text field
   again a little later. If the user corrected a word we got wrong ("roy flow" -> "RoyFlow", "Dominik" -> "Dominic"),
   the corrected spelling is added to the dictionary.

   Only small, word-for-word fixes count: a replaced word must look like the original (similar letters) and the edit
   must touch at most a few words, so ordinary typing after a dictation is not mistaken for a correction. */

/** when main looks at the field again after a paste (and once more just before the next dictation) */
export const LEARN_CHECK_AFTER_MS = [6000, 15000, 30000];
const MAX_CHANGED = 3;

const words = (t: string): string[] => t.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) || [];

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** multiset difference a - b */
function minus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const w of b) left.set(w, (left.get(w) || 0) + 1);
  const out: string[] = [];
  for (const w of a) {
    const n = left.get(w) || 0;
    if (n) left.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

export interface Correction {
  /** the corrected spelling to add to the dictionary */
  word: string;
  /** what was pasted instead (used as the dictionary entry's misspelling) */
  misspelling: string;
}

/** given what was pasted and the field before/after, the corrected words with what they replaced */
export function correctionPairs(pasted: string, before: string | null | undefined, after: string | null | undefined): Correction[] {
  if (before == null || after == null || before === after) return [];
  const pastedWords = words(pasted);
  const removed = minus(words(before), words(after)).filter((w) => pastedWords.includes(w));
  const added = minus(words(after), words(before));
  if (!removed.length || !added.length || removed.length > MAX_CHANGED || added.length > MAX_CHANGED) return [];
  // "roy flow" -> "RoyFlow": two removed words joined into one added word.
  const joinedPair = removed.length === 2 && added.length === 1;
  const joined = joinedPair ? [removed.join('')] : removed;
  const out: Correction[] = [];
  for (const a of added) {
    if (a.length < 3) continue;
    const special = /[A-Z]/.test(a.slice(1)) || /^[A-Z]/.test(a) || /\d/.test(a); // names, brands, jargon
    const best = joined.map((r) => ({ r, d: lev(r.toLowerCase(), a.toLowerCase()) / Math.max(r.length, a.length) })).sort((x, y) => x.d - y.d)[0];
    if (best && best.r !== a && best.d <= 0.4 && special) out.push({ word: a, misspelling: joinedPair ? removed.join(' ') : best.r });
  }
  return out;
}

/** RoyFlow's `corrections()`: the corrected words to learn */
export function corrections(pasted: string, before: string | null | undefined, after: string | null | undefined): string[] {
  return correctionPairs(pasted, before, after).map((c) => c.word);
}

/** the dictionary as a Whisper initial prompt ("Glossary: RoyFlow, Dominic."), kept short (RoyFlow's vocab.prompt) */
export function glossaryPrompt(dictionary: { word: string }[], max = 600): string {
  const list = [...new Set(dictionary.map((d) => d.word.trim()).filter(Boolean))];
  if (!list.length) return '';
  let out = 'Glossary: ';
  for (const w of list) {
    if (out.length + w.length > max) break;
    out += `${w}, `;
  }
  return out.replace(/, $/, '.');
}
