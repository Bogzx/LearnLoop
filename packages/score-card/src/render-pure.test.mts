import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreCardModel,
  colorForScore,
  prettyDimension,
} from './render-pure.ts';
import type { ScoreResponse } from '@trailhead/shared';

test('colorForScore boundaries', () => {
  assert.equal(colorForScore(0), 'low');
  assert.equal(colorForScore(3), 'low');
  assert.equal(colorForScore(4), 'med');
  assert.equal(colorForScore(6), 'med');
  assert.equal(colorForScore(7), 'high');
  assert.equal(colorForScore(10), 'high');
});

test('prettyDimension turns snake_case into spaced label', () => {
  assert.equal(prettyDimension('goal_clarity'), 'goal clarity');
  assert.equal(prettyDimension('output_specification'), 'output specification');
});

const sample: ScoreResponse = {
  overall: 4,
  dimensions: {
    goal_clarity: 8,
    specificity: 4,
    context_loading: 2,
    constraint_articulation: 1,
    output_specification: 3,
  },
  missing: {
    context_loading: 'no file or function referenced',
    constraint_articulation: 'no constraints stated',
    output_specification: 'no return shape requested',
  },
};

test('buildScoreCardModel emits five rows in canonical order', () => {
  const m = buildScoreCardModel(sample);
  assert.equal(m.overall, 4);
  assert.equal(m.overallColor, 'med');
  assert.equal(m.rows.length, 5);
  assert.deepEqual(
    m.rows.map((r) => r.dimension),
    [
      'goal_clarity',
      'specificity',
      'context_loading',
      'constraint_articulation',
      'output_specification',
    ],
  );
});

test('buildScoreCardModel marks ok=true at score >= 5 and propagates hints', () => {
  const m = buildScoreCardModel(sample);
  const goal = m.rows.find((r) => r.dimension === 'goal_clarity')!;
  const ctx = m.rows.find((r) => r.dimension === 'context_loading')!;
  assert.equal(goal.ok, true);
  assert.equal(goal.color, 'high');
  assert.equal(goal.hint, null);
  assert.equal(ctx.ok, false);
  assert.equal(ctx.color, 'low');
  assert.equal(ctx.hint, 'no file or function referenced');
});

test('buildScoreCardModel handles missing dimension gracefully (treats as 0)', () => {
  const partial = {
    overall: 0,
    dimensions: {} as ScoreResponse['dimensions'],
    missing: {},
  } as ScoreResponse;
  const m = buildScoreCardModel(partial);
  assert.equal(m.overall, 0);
  assert.equal(m.overallColor, 'low');
  assert.equal(m.rows.length, 5);
  for (const row of m.rows) {
    assert.equal(row.score, 0);
    assert.equal(row.ok, false);
    assert.equal(row.color, 'low');
  }
});
