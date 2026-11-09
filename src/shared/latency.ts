/* Pure helpers for the dictation fast path: final-text choice, timing records, and the Flow Bar mic label.
   Shared by the main process and tests; no Electron imports. */

/** the helper's final text, or the last partial the main process saw if the final came back empty */
export function pickFinalText(final: string | undefined | null, lastPartial: string): string {
  const f = (final ?? '').trim();
  return f || lastPartial.trim();
}

/** one dictation's timings (never any text) */
export interface DictationTiming {
  at: string;
  /** key-down -> helper says the mic is running */
  keyToMicMs?: number;
  /** inside the helper: start command -> mic running */
  helperStartMs?: number;
  /** key-up -> final transcript in main (includes the 150 ms capture tail) */
  stopToFinalMs?: number;
  /** how the helper settled the text: isFinal | partial | timeout | noTask | fallback */
  finalVia?: string;
  /** final transcript -> paste keystroke sent */
  finalToPasteMs?: number;
  /** key-up -> pasted */
  totalMs?: number;
  engine?: 'claude' | 'rules';
  audioSeconds?: number;
  chars?: number;
}

export function median(xs: number[]): number | undefined {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/** a few readable lines for Help › Show Dictation Timing */
export function summarizeTimings(list: DictationTiming[]): string {
  if (!list.length) return 'No dictations yet in this session. Dictate something, then open this again.';
  const med = (k: keyof DictationTiming) => median(list.map((t) => t[k]).filter((x): x is number => typeof x === 'number'));
  const fmt = (n: number | undefined) => (n === undefined ? '–' : `${n} ms`);
  const lines = [
    `Last ${list.length} dictation${list.length === 1 ? '' : 's'} (median):`,
    `  key-down → mic on: ${fmt(med('keyToMicMs'))}`,
    `  key-up → transcript: ${fmt(med('stopToFinalMs'))}`,
    `  transcript → paste: ${fmt(med('finalToPasteMs'))}`,
    `  key-up → pasted: ${fmt(med('totalMs'))}`,
    '',
    'Most recent first:',
    ...[...list]
      .reverse()
      .slice(0, 8)
      .map((t) => `  ${t.at.slice(11, 19)}  mic ${fmt(t.keyToMicMs)} · final ${fmt(t.stopToFinalMs)} (${t.finalVia ?? '?'}) · paste ${fmt(t.finalToPasteMs)} · total ${fmt(t.totalMs)} · ${t.engine ?? '?'}`),
  ];
  return lines.join('\n');
}

/** resolve with the promise, or with `fallback()` once `ms` has passed (the slow promise is left to settle on its own) */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(fallback()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** short, friendly name for an input device: "Built-in mic" for the Mac's own microphone, others cut to ~24 chars */
export function shortMicName(name: string | undefined | null, max = 24): string {
  let n = (name ?? '').trim();
  if (!n || /^default$/i.test(n)) return 'Built-in mic';
  n = n.replace(/^default\s*[-–:]\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '');
  if (/^(macbook( air| pro)?|imac|mac (mini|studio|pro))\b.*microphone$/i.test(n) || /^built-?in (mic|microphone|input)/i.test(n)) return 'Built-in mic';
  n = n.replace(/\s+microphone$/i, ' mic');
  return n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n;
}

/** show the mic label only on the first dictation of a session or when the device changed since the last one */
export function micLabelToShow(current: string | undefined | null, lastShown: string | null): string | null {
  const s = shortMicName(current);
  return s === lastShown ? null : s;
}
