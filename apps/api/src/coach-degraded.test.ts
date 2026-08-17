// Regression tests for the /coach silent-failure blocker.
//
// The bug these pin down: when scoring failed, /coach returned
// { proceed: true, text: '', overall: 0 }. The MCP coach tool renders an
// empty `text` on a proceed=true score-mode response as
// "(coach overall: 0/10 — no coaching needed)" — byte-identical to what it
// prints for a perfect prompt. The tool therefore ran indefinitely, never
// coaching and never erroring, and looked healthy the whole time.
//
// The contract asserted here is deliberately narrow and behavioural:
//   1. proceed stays true (an outage must not block the user's real work)
//   2. text is NON-EMPTY (this is what makes the failure visible)
//   3. degraded/error are set (this is what makes it machine-detectable)
//
// Run: npm --workspace=apps/api test

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS } from '@trailhead/shared';
import type { DimensionScores } from '@trailhead/shared';
import { degradedCoachResponse, degradeDetail } from './coach-degraded.ts';

const ZEROS = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as DimensionScores;

test('degraded response still proceeds — an outage must not block the user', () => {
  const res = degradedCoachResponse('score', ZEROS, 'score_failed', new Error('boom'));
  assert.equal(res.proceed, true);
});

test('degraded response never returns an empty text — that is the whole bug', () => {
  for (const reason of ['score_failed', 'score_unparseable'] as const) {
    const res = degradedCoachResponse('score', ZEROS, reason, new Error('boom'));
    assert.notEqual(res.text, '', `${reason} must not produce an empty text`);
    assert.ok(res.text.trim().length > 0);
    // The MCP tool branches on `res.text && res.text.trim()` before it falls
    // through to the "no coaching needed" string. A non-blank text is exactly
    // what keeps it out of that branch.
    assert.ok(!res.text.includes('no coaching needed'));
  }
});

test('degraded response is machine-detectable via degraded + error', () => {
  const res = degradedCoachResponse('score', ZEROS, 'score_unparseable');
  assert.equal(res.degraded, true);
  assert.equal(res.error, 'score_unparseable');
});

test('a healthy response is distinguishable from a degraded one', () => {
  // The pre-fix shape: what a genuine "great prompt, nothing to coach"
  // response looks like. It must not be confusable with the degraded shape.
  const healthy = { proceed: true, text: '', degraded: undefined };
  const degraded = degradedCoachResponse('score', ZEROS, 'score_failed');
  assert.notEqual(Boolean(healthy.degraded), Boolean(degraded.degraded));
  assert.notEqual(healthy.text === '', degraded.text === '');
});

test('the underlying error message is surfaced, not swallowed', () => {
  const res = degradedCoachResponse('score', ZEROS, 'score_failed', new Error('429 quota exceeded'));
  assert.match(res.text, /429 quota exceeded/);
});

test('degradeDetail handles non-Error throwables without producing "undefined"', () => {
  assert.equal(degradeDetail('score_failed', 'plain string'), 'plain string');
  assert.equal(degradeDetail('score_failed', undefined), 'unknown error');
  assert.match(degradeDetail('score_unparseable'), /could not be parsed/);
});

test('the placeholder 0/10 is labelled as a placeholder, not a verdict', () => {
  // A 0/10 that looks like a real score is its own kind of lie — it tells the
  // user their prompt was terrible when in fact it was never read.
  const res = degradedCoachResponse('score', ZEROS, 'score_failed');
  assert.equal(res.overall, 0);
  assert.match(res.text, /placeholder/i);
});

test('mode is preserved so the caller can still branch on it', () => {
  for (const mode of ['score', 'skip_reveal', 'augment'] as const) {
    assert.equal(degradedCoachResponse(mode, ZEROS, 'score_failed').mode, mode);
  }
});
