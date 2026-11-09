import { describe, expect, it } from 'vitest';
import { cleanSections } from '../src/shared/summary';

describe('meeting summary sections', () => {
  it('keeps headed sections with bullets and sub-points', () => {
    const out = cleanSections([
      { heading: 'Visibilité des repos', bullets: [{ text: 'Internal par défaut', sub: ['Speaker 2 a testé'] }, 'Lecture pour tous'] },
      { heading: 'Décisions prises', bullets: [{ text: 'Visibilité « internal »' }] },
    ]);
    expect(out).toEqual([
      { heading: 'Visibilité des repos', bullets: [{ text: 'Internal par défaut', sub: ['Speaker 2 a testé'] }, { text: 'Lecture pour tous' }] },
      { heading: 'Décisions prises', bullets: [{ text: 'Visibilité « internal »' }] },
    ]);
  });
  it('drops malformed sections and empty bullets', () => {
    expect(cleanSections(null)).toEqual([]);
    expect(cleanSections([{ heading: 'x' }, { heading: 'Empty', bullets: ['', { text: '  ' }] }, 'nope', { heading: 'Ok', bullets: ['one'] }])).toEqual([{ heading: 'Ok', bullets: [{ text: 'one' }] }]);
  });
});
