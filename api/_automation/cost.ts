/**
 * What an AI call costs. Prices are US dollars per million tokens, keyed by
 * the model that really answered (a fallback model can answer in place of the
 * one asked for). Costs are kept in millionths of a dollar, so one token at
 * "4 dollars per million" is exactly 4 and sums stay whole numbers.
 */

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICES: Readonly<Record<string, Price>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** A model that is not in the table is charged at these figures. */
export const DEFAULT_PRICE: Price = PRICES["claude-opus-5-5"];

/** One web search: a hundredth of a dollar (10 dollars per thousand). */
export const WEB_SEARCH_MICRO_USD = 10_000;

export type Tokens = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearches: number };

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The cost of one reply, in millionths of a dollar, rounded up. */
export function costMicroUsd(model: string, t: Tokens): number {
  const p = Object.prototype.hasOwnProperty.call(PRICES, model) ? PRICES[model] : DEFAULT_PRICE;
  const tokens = count(t.inputTokens) * p.input + count(t.outputTokens) * p.output + count(t.cacheReadInputTokens) * p.cacheRead + count(t.cacheCreationInputTokens) * p.cacheWrite;
  return Math.ceil(tokens - 1e-9) + count(t.webSearches) * WEB_SEARCH_MICRO_USD;
}

/** Millionths of a dollar as whole US cents (the budget's unit). */
export const centsOf = (microUsd: number): number => Math.round(microUsd / 10_000);

/** The first instant of the calendar month `now` is in (UTC): budgets and "this month" count from here. */
export const monthStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/** YYYY-MM of `now` (UTC). */
export const monthKey = (now: Date): string => now.toISOString().slice(0, 7);
