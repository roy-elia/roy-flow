/* Import a meeting transcript from another notetaker (Wispr imports from Granola and Otter): WebVTT (.vtt),
   SubRip (.srt), Otter's text export ("Name  0:03" then the words), or plain "Name: words" lines. */
import type { TranscriptSegment } from './types';

const clock = (s: string): number => {
  const p = s.replace(',', '.').split(':').map(Number);
  return p.reduce((acc, v) => acc * 60 + v, 0);
};
const TIMING = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
const OTTER_HEAD = /^(.{1,60}?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const NAME_LINE = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})?\]?\s*([^:\n]{1,40}):\s+(.+)$/;

function push(out: TranscriptSegment[], t: number, text: string, speaker?: string) {
  const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const last = out[out.length - 1];
  // captions split one speaker's sentence over many cues: join consecutive cues of the same speaker
  if (last && last.speaker === speaker && t - last.t < 30 && last.text.length < 600) last.text += ` ${clean}`;
  else out.push({ t: Math.round(t * 10) / 10, text: clean, ...(speaker ? { speaker } : {}) });
}

export function parseTranscript(raw: string): TranscriptSegment[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  const out: TranscriptSegment[] = [];
  if (lines.some((l) => TIMING.test(l.trim()))) {
    // VTT / SRT cues
    let t = 0;
    let buf: string[] = [];
    const flush = () => {
      if (!buf.length) return;
      const joined = buf.join(' ');
      const v = /^<v\s+([^>]+)>(.*)$/.exec(joined) ?? /^([^:]{1,40}):\s+(.+)$/.exec(joined);
      push(out, t, v ? v[2] : joined, v ? v[1].trim() : undefined);
      buf = [];
    };
    for (const l of lines.map((x) => x.trim())) {
      if (TIMING.test(l)) {
        flush();
        t = clock(l.split('-->')[0].trim());
      } else if (!l || /^\d+$/.test(l) || l === 'WEBVTT' || /^(NOTE|STYLE|Kind:|Language:)/.test(l)) flush();
      else buf.push(l);
    }
    flush();
    return out;
  }
  if (lines.some((l) => OTTER_HEAD.test(l))) {
    let speaker: string | undefined;
    let t = 0;
    for (const l of lines) {
      const h = OTTER_HEAD.exec(l);
      if (h) {
        speaker = h[1].trim();
        t = clock(h[2]);
      } else if (l.trim() && !/^Transcribed by/i.test(l)) push(out, t, l, speaker);
    }
    return out;
  }
  let t = 0;
  for (const l of lines) {
    const m = NAME_LINE.exec(l.trim());
    if (m) {
      if (m[1]) t = clock(m[1]);
      push(out, t, m[3], m[2].trim());
    } else if (l.trim()) push(out, t, l, out[out.length - 1]?.speaker);
  }
  return out;
}
