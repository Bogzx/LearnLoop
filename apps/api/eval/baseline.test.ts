// The rule-based scorer (packages/scoring/src/heuristic-score.mjs) against the
// golden set and the held-out set, in CI, with no key and no network.
//
// It is the scorer behind TRAILHEAD_LLM=offline and the landing-page demo, and
// a baseline a model scorer should beat. The thresholds sit just under what it
// measured when its rules were frozen (see eval/README.md → Baseline), so a
// rule change that makes it worse fails here. The golden set was visible while
// the rules were written; the held-out set, by its author's account, was not
// (author-attested: both landed in one commit), which is why its thresholds
// are lower.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicScore } from '@trailhead/scoring';
import { buildReport, reportPrompt, validateGoldenSet } from './stats.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function evaluate(file: string) {
  const set = validateGoldenSet(JSON.parse(readFileSync(resolve(HERE, file), 'utf8')));
  const prompts = set.prompts.map((g) => reportPrompt(g, [{ dimensions: heuristicScore(g.prompt).dimensions }]));
  return buildReport(
    { model: 'heuristic', runsPerPrompt: 1, temperature: NaN, thinkingBudget: NaN, label: file, startedAt: '', dryRun: false },
    prompts,
  ).totals;
}

test('rule-based scorer on the golden set (seen while writing the rules)', () => {
  const t = evaluate('golden.json');
  assert.ok(t.overallBandHit >= 0.9, `overall band hit ${t.overallBandHit}`);
  assert.ok(t.dimBandHit >= 0.9, `dimension band hit ${t.dimBandHit}`);
  assert.ok(t.ordering.rate >= 0.97, `ordering ${t.ordering.agree}/${t.ordering.pairs}`);
});

test('rule-based scorer on the held-out set (author-attested: not used to tune the rules)', () => {
  const t = evaluate('holdout.json');
  assert.ok(t.overallBandHit >= 0.8, `overall band hit ${t.overallBandHit}`);
  assert.ok(t.dimBandHit >= 0.75, `dimension band hit ${t.dimBandHit}`);
  assert.ok(t.ordering.rate >= 0.95, `ordering ${t.ordering.agree}/${t.ordering.pairs}`);
});

test('the held-out set is valid and does not reuse golden prompts', () => {
  const golden = validateGoldenSet(JSON.parse(readFileSync(resolve(HERE, 'golden.json'), 'utf8')));
  const holdout = validateGoldenSet(JSON.parse(readFileSync(resolve(HERE, 'holdout.json'), 'utf8')));
  const seen = new Set(golden.prompts.map((p) => p.prompt));
  assert.ok(holdout.prompts.length >= 15);
  for (const p of holdout.prompts) assert.ok(!seen.has(p.prompt), `${p.id} duplicates a golden prompt`);
});
