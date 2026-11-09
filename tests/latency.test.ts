import { describe, expect, it, vi } from 'vitest';
import { median, micLabelToShow, pickFinalText, shortMicName, summarizeTimings, withTimeout } from '../src/shared/latency';
import { emptyState, migrateSettings } from '../src/shared/state';

describe('pickFinalText', () => {
  it('prefers the helper final text', () => {
    expect(pickFinalText(' Hello there. ', 'hello the')).toBe('Hello there.');
  });
  it('falls back to the last partial when the final is empty', () => {
    expect(pickFinalText('', 'Quick test.')).toBe('Quick test.');
    expect(pickFinalText(undefined, '  ')).toBe('');
  });
});

describe('withTimeout', () => {
  it('returns the fallback when the promise is late', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>((r) => setTimeout(() => r('claude'), 2000));
    const p = withTimeout(slow, 900, () => 'rules');
    vi.advanceTimersByTime(900);
    await expect(p).resolves.toBe('rules');
    vi.useRealTimers();
  });
  it('returns the value when it is on time and passes errors through', async () => {
    await expect(withTimeout(Promise.resolve('claude'), 900, () => 'rules')).resolves.toBe('claude');
    await expect(withTimeout(Promise.reject(new Error('x')), 900, () => 'rules')).rejects.toThrow('x');
  });
});

describe('shortMicName', () => {
  it('calls the Mac microphone "Built-in mic"', () => {
    expect(shortMicName('MacBook Pro Microphone')).toBe('Built-in mic');
    expect(shortMicName('Default - MacBook Pro Microphone')).toBe('Built-in mic');
    expect(shortMicName('MacBook Air Microphone')).toBe('Built-in mic');
    expect(shortMicName('')).toBe('Built-in mic');
    expect(shortMicName('default')).toBe('Built-in mic');
  });
  it('shortens other devices to 24 characters', () => {
    expect(shortMicName('AirPods Pro')).toBe('AirPods Pro');
    expect(shortMicName('Roy Elia’s iPhone Microphone')).toBe('Roy Elia’s iPhone mic');
    const long = shortMicName('Elgato Wave:3 Studio Condenser USB Input (0fd9:0070)');
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toContain('0fd9');
  });
});

describe('micLabelToShow', () => {
  it('shows on the first dictation and on device changes only', () => {
    expect(micLabelToShow('MacBook Pro Microphone', null)).toBe('Built-in mic');
    expect(micLabelToShow('MacBook Pro Microphone', 'Built-in mic')).toBeNull();
    expect(micLabelToShow('AirPods Pro', 'Built-in mic')).toBe('AirPods Pro');
  });
});

describe('timing summary', () => {
  it('computes medians and never needs text', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([])).toBeUndefined();
    const s = summarizeTimings([
      { at: '2026-11-08T10:00:00.000Z', keyToMicMs: 40, stopToFinalMs: 420, finalToPasteMs: 30, totalMs: 450, engine: 'rules', finalVia: 'partial' },
      { at: '2026-11-08T10:01:00.000Z', keyToMicMs: 60, stopToFinalMs: 380, finalToPasteMs: 20, totalMs: 400, engine: 'rules', finalVia: 'isFinal' },
    ]);
    expect(s).toContain('key-up → pasted: 425 ms');
    expect(s).toContain('(partial)');
    expect(summarizeTimings([])).toMatch(/No dictations/);
  });
});

describe('settings migration 1.3', () => {
  it('moves a saved side dock to the bottom once and makes Claude clean-up opt-in', () => {
    const m = migrateSettings({ flowBarDock: 'Left', aiCleanup: true, sounds: false });
    expect(m).toEqual({ flowBarDock: 'Bottom', aiCleanup: false, sounds: false, migrated13: true });
  });
  it('runs only once, so the user can pick Left/Right again', () => {
    expect(migrateSettings({ flowBarDock: 'Right', aiCleanup: true, migrated13: true })).toBeNull();
  });
  it('new installs are already migrated with a bottom dock', () => {
    const s = emptyState().settings;
    expect(s.flowBarDock).toBe('Bottom');
    expect(migrateSettings(s)).toBeNull();
  });
});
