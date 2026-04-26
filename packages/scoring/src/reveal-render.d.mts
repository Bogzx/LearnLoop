import type { Dimension, DimensionScores } from '@trailhead/shared';

export interface RenderTeachBlockArgs {
  targetDim: Dimension;
  targetScore: number;
  strongExample: string;
  previousLowestDim?: Dimension;
  // Gemini-generated round-2+ acknowledgment of the user's last edit.
  // Empty string or undefined → fall back to the static "You addressed X"
  // line driven by `previousLowestDim`.
  acknowledgment?: string;
  // Gemini-generated one-liner naming the principle the strong example
  // demonstrates. Rendered as "Why it works: <tip>" right after the
  // example. Omitted when empty / undefined.
  tip?: string;
}
export declare function renderTeachBlock(args: RenderTeachBlockArgs): string;

export interface RenderSuccessRevealArgs {
  originalPrompt: string;
  finalPrompt: string;
  originalOverall: number;
  finalOverall: number;
  originalDimensions: DimensionScores;
  finalDimensions: DimensionScores;
  maxRoundsHit?: boolean;
  // Gemini-generated end-of-session takeaway. Appended after the static
  // score arc; omitted on helper failure (fail-open).
  summary?: string;
}
export declare function renderSuccessReveal(args: RenderSuccessRevealArgs): string;

export interface RenderSkipRevealArgs {
  strongRewrite: string;
  originalDimensions: DimensionScores;
  reason: 'skip' | 'no_progress';
  noProgressDim?: Dimension;
  // Same as RenderSuccessRevealArgs.summary.
  summary?: string;
}
export declare function renderSkipReveal(args: RenderSkipRevealArgs): string;
