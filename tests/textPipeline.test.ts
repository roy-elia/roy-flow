import { describe, expect, it } from 'vitest';
import { expiredMeetings, splitPressEnter, stackMessages, applyDictionary, applySnippets, changedWords, cleanUp, correctedWords, diffWords, fillSnippet, processTranscript, styleText, wordCount } from '../src/shared/textPipeline';

describe('cleanUp (rule-based, no API key)', () => {
  it('removes hesitations and capitalises', () => {
    expect(cleanUp('um so i think uh we should ship it')).toBe('So I think we should ship it.');
  });
  it('keeps real words that look like fillers', () => {
    expect(cleanUp('do you know him')).toBe('Do you know him.');
    expect(cleanUp('i like it')).toBe('I like it.');
    expect(cleanUp('the umbrella is here')).toBe('The umbrella is here.');
  });
  it('removes comma-delimited discourse fillers', () => {
    expect(cleanUp('it was, like, really good')).toBe('It was really good.');
    expect(cleanUp('you know, it works')).toBe('It works.');
  });
  it('removes stutters but keeps legitimate repeats', () => {
    expect(cleanUp('I I think the the plan works')).toBe('I think the plan works.');
    expect(cleanUp('I knew that that was wrong')).toBe('I knew that that was wrong.');
    // said on purpose: kept (Wispr keeps these too)
    expect(cleanUp('hello hello hello')).toBe('Hello hello hello.');
    expect(cleanUp('it is very very good')).toBe('It is very very good.');
    expect(cleanUp('go go go')).toBe('Go go go.');
  });
  it('handles spoken line breaks', () => {
    expect(cleanUp('hi team new paragraph the build is green new line thanks')).toBe('Hi team.\n\nThe build is green.\nThanks.');
  });
  it('capitalises after sentence ends and fixes i contractions', () => {
    expect(cleanUp("it's done. i'm happy. and i'll ship")).toBe("It's done. I'm happy. And I'll ship.");
  });
  it('does not double punctuation or leave spaces before it', () => {
    expect(cleanUp('really , great job ?')).toBe('Really, great job?');
    expect(cleanUp('ok,.')).toBe('Ok.');
  });
  it('light level only strips fillers', () => {
    expect(cleanUp('um make it lowercase', 'Light')).toBe('make it lowercase');
  });
  it('high level also drops hedges', () => {
    expect(cleanUp('it basically just works', 'High')).toBe('It works.');
  });
  it('empty in, empty out', () => {
    expect(cleanUp('um uh')).toBe('');
    expect(cleanUp('   ')).toBe('');
  });
});

describe('styleText', () => {
  it('formal leaves text alone', () => expect(styleText('Hi there. How are you?', 'formal')).toBe('Hi there. How are you?'));
  it('casual drops only the final full stop', () => expect(styleText('Hi there. See you soon.', 'casual')).toBe('Hi there. See you soon'));
  it('very casual is lowercase with less punctuation', () => expect(styleText('Hi, Sam. See you soon.', 'very')).toBe('hi sam. see you soon'));
  it('excited uses exclamation marks', () => expect(styleText('We shipped. Great work.', 'excited')).toBe('We shipped! Great work!'));
});

describe('dictionary', () => {
  it('fixes casing and misspellings as whole words', () => {
    const r = applyDictionary('i use roy flow and github daily, not githubby', [{ word: 'Roy Flow' }, { word: 'GitHub' }]);
    expect(r.text).toBe('i use Roy Flow and GitHub daily, not githubby');
    expect(r.count).toBe(2);
  });
  it('replaces a misspelling with the word', () => {
    expect(applyDictionary('ask clawed about it', [{ word: 'Claude', misspelling: 'clawed' }]).text).toBe('ask Claude about it');
  });
  it('handles symbols at the edges of a word', () => {
    expect(applyDictionary('I write c++ and .net code', [{ word: 'C++' }, { word: '.NET' }]).text).toBe('I write C++ and .NET code');
  });
  it('prefers the longest entry', () => {
    expect(applyDictionary('roy flow rocks', [{ word: 'Roy' }, { word: 'Roy Flow' }]).text).toBe('Roy Flow rocks');
  });
  it('does not count an already-correct word', () => {
    expect(applyDictionary('GitHub', [{ word: 'GitHub' }]).count).toBe(0);
  });
});

