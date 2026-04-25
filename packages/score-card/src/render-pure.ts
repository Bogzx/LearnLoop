// Pure data layer for the score card. No DOM, no globals — easy to unit-test
// and shared between the browser-ext content script and the VS Code webview.
// `render.ts` is the thin DOM mapper that consumes this model.
import type { Dimension, ScoreResponse } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';

export type ColorBucket = 'low' | 'med' | 'high';

export interface ScoreRow {
  dimension: Dimension;
  label: string;
  score: number;
  ok: boolean;
  hint: string | null;
  color: ColorBucket;
}

export interface ScoreCardModel {
  overall: number;
  overallColor: ColorBucket;
  rows: ScoreRow[];
}

export function colorForScore(n: number): ColorBucket {
  if (n >= 7) return 'high';
  if (n >= 4) return 'med';
  return 'low';
}

export function prettyDimension(d: Dimension): string {
  return d.replace(/_/g, ' ');
}

export function buildScoreCardModel(res: ScoreResponse): ScoreCardModel {
  const rows: ScoreRow[] = DIMENSIONS.map((dim) => {
    const score = Number(res.dimensions?.[dim] ?? 0);
    return {
      dimension: dim,
      label: prettyDimension(dim),
      score,
      ok: score >= 5,
      hint: res.missing?.[dim] ?? null,
      color: colorForScore(score),
    };
  });
  const overall = Number(res.overall ?? 0);
  return { overall, overallColor: colorForScore(overall), rows };
}
