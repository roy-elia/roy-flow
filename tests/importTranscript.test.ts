import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/shared/importTranscript';

describe('transcript import', () => {
  it('reads WebVTT with voice tags and joins one speaker’s cues', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>Hello everyone.\n\n00:00:03.500 --> 00:00:05.000\n<v Ana>Let us start.\n\n00:00:06.000 --> 00:00:08.000\n<v Ben>Sounds good.';
    expect(parseTranscript(vtt)).toEqual([
      { t: 1, text: 'Hello everyone. Let us start.', speaker: 'Ana' },
      { t: 6, text: 'Sounds good.', speaker: 'Ben' },
    ]);
  });
  it('reads SRT', () => {
    const srt = '1\n00:00:02,000 --> 00:00:04,000\nFirst line\n\n2\n00:01:00,000 --> 00:01:02,000\nLater line';
    expect(parseTranscript(srt).map((s) => [s.t, s.text])).toEqual([[2, 'First line'], [60, 'Later line']]);
  });
  it('reads Otter text exports', () => {
    const otter = 'Ana Lopez  0:03\nWelcome to the call.\n\nBen Smith  1:15\nThanks for having me.\n\nTranscribed by https://otter.ai';
    expect(parseTranscript(otter)).toEqual([
      { t: 3, text: 'Welcome to the call.', speaker: 'Ana Lopez' },
      { t: 75, text: 'Thanks for having me.', speaker: 'Ben Smith' },
    ]);
  });
  it('reads "Name: words" lines with optional timestamps', () => {
    expect(parseTranscript('[00:10] Ana: Hi\n[00:20] Ben: Hello there')).toEqual([
      { t: 10, text: 'Hi', speaker: 'Ana' },
      { t: 20, text: 'Hello there', speaker: 'Ben' },
    ]);
  });
});
