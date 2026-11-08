import { describe, expect, it } from 'vitest';
import { allActions, chordLabel, chordWarning, defaultHotkeyMap, helperBindings, keyChip, mouseButtonName, normalize, reservedWarning, toAccelerator, validateChord } from '../src/shared/hotkeys';

const transforms = [{ id: 't1', name: 'Polish' }, { id: 't2', name: 'Prompt Engineer' }];
const actions = allActions(transforms);
const map = defaultHotkeyMap(transforms);
const act = (id: string) => actions.find((a) => a.id === id)!;
/** validate as the editor does: the chord replaces nothing in this action */
const check = (id: string, chord: string[], m = map) => validateChord(act(id), chord, { ...m, [id]: [] }, actions);

describe('validateChord (Wispr rules)', () => {
  it('accepts the defaults', () => {
    for (const a of actions) for (const c of map[a.id] ?? []) expect(check(a.id, c), `${a.id} ${c}`).toBeNull();
  });
  it('fn alone is fine for push-to-talk but not for hands-free', () => {
    expect(check('ptt', ['fn'])).toBeNull();
    expect(check('handsfree', ['fn'])).toMatch(/needs a key besides modifiers/);
  });
  it('refuses a single letter without a modifier', () => {
    expect(check('pasteLast', ['k'])).toBe('Shortcut must include a modifier key or a valid mouse button');
  });
  it('allows Esc alone only for Cancel', () => {
    expect(check('pasteLast', ['esc'])).toMatch(/modifier/);
  });
  it('refuses shift + letter (would break typing)', () => {
    expect(check('pasteLast', ['shift', 'a'])).toMatch(/needed for typing/);
  });
  it('refuses system and app-wide combos', () => {
    for (const c of [['cmd', 'space'], ['cmd', 'tab'], ['cmd', 'q'], ['cmd', 'c'], ['shift', 'cmd', '4']]) expect(check('scratchpad', c), c.join('+')).toMatch(/not allowed/);
  });
  it('refuses more than 3 keys', () => {
    expect(check('scratchpad', ['ctrl', 'opt', 'cmd', 'k'])).toBe('Shortcut must contain 3 or fewer keys');
  });
  it('refuses two non-modifier keys', () => {
    expect(check('scratchpad', ['opt', 'a', 'b'])).toMatch(/one key/);
  });
  it('reports a conflict with another action', () => {
    expect(check('scratchpad', ['opt', 'space'])).toBe('This shortcut is already in use by “Hands-free mode”');
    expect(check('scratchpad', ['opt', '1'])).toMatch(/Polish/);
  });
  it('contextual actions only clash within the same context', () => {
    // Cancel (while recording) and View changes (after a Transform) may not share, but Esc is free elsewhere
    expect(check('viewChanges', ['esc'])).toMatch(/modifier/);
    expect(check('cancel', ['opt', 'o'])).toBeNull();
  });
  it('refuses a duplicate within the same action', () => {
    const m = { ...map, scratchpad: [['opt', 's']] };
    expect(validateChord(act('scratchpad'), ['opt', 's'], m, actions)).toBe('This shortcut is already in use');
  });
  it('accepts mouse buttons alone or with modifiers', () => {
    expect(check('scratchpad', ['mouse4'])).toBeNull();
    expect(check('scratchpad', ['opt', 'mouse5'])).toBeNull();
    expect(check('handsfree', ['mouse3'])).toBeNull();
  });
  it('accepts function keys alone', () => expect(check('scratchpad', ['f13'])).toBeNull());
});

describe('warnings', () => {
  it('hands-free containing the push-to-talk keys', () => {
    expect(chordWarning('handsfree', ['fn', 'space'], map)).toMatch(/contains your Push-to-talk keys/);
    expect(chordWarning('handsfree', ['opt', 'space'], map)).toBeNull();
  });
  it('macOS defaults that can be turned off', () => {
    expect(reservedWarning(['ctrl', 'space'])).toMatch(/input sources/);
    expect(reservedWarning(['opt', 'space'])).toBeNull();
  });
});

describe('labels and conversions', () => {
  it('normalises modifier order', () => expect(normalize(['v', 'cmd', 'ctrl'])).toEqual(['ctrl', 'cmd', 'v']));
  it('chord labels', () => {
    expect(chordLabel(['ctrl', 'cmd', 'v'])).toBe('⌃⌘V');
    expect(chordLabel(['opt', 'space'])).toBe('⌥ Space');
    expect(chordLabel(['fn'])).toBe('fn');
    expect(chordLabel(['opt', 'mouse4'])).toBe('⌥ Mouse 4');
  });
  it('key chips', () => {
    expect(keyChip('mouse3')).toBe('Middle click');
    expect(keyChip('f13')).toBe('F13');
  });
  it('accelerators only for ordinary combos', () => {
    expect(toAccelerator(['opt', 'space'])).toBe('Alt+Space');
    expect(toAccelerator(['fn'])).toBeNull();
    expect(toAccelerator(['mouse4'])).toBeNull();
  });
  it('DOM mouse buttons', () => {
    expect([0, 1, 2, 3, 4].map(mouseButtonName)).toEqual([null, 'mouse3', null, 'mouse4', 'mouse5']);
  });
  it('helper bindings carry hold and context', () => {
    const b = helperBindings(map, actions);
    expect(b.find((x) => x.action === 'ptt')).toEqual({ action: 'ptt', keys: ['fn'], hold: true, when: null });
    expect(b.find((x) => x.action === 'cancel')).toEqual({ action: 'cancel', keys: ['esc'], hold: false, when: 'recording' });
  });
});
