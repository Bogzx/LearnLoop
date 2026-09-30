// The library gate. The bug it replaces: /coach promoted on the ROUNDED mean
// (so 6.5 qualified) with no per-dimension floor (10/10/10/10/0 qualified).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DimensionScores } from '@trailhead/shared';
import {
  passesPromotionGate,
  promotionMode,
  renderLibraryBanner,
  renderNotPromotedNote,
  unroundedMean,
} from './promotion-gate.ts';

const d = (a: number, b: number, c: number, e: number, f: number): DimensionScores => ({
  goal_clarity: a, specificity: b, context_loading: c, constraint_articulation: e, output_specification: f,
});

test('a mean that only ROUNDS to 7 does not pass', () => {
  const dims = d(7, 7, 7, 6, 6); // 6.6 → Math.round = 7
  assert.equal(Math.round(unroundedMean(dims)), 7);
  const g = passesPromotionGate(dims);
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'mean_below_threshold');
});

test('exactly 7.0 passes', () => {
  assert.equal(passesPromotionGate(d(7, 7, 7, 7, 7)).ok, true);
});

test('a single weak dimension blocks promotion however high the mean', () => {
  const g = passesPromotionGate(d(10, 10, 10, 10, 4));
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'weak_dimension');
  assert.equal(passesPromotionGate(d(9, 9, 9, 9, 5)).ok, true);
});

test('mode defaults to auto; review only when asked', () => {
  assert.equal(promotionMode({}), 'auto');
  assert.equal(promotionMode({ TRAILHEAD_PROMOTION_MODE: 'review' }), 'review');
  assert.equal(promotionMode({ TRAILHEAD_PROMOTION_MODE: 'yes please' }), 'auto');
});

test('banners never claim the prompt already joined the library', () => {
  for (const mode of ['auto', 'review'] as const) {
    const b = renderLibraryBanner(8, mode);
    assert.ok(!/joined/.test(b));
    assert.ok(/submitted/.test(b));
  }
  assert.ok(/re-score/.test(renderLibraryBanner(8, 'auto')));
  assert.ok(/review/.test(renderLibraryBanner(8, 'review')));
});

test('the not-promoted note says why', () => {
  assert.ok(/6\.6/.test(renderNotPromotedNote(7, passesPromotionGate(d(7, 7, 7, 6, 6)))));
  assert.ok(/at least 5/.test(renderNotPromotedNote(9, passesPromotionGate(d(10, 10, 10, 10, 4)))));
});
