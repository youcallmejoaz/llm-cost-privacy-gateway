import type { Prices } from './config.js';
import type { ModelRef } from './types.js';

/** Rough token estimate (about 4 characters per token for English). Used only before a call. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function priceOf(prices: Prices, model: ModelRef): { input: number; output: number } {
  const p = prices.models[model];
  if (!p) throw new Error(`No price for ${model}`);
  return p;
}

/** Cost in USD, rounded to 1 millionth of a dollar so totals add up exactly. */
export function costUsd(prices: Prices, model: ModelRef, inputTokens: number, outputTokens: number): number {
  const p = priceOf(prices, model);
  return roundMicro((inputTokens * p.input + outputTokens * p.output) / 1_000_000);
}

export function roundMicro(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function toMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function blendedPrice(prices: Prices, model: ModelRef): number {
  const p = priceOf(prices, model);
  // Typical gateway traffic is input heavy; weight 3:1.
  return (3 * p.input + p.output) / 4;
}
