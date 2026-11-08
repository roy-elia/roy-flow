import { describe, expect, it } from 'vitest';
import { applyMutation, emptyState, mergeState, retainHistory } from '../src/shared/state';
import type { HistoryItem } from '../src/shared/types';

const item = (id: string, ts = Date.now()): HistoryItem => ({ id, ts, text: id, status: 'ok' });

describe('state merge (store migration)', () => {
  it('adds new settings keys and new actions without losing saved values', () => {
    const saved = { settings: { sounds: false }, hotkeys: { handsfree: [['opt', 'h']] }, transforms: emptyState().transforms };
    const s = mergeState(emptyState(), saved);
    expect(s.settings.sounds).toBe(false);
    expect(s.settings.codeAware).toBe(true);
    expect(s.hotkeys.handsfree).toEqual([['opt', 'h']]);
    expect(s.hotkeys.ptt).toEqual([['fn']]);
    expect(s.hotkeys['transform:t1']).toEqual([['opt', '1']]);
    expect(s.chats).toEqual([]);
  });
  it('keeps an action the user emptied', () => {
    expect(mergeState(emptyState(), { hotkeys: { notetaker: [] } }).hotkeys.notetaker).toEqual([]);
  });
});

describe('mutations owned by main', () => {
  it('adds history items to the front without duplicates', () => {
    const p = applyMutation({ history: [item('a'), item('b')] }, { collection: 'history', op: 'add', item: item('b') });
    expect(p.history!.map((h) => h.id)).toEqual(['b', 'a']);
  });
  it('patches meetings by id', () => {
    const p = applyMutation({ meetings: [{ id: 'm', title: 'x', ts: 0, minutes: 1, people: 1, overview: '' }] }, { collection: 'meetings', op: 'patch', id: 'm', patch: { title: 'y' } });
    expect(p.meetings![0].title).toBe('y');
  });
  it('works on empty data', () => {
    expect(applyMutation({}, { collection: 'history', op: 'add', item: item('a') }).history).toHaveLength(1);
  });
});

describe('retention', () => {
  const now = Date.UTC(2026, 10, 8);
  it('drops items older than 30 days only with auto-delete', () => {
    const h = [item('new', now - 86400_000), item('old', now - 40 * 86400_000)];
    expect(retainHistory(h, 'Store normally', now)).toBeNull();
    expect(retainHistory(h, 'Auto-delete after 30 days', now)!.map((x) => x.id)).toEqual(['new']);
    expect(retainHistory([h[0]], 'Auto-delete after 30 days', now)).toBeNull();
  });
});
