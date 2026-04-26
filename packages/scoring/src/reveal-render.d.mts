import type { Dimension, DimensionScores } from '@trailhead/shared';

export interface RenderTeachBlockArgs {
  targetDim: Dimension;
  targetScore: number;
  strongExample: string;
  previousLowestDim?: Dimension;
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
}
export declare function renderSuccessReveal(args: RenderSuccessRevealArgs): string;

export interface RenderSkipRevealArgs {
  strongRewrite: string;
  originalDimensions: DimensionScores;
  reason: 'skip' | 'no_progress';
  noProgressDim?: Dimension;
}
export declare function renderSkipReveal(args: RenderSkipRevealArgs): string;