describe('snippets', () => {
  const sn = [{ trigger: 'my email', expansion: '{email}' }, { trigger: 'sign off', expansion: 'Best,\n{name}' }];
  const vars = { first: 'Roy', last: 'Elia', email: 'roy@example.com' };
  it('expands a spoken trigger and eats its full stop', () => {
    expect(applySnippets('My email.', sn, vars)).toEqual({ text: 'roy@example.com', count: 1 });
  });
  it('expands inside a sentence', () => {
    expect(applySnippets('Send it to my email, thanks.', sn, vars).text).toBe('Send it to roy@example.com, thanks.');
  });
  it('fills placeholders', () => {
    expect(applySnippets('Thanks. Sign off.', sn, vars).text).toBe('Thanks. Best,\nRoy Elia');
    expect(fillSnippet('{unknown} {email}', {})).toBe('{unknown} {email}');
  });
  it('does not match inside other words', () => {
    expect(applySnippets('my emails are many', sn, vars).text).toBe('my emails are many');
  });
  it('full rule pipeline: dictionary, clean-up, snippets', () => {
    expect(processTranscript('um send it to my email', [], sn, 'Medium', vars)).toBe('Send it to roy@example.com');
  });
});

describe('diff helpers', () => {
  it('counts changed words', () => {
    expect(changedWords('um i think so', 'I think so.')).toBe(5); // removed + added words
    expect(diffWords('a b', 'a b')).toEqual([{ type: 'same', text: 'a b' }]);
  });
  it('finds corrected words for the dictionary', () => {
    expect(correctedWords('ask clawed now', 'ask Claude now')).toEqual([{ word: 'Claude', misspelling: 'clawed' }]);
  });
  it('word count', () => {
    expect(wordCount('  one two  three ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});

import { matchSkills, SKILLS } from '../src/shared/skills';
describe('Notetaker skills', () => {
  it('lists every skill after "/" and filters by name', () => {
    expect(matchSkills('/')).toHaveLength(SKILLS.length);
    expect(matchSkills('/follow').map((s) => s.id)).toEqual(['follow-up']);
    expect(matchSkills('what happened')).toEqual([]);
  });
});

describe('press enter', () => {
  it('splits a trailing "press enter" off the dictation', () => {
    expect(splitPressEnter('See you tomorrow, press enter.')).toEqual({ text: 'See you tomorrow', enter: true });
    expect(splitPressEnter('Press return')).toEqual({ text: '', enter: true });
    expect(splitPressEnter('Press enter to continue the setup')).toEqual({ text: 'Press enter to continue the setup', enter: false });
  });
});

describe('stacked messages and note retention', () => {
  it('splits paragraphs, else sentences', () => {
    expect(stackMessages('Hey! Are you free later? Call me.')).toEqual(['Hey!', 'Are you free later?', 'Call me.']);
    expect(stackMessages('First para. Still first.\n\nSecond para.')).toEqual(['First para. Still first.', 'Second para.']);
    expect(stackMessages('Just one line')).toEqual(['Just one line']);
  });
  it('expires only real notes older than the chosen period', () => {
    const now = Date.UTC(2026, 10, 10);
    const day = 86_400_000;
    const list = [{ id: 'a', ts: now - 2 * day }, { id: 'b', ts: now - 40 * day }, { id: 'c', ts: now - 40 * day, demo: true }];
    expect(expiredMeetings(list, 'Forever', now)).toEqual([]);
    expect(expiredMeetings(list, '30 days', now).map((m) => m.id)).toEqual(['b']);
    expect(expiredMeetings(list, '1 day', now).map((m) => m.id)).toEqual(['a', 'b']);
  });
});
