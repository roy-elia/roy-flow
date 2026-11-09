/* Claude spending: which model each feature uses, what a request cost, and the monthly budget.
   Prices are Anthropic first-party API rates per million tokens (claude-api reference, cached 2026-10-06).
   Roy Flow sends no cache_control, so cache-write/read prices never apply. */

export type AiFeature = 'summaries' | 'transforms' | 'ask' | 'translate' | 'polish' | 'profile' | 'test';

export const MODEL_IDS = {
  'Haiku 5.5': 'claude-haiku-5-5',
  'Sonnet 5.5': 'claude-sonnet-5-5',
  'Opus 5.5': 'claude-opus-5-5',
} as const;
export type ModelName = keyof typeof MODEL_IDS;
export const MODEL_NAMES = Object.keys(MODEL_IDS) as ModelName[];

/** $ per million tokens; Haiku 5.5 costs more once a prompt passes 100K tokens */
export const PRICES: Record<string, { input: number; output: number; long?: { above: number; input: number; output: number } }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long: { above: 100_000, input: 0.5, output: 2.5 } },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  // a refusal fallback can answer with another model; price it if it does
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

/** the user-selectable features and their defaults; polish (≤0.9 s) and the key test always use Haiku */
export const MODEL_SETTINGS: { feature: AiFeature; key: string; label: string; desc: string; def: ModelName }[] = [
  { feature: 'summaries', key: 'aiModelSummaries', label: 'Meeting summaries', desc: 'Notes, titles and your voice profile', def: 'Sonnet 5.5' },
  { feature: 'transforms', key: 'aiModelTransforms', label: 'Transforms', desc: 'Rewrites, Alt+1–9 and auto-apply', def: 'Sonnet 5.5' },
  { feature: 'ask', key: 'aiModelAsk', label: 'Questions', desc: 'Ask about meetings and “What did I miss?”', def: 'Sonnet 5.5' },
  { feature: 'translate', key: 'aiModelTranslate', label: 'Translation', desc: 'Translate to English', def: 'Haiku 5.5' },
];
/** per-feature on/off switches (default on) */
export const FEATURE_SWITCHES: { feature: AiFeature; key: string; label: string; desc: string }[] = [
  { feature: 'summaries', key: 'aiUseSummaries', label: 'Meeting summaries', desc: 'Off: notes keep their transcript; no summary is written' },
  { feature: 'translate', key: 'aiUseTranslate', label: 'Translation', desc: 'Off: the Translate to English button is hidden' },
  { feature: 'ask', key: 'aiUseAsk', label: 'Questions', desc: 'Off: Ask and “What did I miss?” are disabled' },
  { feature: 'transforms', key: 'aiUseTransforms', label: 'Transforms', desc: 'Off: rewrites and auto-apply are disabled' },
];
export const FEATURE_LABEL: Record<AiFeature, string> = {
  summaries: 'Summaries',
  transforms: 'Transforms',
  ask: 'Questions',
  translate: 'Translation',
  polish: 'Dictation polish',
  profile: 'Voice profile',
  test: 'Key tests',
};
/** budget setting values; "No limit" turns the budget off */
export const BUDGETS = ['No limit', '$1', '$2', '$5', '$10', '$20', '$50', '$100'];
export const budgetUsd = (v: unknown): number | null => {
  const m = /^\$(\d+(?:\.\d+)?)$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

export function modelFor(feature: AiFeature, settings: Record<string, unknown>): string {
  if (feature === 'polish' || feature === 'test') return MODEL_IDS['Haiku 5.5'];
  const row = MODEL_SETTINGS.find((r) => r.feature === (feature === 'profile' ? 'summaries' : feature));
  const name = (row && (settings[row.key] as ModelName)) || row?.def || 'Sonnet 5.5';
  return MODEL_IDS[name] ?? MODEL_IDS['Sonnet 5.5'];
}
export function featureOn(feature: AiFeature, settings: Record<string, unknown>): boolean {
  if (feature === 'polish') return settings.aiCleanup === true;
  const sw = FEATURE_SWITCHES.find((r) => r.feature === (feature === 'profile' ? 'summaries' : feature));
  return !sw || settings[sw.key] !== false;
}

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
/** dollars for one response (unknown models are priced as Opus 5.5, so the budget errs on the safe side) */
export function costUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const rate = p.long && input > p.long.above ? p.long : p;
  return (input * rate.input + (u.output_tokens ?? 0) * rate.output) / 1_000_000;
}

export interface FeatureUsage {
  usd: number;
  requests: number;
  input: number;
  output: number;
}
export interface UsageMonth {
  /** "2026-11" in local time */
  month: string;
  usd: number;
  requests: number;
  byFeature: Partial<Record<AiFeature, FeatureUsage>>;
  byModel: Record<string, FeatureUsage>;
  /** the 80% warning was shown this month */
  warned?: boolean;
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const emptyMonth = (d = new Date()): UsageMonth => ({ month: monthKey(d), usd: 0, requests: 0, byFeature: {}, byModel: {} });
/** this month's record (a new month starts at zero) */
export const currentMonth = (u: UsageMonth | null | undefined, d = new Date()): UsageMonth => (u && u.month === monthKey(d) ? u : emptyMonth(d));

export function addUsage(prev: UsageMonth | null | undefined, feature: AiFeature, model: string, u: TokenUsage, d = new Date()): UsageMonth {
  const cur = currentMonth(prev, d);
  const usd = costUsd(model, u);
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  const bump = (x: FeatureUsage | undefined): FeatureUsage => ({ usd: (x?.usd ?? 0) + usd, requests: (x?.requests ?? 0) + 1, input: (x?.input ?? 0) + input, output: (x?.output ?? 0) + output });
  return {
    ...cur,
    usd: cur.usd + usd,
    requests: cur.requests + 1,
    byFeature: { ...cur.byFeature, [feature]: bump(cur.byFeature[feature]) },
    byModel: { ...cur.byModel, [model]: bump(cur.byModel[model]) },
  };
}

/** "ok" under 80%, "warn" from 80%, "over" at or past the budget; always "ok" with no budget */
export function budgetState(spent: number, budget: number | null): 'ok' | 'warn' | 'over' {
  if (budget === null || budget <= 0) return 'ok';
  if (spent >= budget) return 'over';
  return spent >= budget * 0.8 ? 'warn' : 'ok';
}
export const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
