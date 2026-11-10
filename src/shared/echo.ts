/* Meeting echo: with speakers instead of headphones, the mic also hears the other side of the call, so the same
   words arrive twice: once from the Mac's sound ("Them") and once from the mic ("You"). A mic line whose words
   are mostly in a system line said at the same moment is that echo, and is dropped. */
import type { TranscriptSegment } from './types';

const words = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** share of the mic line's words that the system line also has (0..1) */
export function overlap(mic: string, system: string): number {
  const m = words(mic);
  if (!m.length) return 0;
  const s = new Map<string, number>();
  for (const w of words(system)) s.set(w, (s.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of m) {
    const n = s.get(w) ?? 0;
    if (n) {
      hit++;
      s.set(w, n - 1);
    }
  }
  return hit / m.length;
}

const near = (a: TranscriptSegment, b: TranscriptSegment, slack = 3) => {
  const a1 = a.t + (a.d ?? 10);
  const b1 = b.t + (b.d ?? 10);
  return a.t <= b1 + slack && b.t <= a1 + slack;
};

/** is this mic line an echo of something the system track heard at the same time? */
export function isEcho(mic: TranscriptSegment, others: TranscriptSegment[], threshold = 0.6): boolean {
  const sys = others.filter((o) => o.who === 'them' && near(mic, o));
  if (!sys.length) return false;
  return overlap(mic.text, sys.map((s) => s.text).join(' ')) >= threshold && words(mic.text).length >= 2;
}

/** insert a line in time order; drops mic lines that are echoes (either way round). Returns the new list. */
export function addSegment(list: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[] {
  let out = list;
  if (seg.who !== 'them' && isEcho(seg, out)) return out;
  if (seg.who === 'them') out = out.filter((o) => o.who === 'them' || !isEcho(o, [seg]));
  const i = out.findIndex((o) => o.t > seg.t);
  return i < 0 ? [...out, seg] : [...out.slice(0, i), seg, ...out.slice(i)];
}
