// The eval harness itself (stats + CLI), tested offline: no key, no calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DimensionScores } from '@trailhead/shared';
import { buildReport, renderMarkdown, reportPrompt, summarize, validateGoldenSet, type GoldenPrompt } from './stats.ts';
import { main, parseArgs } from './run.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = (n: number): DimensionScores => ({
  goal_clarity: n, specificity: n, context_loading: n, constraint_articulation: n, output_specification: n,
});

test('the shipped golden set is valid and big enough to mean something', () => {
  const set = validateGoldenSet(JSON.parse(readFileSync(resolve(HERE, 'golden.json'), 'utf8')));
  assert.ok(set.prompts.length >= 25, `only ${set.prompts.length} golden prompts`);
  const ids = set.prompts.map((p) => p.id);
  for (const tag of ['vague-', 'strong-', 'injection-']) {
    assert.ok(ids.some((id) => id.startsWith(tag)), `golden set should include ${tag}* prompts`);
  }
});

test('validateGoldenSet reports every problem at once', () => {
  assert.throws(
    () => validateGoldenSet({ prompts: [
      { id: 'a', prompt: 'x', overall: [5, 3] },
      { id: 'a', prompt: '', overall: [0, 11], dims: { nonsense: [0, 1] } },
    ] }),
    (e: Error) => /min <= max/.test(e.message) && /duplicate id/.test(e.message) && /missing prompt/.test(e.message) && /unknown dimension nonsense/.test(e.message),
  );
});

test('summarize: mean, population SD, range', () => {
  const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.mean, 5);
  assert.equal(s.sd, 2);
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
});

test('reportPrompt: band hits, gate flips, failures excluded from stats', () => {
  const g: GoldenPrompt = { id: 'p', prompt: 'x', overall: [6, 8], dims: { goal_clarity: [7, 10] } };
  const r = reportPrompt(g, [
    { dimensions: all(7) },                 // overall 7: in band, skips coaching, promotable
    { dimensions: { ...all(7), output_specification: 3 } }, // exact 6.2 → rounds 6: coaches, not promotable
    { dimensions: null, failed: 'unparseable' },
  ]);
  assert.equal(r.runs, 3);
  assert.equal(r.failures, 1);
  assert.equal(r.overall.n, 2);
  assert.equal(r.overallBandHit, 1);
  assert.equal(r.dimBandHit, 1);
  assert.equal(r.coachingGateFlips, true);
  assert.equal(r.promotionGateFlips, true);
});

test('a perfectly stable prompt has zero spread and no flips', () => {
  const r = reportPrompt({ id: 's', prompt: 'x', overall: [8, 10] }, [{ dimensions: all(9) }, { dimensions: all(9) }]);
  assert.equal(r.overall.sd, 0);
  assert.equal(r.coachingGateFlips || r.promotionGateFlips, false);
  const md = renderMarkdown(buildReport(
    { model: 'm', runsPerPrompt: 2, temperature: 0.2, thinkingBudget: -1, label: 'l', startedAt: 'now', dryRun: false },
    [r],
  ));
  assert.match(md, /\| s \| 9\.0 ± 0\.00 \| 9–9 \| 100% \|/);
});

test('parseArgs validates numbers and defaults runs to 5', () => {
  assert.equal(parseArgs([]).runs, 5);
  assert.equal(parseArgs(['--runs', '3', '--temperature', '0']).temperature, 0);
  assert.throws(() => parseArgs(['--runs', '0']));
  assert.throws(() => parseArgs(['--temperature', 'hot']));
});

test('a real run refuses without --yes and makes no call', async () => {
  const had = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'not-a-real-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => assert.fail('no network call may happen')) as typeof fetch;
  try {
    assert.equal(await main(['--runs', '1']), 2);
  } finally {
    globalThis.fetch = realFetch;
    if (had === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = had;
  }
});

test('--dry-run runs the whole pipeline offline and writes the report', async () => {
  const out = mkdtempSync(join(tmpdir(), 'trailhead-eval-'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => assert.fail('dry run must not call the network')) as typeof fetch;
  try {
    assert.equal(await main(['--dry-run', '--runs', '2', '--only', 'vague-fix,strong-retry', '--out', out, '--label', 'test']), 0);
    const files = readdirSync(out);
    const md = readFileSync(join(out, files.find((f) => f.endsWith('.md'))!), 'utf8');
    const json = JSON.parse(readFileSync(join(out, files.find((f) => f.endsWith('.json'))!), 'utf8'));
    assert.match(md, /DRY RUN/);
    assert.equal(json.totals.calls, 4);
    assert.deepEqual(json.prompts.map((p: { id: string }) => p.id), ['vague-fix', 'strong-retry']);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(out, { recursive: true, force: true });
  }
});
