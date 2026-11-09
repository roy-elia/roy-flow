import { describe, expect, it } from 'vitest';
import { addUsage, budgetState, budgetUsd, costUsd, currentMonth, featureOn, modelFor, usd } from '../src/shared/aiUsage';

describe('Claude cost', () => {
  it('prices per million tokens', () => {
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12);
    expect(costUsd('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(0.04 + 0.04);
    expect(costUsd('claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 1_000 })).toBeCloseTo(0.005 + 0.0005);
  });
  it('uses the Haiku long-prompt rate above 100K input tokens', () => {
    expect(costUsd('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 1_000 })).toBeCloseTo(0.1 + 0.0025);
  });
  it('prices an unknown model as Opus 5.5 (errs high)', () => {
    expect(costUsd('claude-something-new', { input_tokens: 1_000_000 })).toBeCloseTo(4);
  });
  it('a 30-minute meeting summary on Sonnet costs cents', () => {
    // ~30 min of speech ≈ 5,000 words ≈ 7K tokens in, ~800 tokens out
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 7_500, output_tokens: 800 })).toBeLessThan(0.03);
  });
});

describe('monthly usage', () => {
  const nov = new Date(2026, 10, 9);
  const dec = new Date(2026, 11, 1);
  it('adds up by feature and model', () => {
    let u = addUsage(null, 'summaries', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, nov);
    u = addUsage(u, 'translate', 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 }, nov);
    u = addUsage(u, 'summaries', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, nov);
    expect(u.month).toBe('2026-11');
    expect(u.requests).toBe(3);
    expect(u.byFeature.summaries).toMatchObject({ requests: 2, input: 2000, output: 200 });
    expect(u.usd).toBeCloseTo(2 * 0.003 + 0.0006);
    expect(Object.keys(u.byModel)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
  });
  it('starts again at zero in a new month', () => {
    const u = addUsage(null, 'ask', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000 }, nov);
    expect(currentMonth(u, dec)).toMatchObject({ month: '2026-12', usd: 0, requests: 0 });
    expect(addUsage(u, 'ask', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 0 }, dec).requests).toBe(1);
  });
});

describe('budget', () => {
  it('parses the setting', () => {
    expect(budgetUsd('$5')).toBe(5);
    expect(budgetUsd('No limit')).toBeNull();
    expect(budgetUsd(undefined)).toBeNull();
  });
  it('warns at 80% and stops at 100%', () => {
    expect(budgetState(3.99, 5)).toBe('ok');
    expect(budgetState(4, 5)).toBe('warn');
    expect(budgetState(5, 5)).toBe('over');
    expect(budgetState(500, null)).toBe('ok');
  });
  it('formats dollars', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(0.004)).toBe('<$0.01');
    expect(usd(1.234)).toBe('$1.23');
  });
});

describe('model and feature settings', () => {
  it('defaults: Sonnet for summaries/transforms/ask, Haiku for translation and polish', () => {
    expect(modelFor('summaries', {})).toBe('claude-sonnet-5-5');
    expect(modelFor('profile', {})).toBe('claude-sonnet-5-5');
    expect(modelFor('translate', {})).toBe('claude-haiku-5-5');
    expect(modelFor('polish', { aiModelSummaries: 'Opus 5.5' })).toBe('claude-haiku-5-5');
  });
  it('follows the user choice', () => {
    expect(modelFor('summaries', { aiModelSummaries: 'Opus 5.5' })).toBe('claude-opus-5-5');
    expect(modelFor('profile', { aiModelSummaries: 'Haiku 5.5' })).toBe('claude-haiku-5-5');
    expect(modelFor('ask', { aiModelAsk: 'Haiku 5.5' })).toBe('claude-haiku-5-5');
  });
  it('switches default on; polish follows its own setting', () => {
    expect(featureOn('summaries', {})).toBe(true);
    expect(featureOn('translate', { aiUseTranslate: false })).toBe(false);
    expect(featureOn('profile', { aiUseSummaries: false })).toBe(false);
    expect(featureOn('polish', {})).toBe(false);
    expect(featureOn('polish', { aiCleanup: true })).toBe(true);
  });
});
