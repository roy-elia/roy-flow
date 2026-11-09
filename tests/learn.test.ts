import { describe, expect, it } from 'vitest';
import { correctionPairs, corrections, glossaryPrompt } from '../src/shared/learn';

describe('auto-learn corrections (RoyFlow learn.js)', () => {
  const pasted = 'I talked to Dominik about the launch.';
  it('learns a corrected name', () => {
    expect(corrections(pasted, `Hi. ${pasted}`, 'Hi. I talked to Dominic about the launch.')).toEqual(['Dominic']);
  });
  it('learns two words joined into a brand', () => {
    const p = 'open roy flow and dictate';
    expect(corrections(p, p, 'open RoyFlow and dictate')).toEqual(['RoyFlow']);
    expect(correctionPairs(p, p, 'open RoyFlow and dictate')).toEqual([{ word: 'RoyFlow', misspelling: 'roy flow' }]);
  });
  it('keeps what was replaced as the misspelling', () => {
    expect(correctionPairs(pasted, pasted, pasted.replace('Dominik', 'Dominic'))).toEqual([{ word: 'Dominic', misspelling: 'Dominik' }]);
  });
  it('ignores ordinary typing after the dictation', () => {
    expect(corrections(pasted, pasted, `${pasted} See you tomorrow, thanks!`)).toEqual([]);
  });
  it('ignores rewrites to unrelated words and lowercase common words', () => {
    expect(corrections(pasted, pasted, 'I talked to Sarah about the launch.')).toEqual([]);
    expect(corrections('the cat sat', 'the cat sat', 'the cot sat')).toEqual([]);
  });
  it('ignores edits outside the pasted words and large edits', () => {
    expect(corrections('hello there', 'Dear Jon, hello there', 'Dear John, hello there')).toEqual([]);
    expect(corrections('one two three four five', 'one two three four five', 'Uno Dos Tres Cuatro Cinco')).toEqual([]);
  });
  it('needs both readings of the field', () => {
    expect(corrections(pasted, null, pasted)).toEqual([]);
    expect(corrections(pasted, pasted, undefined)).toEqual([]);
    expect(corrections(pasted, pasted, pasted)).toEqual([]);
  });
  it('learns jargon with digits', () => {
    expect(corrections('use gpt 4 now', 'use gpt 4 now', 'use GPT4 now')).toEqual(['GPT4']);
  });
});

describe('Whisper glossary prompt', () => {
  it('lists dictionary words', () => {
    expect(glossaryPrompt([{ word: 'RoyFlow' }, { word: 'Dominic' }, { word: 'RoyFlow' }])).toBe('Glossary: RoyFlow, Dominic.');
  });
  it('is empty without words and stays short', () => {
    expect(glossaryPrompt([])).toBe('');
    const many = Array.from({ length: 200 }, (_, i) => ({ word: `Word${i}` }));
    expect(glossaryPrompt(many).length).toBeLessThanOrEqual(600);
  });
});
