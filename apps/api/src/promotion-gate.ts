// When does a /coach prompt join the team's library?
//
// The library (prompts.status = 'graduated') is what /examples, /diff,
// /prompts/proven and /coach's strong-example lookup serve back to the whole
// team — including into teammates' LLM context via MCP. So getting in has to
// be harder than "one LLM call rounded the mean up to 7".
//
// Default (TRAILHEAD_PROMOTION_MODE unset or 'auto'):
//   1. Gate, checked synchronously in /coach: the UNROUNDED mean of the five
//      dimensions is >= 7.0 and no dimension is below 5. (Before: the rounded
//      mean >= 7, so 6.5 qualified, and a prompt could be 10/10/10/10/0.)
//   2. Second signal, checked in the background: an independent re-score of
//      the same prompt WITHOUT the team-context bundle must pass the same
//      gate. That removes the lift a primed system prompt can give, and makes
//      one lucky (or manipulated) scoring call insufficient. Costs one extra
//      Gemini call per candidate, only for prompts that already passed (1).
//   3. The prompt is inserted as 'graduated'.
//
// TRAILHEAD_PROMOTION_MODE=review: same gate and confirmation, but the prompt
// lands as 'pending_review' and only reaches the library when a teammate
// approves it (GET /prompts/pending, POST /prompts/:id/review). Use it when
// the team wants a human in the loop; the cost is that the library only grows
// when someone reviews.
//
// All thresholds are constants here — flip them in one place.

import type { DimensionScores } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';

export const PROMOTION_MIN_MEAN = 7;
export const PROMOTION_MIN_DIMENSION = 5;

export type PromotionMode = 'auto' | 'review';

export function promotionMode(env: NodeJS.ProcessEnv = process.env): PromotionMode {
  return env.TRAILHEAD_PROMOTION_MODE === 'review' ? 'review' : 'auto';
}

export function unroundedMean(d: DimensionScores): number {
  return DIMENSIONS.reduce((s, k) => s + d[k], 0) / DIMENSIONS.length;
}

export interface GateResult {
  ok: boolean;
  mean: number;
  reason: 'ok' | 'mean_below_threshold' | 'weak_dimension';
}

export function passesPromotionGate(d: DimensionScores): GateResult {
  const mean = unroundedMean(d);
  if (mean < PROMOTION_MIN_MEAN) return { ok: false, mean, reason: 'mean_below_threshold' };
  if (DIMENSIONS.some((k) => d[k] < PROMOTION_MIN_DIMENSION)) return { ok: false, mean, reason: 'weak_dimension' };
  return { ok: true, mean, reason: 'ok' };
}

// The banner /coach shows when a prompt passed the gate. It must not claim
// more than has happened: promotion completes in the background.
export function renderLibraryBanner(overall: number, mode: PromotionMode): string {
  return mode === 'review'
    ? `### ✅ Your prompt scored **${overall}/10** and was submitted for your team's library\n` +
        `_A teammate reviews it before it's used as an example for this folder._`
    : `### ✅ Your prompt scored **${overall}/10** and was submitted to your team's library\n` +
        `_It's added once an independent re-score agrees; future prompts in this folder are then coached against it._`;
}

// Shown instead when the rounded score reached 7 (no coaching needed) but the
// prompt did not pass the library gate.
export function renderNotPromotedNote(overall: number, gate: GateResult): string {
  const why =
    gate.reason === 'weak_dimension'
      ? `every dimension needs at least ${PROMOTION_MIN_DIMENSION}/10`
      : `the exact average needs to be ${PROMOTION_MIN_MEAN}.0 or higher (yours: ${gate.mean.toFixed(1)})`;
  return `### 👍 Your prompt scored **${overall}/10** — good to go\n` +
    `_Not added to your team's library: ${why}._`;
}
