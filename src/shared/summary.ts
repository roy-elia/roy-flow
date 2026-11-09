import type { SummarySection } from './types';

/** keep only well-formed sections from the model's JSON */
export function cleanSections(raw: unknown): SummarySection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => x as { heading?: unknown; bullets?: unknown })
    .filter((x) => x && typeof x.heading === 'string' && Array.isArray(x.bullets))
    .slice(0, 8)
    .map((x) => ({
      heading: String(x.heading).slice(0, 120),
      bullets: (x.bullets as unknown[])
        .map((b) => (typeof b === 'string' ? { text: b } : (b as { text?: unknown; sub?: unknown })))
        .filter((b) => b && typeof b.text === 'string' && b.text.trim())
        .slice(0, 12)
        .map((b) => ({ text: String(b.text), ...(Array.isArray(b.sub) && b.sub.length ? { sub: b.sub.map(String).slice(0, 8) } : {}) })),
    }))
    .filter((x) => x.bullets.length);
}
